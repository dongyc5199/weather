"""Read genuine GFS pressure reduced to mean sea level for the active snapshot."""

from datetime import datetime
import json
from pathlib import Path
import re
import threading

from .earth_data import (
    EarthDataError, ORIGINS, SEA_LEVEL_PRESSURE, Selection, atomic_json,
    decode_field, parse_index, read_url,
)
from .earth_heights import SNAPSHOT_PATTERN

_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
_GRID_KEYS = ("nx", "ny", "dx", "dy", "lo1", "la1", "refTime", "forecastTime")


def pressure_profile(viewer: Path, snapshot: str, *, reader=read_url) -> dict:
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot):
        raise ValueError("Invalid pressure snapshot")
    source = viewer / "data" / "live" / snapshot
    metadata = json.loads((source / "metadata.json").read_text())
    if metadata["id"] != snapshot:
        raise EarthDataError("Pressure snapshot identity does not match")
    reference = json.loads((source / "wind.json").read_text())[0]["header"]
    path = viewer / "data" / "earth3d-cache" / "pressure" / snapshot / "mean-sea-level.json"

    def validate(record):
        header = record["header"]
        if (any(header[k] != reference[k] for k in _GRID_KEYS)
                or len(record["data"]) != header["nx"] * header["ny"]
                or (header.get("parameterUnit"), header.get("levelType"), header.get("layer"))
                != ("Pa", "meanSea", "mean_sea_level")
                or (header.get("parameterCategory"), header.get("parameterNumber")) != (3, 1)):
            raise EarthDataError("Mean sea-level pressure does not match the active wind snapshot")
        return record

    with _guard:
        lock = _locks.setdefault(str(path), threading.Lock())
    with lock:
        if path.is_file():
            record = validate(json.loads(path.read_text()))
        else:
            run = datetime.fromisoformat(metadata["run_time"].replace("Z", "+00:00"))
            valid = datetime.fromisoformat(metadata["valid_time"].replace("Z", "+00:00"))
            forecast = int((valid - run).total_seconds() / 3600)
            key = f"gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{forecast:03d}"
            last_error = None
            for origin in ORIGINS:
                url = origin + "/" + key
                try:
                    ranges = parse_index(reader(url + ".idx").decode(), run, {"pressure": SEA_LEVEL_PRESSURE})
                    selection = Selection(run, valid, forecast, url, ranges)
                    record = validate(decode_field(reader(url, byte_range=ranges["pressure"]),
                                                   "pressure", selection, metadata["resolution"], spec=SEA_LEVEL_PRESSURE))
                    atomic_json(path, record)
                    break
                except (OSError, ValueError, EarthDataError) as error:
                    last_error = error
            else:
                raise EarthDataError("Matching GFS mean sea-level pressure is temporarily unavailable") from last_error
    return {
        "snapshot": snapshot, "source": "NOAA GFS PRMSL", "reference": "mean sea level",
        "run_time": metadata["run_time"], "valid_time": metadata["valid_time"], "pressure": record,
    }
