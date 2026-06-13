from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import ExifTags, Image


GPS_INFO_TAG = 34853


@dataclass(frozen=True)
class GPSExtraction:
    source_image: str
    latitude: float
    longitude: float
    altitude_m: float | None
    method: str = "exif_gps"

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)


def rational_to_float(value: Any) -> float:
    if isinstance(value, tuple) and len(value) == 2:
        numerator, denominator = value
        return float(numerator) / float(denominator)
    if hasattr(value, "numerator") and hasattr(value, "denominator"):
        return float(value.numerator) / float(value.denominator)
    return float(value)


def dms_to_decimal(values: Any, ref: str) -> float:
    if len(values) != 3:
        raise ValueError("GPS DMS value must contain degrees, minutes, and seconds")
    degrees, minutes, seconds = [rational_to_float(value) for value in values]
    decimal = degrees + minutes / 60.0 + seconds / 3600.0
    if ref.upper() in {"S", "W"}:
        decimal *= -1
    return decimal


def _read_gps_ifd(image: Image.Image) -> dict[str, Any]:
    exif = image.getexif()
    if not exif:
        return {}

    gps_raw: dict[int, Any] | None = None
    if hasattr(exif, "get_ifd"):
        try:
            gps_raw = exif.get_ifd(GPS_INFO_TAG)
        except Exception:
            gps_raw = None
    if not gps_raw:
        maybe_raw = exif.get(GPS_INFO_TAG)
        gps_raw = maybe_raw if isinstance(maybe_raw, dict) else None
    if not gps_raw:
        return {}

    return {ExifTags.GPSTAGS.get(key, str(key)): value for key, value in gps_raw.items()}


def extract_gps(image_path: str | Path) -> GPSExtraction:
    path = Path(image_path)
    with Image.open(path) as image:
        gps = _read_gps_ifd(image)

    if not gps:
        raise ValueError(f"no GPS EXIF data found in {path}")

    try:
        latitude = dms_to_decimal(gps["GPSLatitude"], gps["GPSLatitudeRef"])
        longitude = dms_to_decimal(gps["GPSLongitude"], gps["GPSLongitudeRef"])
    except KeyError as exc:
        raise ValueError(f"incomplete GPS EXIF data in {path}: missing {exc.args[0]}") from exc

    altitude = gps.get("GPSAltitude")
    altitude_ref = gps.get("GPSAltitudeRef", 0)
    altitude_m = rational_to_float(altitude) if altitude is not None else None
    if altitude_m is not None and int(altitude_ref) == 1:
        altitude_m *= -1

    return GPSExtraction(
        source_image=str(path),
        latitude=round(latitude, 8),
        longitude=round(longitude, 8),
        altitude_m=round(altitude_m, 3) if altitude_m is not None else None,
    )

