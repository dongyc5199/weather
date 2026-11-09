"""Snapshot-aligned GFS heights; never substitute a height from a different run."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
from pathlib import Path
import re
import threading

from .earth_data import (
    EarthDataError, HEIGHT_FIELDS, LAYER_KEYS, ORIGINS, Selection,
    atomic_json, decode_field, parse_index, read_url,
)

SNAPSHOT_PATTERN = r"\d{8}T\d{2}Z-f\d{3}-\d+p\d+(?:-v2)?"
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def height_profile(viewer: Path, snapshot: str, layer: str, *, reader=read_url) -> dict:
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot) or layer not in LAYER_KEYS:
        raise ValueError("Invalid height profile")
    source = viewer / "data" / "live" / snapshot
    metadata = json.loads((source / "metadata.json").read_text())
    if metadata["id"] != snapshot:
        raise EarthDataError("Height snapshot identity does not match")
    run = datetime.fromisoformat(metadata["run_time"].replace("Z", "+00:00"))
    valid = datetime.fromisoformat(metadata["valid_time"].replace("Z", "+00:00"))
    forecast = int((valid - run).total_seconds() / 3600)
    key = f"gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{forecast:03d}"
    # Construct only NOAA URLs from the validated snapshot, never proxy a client URL.
    urls = [origin + "/" + key for origin in ORIGINS]
    requested = ["orography", "surface_pressure"]
    if layer != "surface":
        requested.append(layer + "-height")
    cache = viewer / "data" / "earth3d-cache" / "height" / snapshot
    def result():
        fields = {name: json.loads((cache / (name + ".json")).read_text()) for name in requested}
        return {
            "snapshot": snapshot, "layer": layer, "source": "NOAA GFS HGT/PRES",
            "run_time": metadata["run_time"], "valid_time": metadata["valid_time"],
            "orography": fields["orography"], "surface_pressure": fields["surface_pressure"],
            "height": fields.get(layer + "-height"),
            "height_reference": "geopotential metres; converted to geometric height for display",
        }
    # Cached layers must remain immediately switchable while another layer downloads.
    if all((cache / (name + ".json")).is_file() for name in requested):
        return result()
    with _locks_guard:
        lock = _locks.setdefault(str(cache), threading.Lock())
    with lock:
        missing = [name for name in requested if not (cache / (name + ".json")).is_file()]
        if missing:
            last_error = None
            for url in urls:
                try:
                    fields = {name: HEIGHT_FIELDS[name] for name in missing}
                    ranges = parse_index(reader(url + ".idx").decode(), run, fields)
                    selection = Selection(run, valid, forecast, url, ranges)

                    def download(name):
                        payload = reader(url, byte_range=ranges[name])
                        return name, decode_field(payload, name, selection, metadata["resolution"], spec=fields[name])

                    with ThreadPoolExecutor(max_workers=3) as pool:
                        records = dict(pool.map(download, missing))
                    # Check against the existing wind snapshot before publishing any field.
                    wind_path = source / ("wind.json" if layer == "surface" else layer + "/wind.json")
                    reference = json.loads(wind_path.read_text())[0]["header"]
                    for name, record in records.items():
                        if any(record["header"][k] != reference[k] for k in ("nx", "ny", "dx", "dy", "lo1", "la1", "refTime", "forecastTime")):
                            raise EarthDataError("Height and wind grids or forecast times do not match")
                    for name, record in records.items():
                        atomic_json(cache / (name + ".json"), record)
                    break
                except (OSError, ValueError, EarthDataError) as error:
                    last_error = error
            else:
                raise EarthDataError("Matching GFS height data is temporarily unavailable") from last_error
    return result()
