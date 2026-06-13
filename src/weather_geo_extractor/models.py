from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class BBox:
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    @classmethod
    def from_sequence(cls, values: list[float] | tuple[float, float, float, float]) -> "BBox":
        if len(values) != 4:
            raise ValueError("bbox must contain exactly four values: min_lon min_lat max_lon max_lat")
        min_lon, min_lat, max_lon, max_lat = [float(value) for value in values]
        if min_lon >= max_lon:
            raise ValueError("bbox min_lon must be smaller than max_lon")
        if min_lat >= max_lat:
            raise ValueError("bbox min_lat must be smaller than max_lat")
        return cls(min_lon=min_lon, min_lat=min_lat, max_lon=max_lon, max_lat=max_lat)

    def to_geojson_bbox(self) -> list[float]:
        return [self.min_lon, self.min_lat, self.max_lon, self.max_lat]


@dataclass(frozen=True)
class PixelPoint:
    x: float
    y: float


@dataclass(frozen=True)
class LonLatPoint:
    lon: float
    lat: float

    def to_position(self) -> list[float]:
        return [round(self.lon, 6), round(self.lat, 6)]


@dataclass(frozen=True)
class ColorRange:
    label: str
    lower_hsv: tuple[int, int, int]
    upper_hsv: tuple[int, int, int]

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "ColorRange":
        try:
            label = str(value["label"])
            lower = tuple(int(item) for item in value["lower_hsv"])
            upper = tuple(int(item) for item in value["upper_hsv"])
        except KeyError as exc:
            raise ValueError(f"missing color profile key: {exc.args[0]}") from exc
        except TypeError as exc:
            raise ValueError("color profile lower_hsv and upper_hsv must be arrays") from exc
        if len(lower) != 3 or len(upper) != 3:
            raise ValueError(f"color profile {label!r} must use three HSV values")
        for name, triple in (("lower_hsv", lower), ("upper_hsv", upper)):
            h, s, v = triple
            if not 0 <= h <= 179 or not 0 <= s <= 255 or not 0 <= v <= 255:
                raise ValueError(f"color profile {label!r} has invalid {name}: {triple}")
        return cls(label=label, lower_hsv=lower, upper_hsv=upper)


@dataclass(frozen=True)
class PixelRegion:
    label: str
    polygon: list[PixelPoint]
    area_px: float
    source_image: Path

    def pixel_bbox(self) -> tuple[float, float, float, float]:
        xs = [point.x for point in self.polygon]
        ys = [point.y for point in self.polygon]
        return min(xs), min(ys), max(xs), max(ys)

