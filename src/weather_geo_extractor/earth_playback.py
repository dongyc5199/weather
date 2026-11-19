"""Compact, snapshot-bound fields for interactive time scrubbing."""

import gzip
import io
import json
import math
import os
from pathlib import Path
import re
import struct
import tempfile
import threading
from weakref import WeakValueDictionary

import numpy as np
from PIL import Image

from .earth_data import EarthDataError, LAYER_KEYS, LAYER_FILES
from .earth_heights import SNAPSHOT_PATTERN, height_profile

_locks = WeakValueDictionary()
_guard = threading.Lock()
WIND_LEVELS = (1000, 850, 700, 500, 250, 70)
PRODUCTS = (*LAYER_KEYS, "observation", "volume", "pressure")


def _packet(meta, payload):
    header = json.dumps(meta, separators=(",", ":"), allow_nan=False).encode()
    header += b" " * (-len(header) % 4)
    return struct.pack("<I", len(header)) + header + payload


def _sample(record, model, spacing=2):
    h = record["header"]
    if (
        h["refTime"] != model["run_time"]
        or h["forecastTime"] != model["forecast_hour"]
        or (h["nx"], h["ny"], h["lo1"], h["la1"], h["dx"], h["dy"])
        != (model["nx"], model["ny"], 0, 90, model["resolution"], model["resolution"])
    ):
        raise EarthDataError("Playback grid or forecast time mismatch")
    stride = max(1, round(spacing / h["dx"]))
    while h["nx"] % stride or (h["ny"] - 1) % stride:
        stride -= 1
    values = np.asarray(record["data"], dtype="<f4").reshape(h["ny"], h["nx"])[
        ::stride, ::stride
    ]
    ny, nx = values.shape
    step = h["dx"] * stride
    return dict(h, nx=nx, ny=ny, dx=step, dy=step, lo2=(nx - 1) * step), values


def _records(model, records, meta):
    sampled = [_sample(r, model) for r in records]
    meta["headers"] = [h for h, _ in sampled]
    return _packet(meta, b"".join(a.tobytes() for _, a in sampled))


def _observation(viewer, snapshot, meta):
    from .earth_observations import cloud_observation

    info = cloud_observation(viewer, snapshot)
    with Image.open(viewer / info["texture_url"].lstrip("/")) as source:
        # Only optical strength and quality are sampled by the renderer.
        image = Image.merge("LA", (source.getchannel("R"), source.getchannel("A")))
        image.thumbnail((1024, 512), Image.Resampling.BOX)
        buf = io.BytesIO()
        image.save(buf, format="PNG")
    return _packet(dict(meta, observation=info), buf.getvalue())


def _volume(viewer, snapshot, model, root, meta):
    from .earth_cloud_shape import cloud_shape_profile, cloud_shape_bytes

    profile = cloud_shape_profile(viewer, snapshot)
    h = profile["grid"]
    stride = max(1, round(1 / h["dx"]))
    cells = np.frombuffer(cloud_shape_bytes(viewer, snapshot), dtype="<u2").reshape(
        h["ny"], h["nx"], 4
    )
    cells = cells[::stride, ::stride]
    ny, nx, _ = cells.shape
    grid = dict(
        h,
        nx=nx,
        ny=ny,
        dx=h["dx"] * stride,
        dy=h["dy"] * stride,
        lo2=(nx - 1) * h["dx"] * stride,
    )
    # Merge only traversal bounds. The sampled height field controls optical density.
    bounds = {}
    for lon, lat, low, high, radius in profile["regions"]:
        x, y = math.floor(lon / 5) * 5 + 2.5, math.floor(lat / 5) * 5 + 2.5
        reach = radius + 111700 * (abs(lon - x) + abs(lat - y))
        region = bounds.setdefault((x, y), [x, y, low, high, reach])
        region[2:] = min(low, region[2]), max(high, region[3]), max(reach, region[4])
    info = dict(
        profile, grid=grid, regions=list(bounds.values()), byte_length=cells.nbytes
    )
    winds = []
    levels = []
    max_speed = 0.0
    for pressure in WIND_LEVELS:
        level = f"{pressure}hPa"
        if level not in model.get("layers", {}):
            winds.append(None)
            continue
        pair = json.loads((root / (LAYER_FILES[level]["wind"] + ".json")).read_text())
        components = []
        for number in (2, 3):
            record = next(
                (r for r in pair if r["header"].get("parameterNumber") == number), None
            )
            if (
                record is None
                or record["header"].get("layer") != level
                or record["header"].get("parameterUnit") != "m.s-1"
                or record["header"].get("parameterCategory") != 2
            ):
                raise EarthDataError("Playback wind identity mismatch")
            _, component = _sample(record, model, 4)
            components.append(component)
        u, v = components
        valid = np.isfinite(u) & np.isfinite(v)
        wind = np.zeros((*u.shape, 4), dtype="<f2")
        wind[:, :, 0] = np.where(valid, u, 0)
        wind[:, :, 1] = np.where(valid, v, 0)
        wind[:, :, 3] = valid
        if valid.any():
            levels.append(pressure)
            max_speed = max(max_speed, float(np.hypot(u[valid], v[valid]).max()))
        winds.append(wind)
    shape = next((a.shape for a in winds if a is not None), (2, 4, 4))
    empty = bytes(math.prod(shape) * 2)
    wind_meta = dict(
        snapshot=snapshot,
        width=shape[1],
        height=shape[0],
        levels=levels,
        maxSpeed=max_speed,
    )
    return _packet(
        dict(meta, shape=info, wind=wind_meta),
        cells.tobytes()
        + b"".join(a.tobytes() if a is not None else empty for a in winds),
    )


def playback_packet(viewer: Path, snapshot: str, product: str, compressed=True):
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot) or product not in PRODUCTS:
        raise ValueError("Invalid playback product")
    root = viewer / "data/live" / snapshot
    model = json.loads((root / "metadata.json").read_text())
    if model["id"] != snapshot:
        raise EarthDataError("Playback snapshot mismatch")
    dest = viewer / "data/earth3d-cache/playback-v1" / snapshot / (product + ".gz")
    with _guard:
        lock = _locks.setdefault(str(dest), threading.Lock())
    with lock:
        if dest.is_file():
            body = dest.read_bytes()
        else:
            meta = dict(
                snapshot=snapshot,
                product=product,
                run_time=model["run_time"],
                valid_time=model["valid_time"],
            )
            if product == "observation":
                packet = _observation(viewer, snapshot, meta)
            elif product == "volume":
                packet = _volume(viewer, snapshot, model, root, meta)
            elif product == "pressure":
                from .earth_pressure import pressure_profile

                pressure = pressure_profile(viewer, snapshot)
                packet = _records(
                    model,
                    [pressure["pressure"]],
                    dict(meta, reference=pressure["reference"]),
                )
            else:
                files = LAYER_FILES[product]
                wind = json.loads((root / (files["wind"] + ".json")).read_text())
                temp = json.loads((root / (files["temp"] + ".json")).read_text())
                profile = height_profile(viewer, snapshot, product)
                records = [
                    *wind,
                    *temp,
                    profile["orography"],
                    profile["surface_pressure"],
                ]
                if product != "surface":
                    records.append(profile["height"])
                packet = _records(model, records, dict(meta, source=profile["source"]))
            body = gzip.compress(packet, compresslevel=2, mtime=0)
            dest.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=".pending-")
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(body)
                os.replace(tmp, dest)
            finally:
                Path(tmp).unlink(missing_ok=True)
    return body if compressed else gzip.decompress(body)
