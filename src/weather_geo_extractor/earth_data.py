"""Fetch NOAA GFS surface/pressure fields and publish an atomic Earth snapshot."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import numpy as np

UTC = timezone.utc
ORIGINS = (
    "https://noaa-gfs-bdp-pds.s3.amazonaws.com",
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod",
)
PRESSURE_LEVELS = (1000, 850, 700, 500, 250, 70, 10)
LAYER_KEYS = ("surface", *(f"{pressure}hPa" for pressure in PRESSURE_LEVELS))


@dataclass(frozen=True)
class FieldSpec:
    variable: str
    index_level: str
    category: int
    number: int
    level_type: str
    level: int
    layer: str


FIELDS = {
    "u": FieldSpec("UGRD", "10 m above ground", 2, 2, "heightAboveGround", 10, "surface"),
    "v": FieldSpec("VGRD", "10 m above ground", 2, 3, "heightAboveGround", 10, "surface"),
    "temp": FieldSpec("TMP", "2 m above ground", 0, 0, "heightAboveGround", 2, "surface"),
    **{
        f"{pressure}hPa-{component}": FieldSpec(
            variable, f"{pressure} mb", category, number, "isobaricInhPa", pressure, f"{pressure}hPa"
        )
        for pressure in PRESSURE_LEVELS
        for component, variable, category, number in (("u", "UGRD", 2, 2), ("v", "VGRD", 2, 3), ("temp", "TMP", 0, 0))
    },
}
LAYER_FILES = {
    layer: {kind: kind if layer == "surface" else f"{layer}/{kind}" for kind in ("wind", "temp")}
    for layer in LAYER_KEYS
}
HEIGHT_FIELDS = {
    "orography": FieldSpec("HGT", "surface", 3, 5, "surface", 0, "surface"),
    "surface_pressure": FieldSpec("PRES", "surface", 3, 0, "surface", 0, "surface"),
    **{f"{pressure}hPa-height": FieldSpec("HGT", f"{pressure} mb", 3, 5, "isobaricInhPa", pressure, f"{pressure}hPa")
       for pressure in PRESSURE_LEVELS},
}


def field_key(layer: str, component: str) -> str:
    return component if layer == "surface" else f"{layer}-{component}"


class EarthDataError(RuntimeError):
    """A source, grid or cache did not satisfy the data contract."""


def iso_time(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_url(url: str, *, byte_range: tuple[int, int] | None = None) -> bytes:
    """Bound downloads and require real HTTP Range responses for GRIB messages."""
    headers = {"User-Agent": "WeatherEarth/0.1 (NOAA GFS visualization)"}
    limit = 2_000_000
    if byte_range is not None:
        start, end = byte_range
        limit = end - start + 1
        if start < 0 or not 0 < limit <= 16_000_000:
            raise EarthDataError("Invalid GRIB message byte range")
        headers["Range"] = f"bytes={start}-{end}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=25) as response:
        if byte_range is not None:
            content_range = response.headers.get("Content-Range", "")
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+|\*)", content_range)
            if response.status != 206 or not match or tuple(map(int, match.group(1, 2))) != byte_range:
                raise EarthDataError("Source did not honor the requested GRIB byte range")
        payload = response.read(limit + 1)
    if len(payload) > limit or (byte_range is not None and len(payload) != limit):
        raise EarthDataError("Source returned an incomplete or oversized response")
    return payload


def parse_index(text: str, run: datetime, fields: dict[str, FieldSpec] | None = None) -> dict[str, tuple[int, int]]:
    """Select exact variable/height pairs; use the following message as the boundary."""
    fields = FIELDS if fields is None else fields
    rows = [line.split(":") for line in text.splitlines() if line.strip()]
    if not rows or any(len(row) < 6 for row in rows):
        raise EarthDataError("Invalid GFS index")
    try:
        offsets = [int(row[1]) for row in rows]
    except ValueError as exc:
        raise EarthDataError("Invalid GFS index offset") from exc
    if offsets[0] < 0 or any(a >= b for a, b in zip(offsets, offsets[1:])):
        raise EarthDataError("GFS index offsets must increase")
    stamp = "d=" + run.strftime("%Y%m%d%H")
    selected: dict[str, tuple[int, int]] = {}
    for i, row in enumerate(rows):
        for name, spec in fields.items():
            if row[3:5] != [spec.variable, spec.index_level]:
                continue
            if row[2] != stamp or name in selected or i + 1 == len(rows):
                raise EarthDataError("Ambiguous GFS field or mismatched model run")
            selected[name] = (offsets[i], offsets[i + 1] - 1)
    if set(selected) != set(fields):
        missing = ", ".join(sorted(set(fields) - set(selected)))
        raise EarthDataError("GFS run is missing required surface/pressure fields: " + missing)
    return selected


@dataclass(frozen=True)
class Selection:
    run: datetime
    valid: datetime
    forecast_hour: int
    url: str
    ranges: dict[str, tuple[int, int]]


def find_latest(
    now: datetime,
    *,
    reader: Callable[..., bytes] = read_url,
    max_cycles: int = 8,
) -> Selection:
    """Find the newest published run for the current UTC hour, with bounded fallback."""
    if now.tzinfo is None:
        raise ValueError("now must include a timezone")
    valid = now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    newest = valid.replace(hour=(valid.hour // 6) * 6)
    failures = []
    for offset in range(max_cycles):
        run = newest - timedelta(hours=offset * 6)
        forecast = int((valid - run).total_seconds() // 3600)
        key = f"gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{forecast:03d}"
        for origin in ORIGINS:
            url = f"{origin}/{key}"
            try:
                ranges = parse_index(reader(url + ".idx").decode("utf-8"), run)
                return Selection(run, valid, forecast, url, ranges)
            except (OSError, EarthDataError, UnicodeError) as exc:
                failures.append(f"{run:%Y%m%d%H}: {exc}")
    raise EarthDataError("No complete recent GFS run is available: " + "; ".join(failures[-2:]))


def decode_field(payload: bytes, field: str, selection: Selection, resolution: float, *, spec: FieldSpec | None = None) -> dict:
    """Decode regular latitude/longitude GRIB, checking identity, time and orientation."""
    try:
        import eccodes as ec
    except ImportError as exc:
        raise EarthDataError('Install the GFS decoder with: pip install -e ".[weather]"') from exc
    if payload[:4] != b"GRIB" or payload[-4:] != b"7777":
        raise EarthDataError("Source is not a complete GRIB message")
    handle = ec.codes_new_from_message(payload)
    if handle is None:
        raise EarthDataError("Unable to decode GRIB message")
    try:
        get = lambda key: ec.codes_get(handle, key)
        spec = FIELDS[field] if spec is None else spec
        if (get("discipline"), get("parameterCategory"), get("parameterNumber")) != (0, spec.category, spec.number):
            raise EarthDataError(f"Wrong meteorological variable for {field}")
        if get("typeOfLevel") != spec.level_type or get("level") != spec.level:
            raise EarthDataError(f"Wrong vertical level for {field}")
        if get("gridType") != "regular_ll" or any(
            get(key) for key in ("iScansNegatively", "jScansPositively", "jPointsAreConsecutive", "alternativeRowScanning")
        ):
            raise EarthDataError("Unsupported grid orientation; expected west-east, north-south rows")
        if spec.variable in {"UGRD", "VGRD"} and get("uvRelativeToGrid"):
            raise EarthDataError("Wind vectors must be relative to geographic east/north")
        # ecCodes labels GRIB 0/3/5 as "m" in some tables; NOAA calls it gpm.
        expected_units = {"TMP": {"K"}, "HGT": {"gpm", "m"}, "PRES": {"Pa"}}.get(spec.variable, {"m s**-1", "m s-1", "m/s"})
        if get("units") not in expected_units:
            raise EarthDataError(f"Unexpected units for {field}: {get('units')}")

        def grib_time(date_key: str, time_key: str) -> datetime:
            return datetime.strptime(f"{get(date_key):08d}{get(time_key):04d}", "%Y%m%d%H%M").replace(tzinfo=UTC)

        if grib_time("dataDate", "dataTime") != selection.run or grib_time("validityDate", "validityTime") != selection.valid:
            raise EarthDataError("GRIB run/valid time differs from the selected forecast")
        nx, ny = int(get("Ni")), int(get("Nj"))
        dx, dy = float(get("iDirectionIncrementInDegrees")), float(get("jDirectionIncrementInDegrees"))
        lon, lat = float(get("longitudeOfFirstGridPointInDegrees")), float(get("latitudeOfFirstGridPointInDegrees"))
        ratio = resolution / dx
        stride = round(ratio)
        if stride < 1 or not math.isclose(ratio, stride) or not math.isclose(dx, dy):
            raise EarthDataError("Output resolution must be an integer multiple of the source spacing")
        if not (math.isclose(nx * dx, 360) and math.isclose((ny - 1) * dy, 180)
                and math.isclose(lon, 0) and math.isclose(lat, 90)
                and nx % stride == 0 and (ny - 1) % stride == 0):
            raise EarthDataError("Expected a complete global grid starting at 0 E, 90 N")
        values = np.asarray(ec.codes_get_values(handle), dtype=float).reshape(ny, nx)[::stride, ::stride]
        missing = float(get("missingValue"))
        valid = np.isfinite(values) & (values != missing)
        if not valid.any() or (spec.layer == "surface" and not valid.all()):
            raise EarthDataError(f"Missing or non-finite values in {field}")
        finite_values = values[valid]
        if spec.variable == "TMP" and not (finite_values.min() >= 150 and finite_values.max() <= 350):
            raise EarthDataError("Temperature values are outside plausible Kelvin bounds")
        if spec.variable in {"UGRD", "VGRD"} and np.max(np.abs(finite_values)) > 200:
            raise EarthDataError("Wind components exceed plausible m/s bounds")
        if spec.variable == "HGT" and not (-1500 <= finite_values.min() <= finite_values.max() < 65000):
            raise EarthDataError("Height values are outside plausible geopotential bounds")
        if spec.variable == "PRES" and not (10000 <= finite_values.min() <= finite_values.max() < 120000):
            raise EarthDataError("Surface pressure values are outside plausible Pa bounds")
        out_ny, out_nx = values.shape
        is_pressure = spec.level_type == "isobaricInhPa"
        header = {
            "discipline": 0, "parameterCategory": spec.category, "parameterNumber": spec.number,
            "parameterUnit": {"TMP": "K", "HGT": "gpm", "PRES": "Pa"}.get(spec.variable, "m.s-1"),
            "surface1Type": 100 if is_pressure else 1 if spec.level_type == "surface" else 103,
            # GRIB fixed-surface pressure values use Pa, while ecCodes 'level' uses hPa.
            "surface1Value": spec.level * 100 if is_pressure else spec.level, "center": 7,
            "levelType": spec.level_type, "layer": spec.layer,
            "centerName": "US National Weather Service - NCEP (NOAA GFS)",
            "refTime": iso_time(selection.run), "forecastTime": selection.forecast_hour,
            "nx": out_nx, "ny": out_ny, "lo1": lon, "la1": lat,
            "lo2": (out_nx - 1) * resolution, "la2": -90,
            "dx": resolution, "dy": resolution, "scanMode": 0,
            "earthSource": "noaa-gfs", "sourceUrl": selection.url,
            "missingPoints": int(values.size - np.count_nonzero(valid)),
        }
        if is_pressure:
            header["pressureLevelHpa"] = spec.level
        decoded = np.round(values, 3).ravel().tolist()
        for index in np.flatnonzero(~valid.ravel()):
            decoded[int(index)] = None  # Preserve source masks; never invent zero winds/temperature.
        return {"header": header, "data": decoded}
    finally:
        ec.codes_release(handle)


def validate_fields(records: dict[str, dict]) -> None:
    if set(records) != set(FIELDS):
        raise EarthDataError("Cannot publish an incomplete surface/pressure snapshot")
    keys = ("nx", "ny", "dx", "dy", "lo1", "la1", "refTime", "forecastTime")
    reference = tuple(records["u"]["header"][key] for key in keys)
    for name, record in records.items():
        header = record["header"]
        if tuple(header[key] for key in keys) != reference or len(record["data"]) != header["nx"] * header["ny"]:
            raise EarthDataError("Wind and temperature grids/times do not match")
        spec = FIELDS[name]
        is_pressure = spec.level_type == "isobaricInhPa"
        if header["surface1Type"] != (100 if is_pressure else 103) or header["surface1Value"] != spec.level * (100 if is_pressure else 1):
            raise EarthDataError("A record belongs to the wrong vertical level")


def atomic_json(path: Path, payload: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            stream.write("\n")
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def load_manifest(cache: Path) -> dict | None:
    try:
        manifest = json.loads((cache / "manifest.json").read_text())
        if not isinstance(manifest, dict) or manifest.get("schema") not in (1, 2):
            return None
        schema = manifest["schema"]
        pattern = r"\d{8}T\d{2}Z-f\d{3}-\d+p\d+" + ("-v2" if schema == 2 else "")
        if not re.fullmatch(pattern, manifest["id"]):
            return None
        file_keys = {"wind", "temp"}
        if schema == 2:
            if manifest.get("pressure_levels_hpa") != list(PRESSURE_LEVELS) or set(manifest.get("layers", {})) != set(LAYER_KEYS):
                return None
            file_keys = {name for files in LAYER_FILES.values() for name in files.values()}
            for layer, files in LAYER_FILES.items():
                expected = {kind: f"data/live/{manifest['id']}/{name}.json" for kind, name in files.items()}
                entry = manifest["layers"][layer]
                if not isinstance(entry, dict) or entry.get("files") != expected:
                    return None
        if set(manifest["files"]) != file_keys:
            return None
        for name in file_keys:
            if manifest["files"][name] != f"data/live/{manifest['id']}/{name}.json":
                return None
            path = cache / manifest["id"] / f"{name}.json"
            if not path.is_file() or path.stat().st_size != manifest["sizes"][name]:
                return None
        return manifest
    except (OSError, ValueError, KeyError, TypeError):
        return None


def sync_latest(
    cache: Path,
    *,
    now: datetime | None = None,
    resolution: float = 0.5,
    reader: Callable[..., bytes] = read_url,
) -> dict:
    """Publish all heights together; leave the last good manifest intact on any error."""
    now = now or datetime.now(UTC)
    selection = find_latest(now, reader=reader)
    snapshot_id = f"{selection.run:%Y%m%dT%HZ}-f{selection.forecast_hour:03d}-{float(resolution)}-v2".replace(".", "p")
    cached = load_manifest(cache)
    if cached and cached["id"] == snapshot_id:
        cached["checked_at"] = iso_time(now)
        atomic_json(cache / "manifest.json", cached)
        return cached

    def download(name: str) -> tuple[str, bytes]:
        return name, reader(selection.url, byte_range=selection.ranges[name])

    with ThreadPoolExecutor(max_workers=3) as pool:
        messages = dict(pool.map(download, FIELDS))
    records = {name: decode_field(data, name, selection, resolution) for name, data in messages.items()}
    validate_fields(records)
    cache.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".snapshot-", dir=cache))
    try:
        layers = {}
        file_keys = []
        for layer, files in LAYER_FILES.items():
            u, v, temp = (records[field_key(layer, kind)] for kind in ("u", "v", "temp"))
            atomic_json(staging / f"{files['wind']}.json", [u, v])
            atomic_json(staging / f"{files['temp']}.json", [temp])
            file_keys.extend(files.values())
            layers[layer] = {
                "surface": "surface" if layer == "surface" else "isobaric",
                "level": "level" if layer == "surface" else layer,
                "label": "Surface" if layer == "surface" else layer.replace("hPa", " hPa"),
                "files": {kind: f"data/live/{snapshot_id}/{name}.json" for kind, name in files.items()},
            }
            if layer != "surface":
                layers[layer]["pressure_hpa"] = int(layer.removesuffix("hPa"))
        header = records["u"]["header"]
        manifest = {
            "schema": 2, "id": snapshot_id, "source": "NOAA GFS",
            "source_url": selection.url, "index_url": selection.url + ".idx",
            "run_time": iso_time(selection.run), "valid_time": iso_time(selection.valid),
            "forecast_hour": selection.forecast_hour,
            "fetched_at": iso_time(datetime.now(UTC)), "checked_at": iso_time(now),
            "resolution": resolution, "source_resolution": 0.25,
            "nx": header["nx"], "ny": header["ny"], "wind_height_m": 10, "temperature_height_m": 2,
            "pressure_levels_hpa": list(PRESSURE_LEVELS), "layers": layers,
            "processing": "Regular source-grid subsampling; values rounded to 0.001 in native units.",
            "files": {name: f"data/live/{snapshot_id}/{name}.json" for name in file_keys},
            "sizes": {name: (staging / f"{name}.json").stat().st_size for name in file_keys},
            "sha256": {name: hashlib.sha256((staging / f"{name}.json").read_bytes()).hexdigest() for name in file_keys},
            "downloaded_bytes": sum(map(len, messages.values())),
        }
        atomic_json(staging / "metadata.json", manifest)
        target = cache / snapshot_id
        if target.exists():
            # A previous process may have published the immutable generation already.
            for name in file_keys:
                if hashlib.sha256((target / f"{name}.json").read_bytes()).hexdigest() != manifest["sha256"][name]:
                    raise EarthDataError("A cached generation differs; refusing to overwrite an in-use snapshot")
        else:
            os.replace(staging, target)
        atomic_json(cache / "manifest.json", manifest)
        return manifest
    finally:
        if staging.exists():
            shutil.rmtree(staging)
