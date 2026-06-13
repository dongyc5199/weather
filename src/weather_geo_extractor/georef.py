from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .models import BBox, LonLatPoint, PixelPoint

WEB_MERCATOR_RADIUS_M = 6378137.0
WEB_MERCATOR_MAX_LAT = 85.05112878


def lonlat_to_web_mercator(point: LonLatPoint) -> tuple[float, float]:
    lat = max(min(point.lat, WEB_MERCATOR_MAX_LAT), -WEB_MERCATOR_MAX_LAT)
    lon_rad = math.radians(point.lon)
    lat_rad = math.radians(lat)
    x = WEB_MERCATOR_RADIUS_M * lon_rad
    y = WEB_MERCATOR_RADIUS_M * math.log(math.tan(math.pi / 4.0 + lat_rad / 2.0))
    return x, y


def web_mercator_to_lonlat(x: float, y: float) -> LonLatPoint:
    lon = math.degrees(x / WEB_MERCATOR_RADIUS_M)
    lat = math.degrees(2.0 * math.atan(math.exp(y / WEB_MERCATOR_RADIUS_M)) - math.pi / 2.0)
    return LonLatPoint(lon=lon, lat=lat)


def polynomial_terms(x: float, y: float, degree: int) -> list[float]:
    terms: list[float] = []
    for total_degree in range(degree + 1):
        for x_power in range(total_degree + 1):
            y_power = total_degree - x_power
            terms.append((x**x_power) * (y**y_power))
    return terms


@dataclass(frozen=True)
class LinearBBoxGeoReference:
    """Linear pixel-to-lon/lat conversion for a cropped rectangular map."""

    width: int
    height: int
    bbox: BBox
    x_min: float = 0.0
    y_min: float = 0.0
    x_max: float | None = None
    y_max: float | None = None
    method_name: str = "color_segmentation_linear_bbox_georef"
    accuracy: str = "approximate_from_rendered_image"

    def __post_init__(self) -> None:
        if self.width < 2 or self.height < 2:
            raise ValueError("image width and height must be at least 2 pixels")
        if self.pixel_max_x <= self.x_min:
            raise ValueError("map rect x_max must be greater than x_min")
        if self.pixel_max_y <= self.y_min:
            raise ValueError("map rect y_max must be greater than y_min")

    @property
    def pixel_max_x(self) -> float:
        return float(self.x_max if self.x_max is not None else self.width - 1)

    @property
    def pixel_max_y(self) -> float:
        return float(self.y_max if self.y_max is not None else self.height - 1)

    def pixel_to_lonlat(self, point: PixelPoint) -> LonLatPoint:
        x_ratio = (point.x - self.x_min) / (self.pixel_max_x - self.x_min)
        y_ratio = (point.y - self.y_min) / (self.pixel_max_y - self.y_min)
        lon = self.bbox.min_lon + x_ratio * (self.bbox.max_lon - self.bbox.min_lon)
        lat = self.bbox.max_lat - y_ratio * (self.bbox.max_lat - self.bbox.min_lat)
        return LonLatPoint(lon=lon, lat=lat)

    def polygon_to_lonlat(self, polygon: list[PixelPoint]) -> list[LonLatPoint]:
        if len(polygon) < 3:
            raise ValueError("polygon must contain at least three points")
        return [self.pixel_to_lonlat(point) for point in polygon]

    def geojson_properties(self) -> dict[str, Any]:
        return {
            "georef_model": "linear_bbox",
            "accuracy": self.accuracy,
        }


@dataclass(frozen=True)
class ControlPoint:
    name: str
    pixel: PixelPoint
    lonlat: LonLatPoint

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "ControlPoint":
        try:
            pixel = value["pixel"]
            return cls(
                name=str(value["name"]),
                pixel=PixelPoint(x=float(pixel[0]), y=float(pixel[1])),
                lonlat=LonLatPoint(lon=float(value["lon"]), lat=float(value["lat"])),
            )
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise ValueError(f"invalid control point: {value}") from exc


@dataclass(frozen=True)
class CalibrationResidual:
    name: str
    residual_m: float
    expected: LonLatPoint
    predicted: LonLatPoint


@dataclass(frozen=True)
class PolynomialControlPointGeoReference:
    """Pixel-to-lon/lat model fitted from map control points in Web Mercator space."""

    width: int
    height: int
    control_points: list[ControlPoint]
    degree: int = 2
    calibration_name: str = "control_point_calibration"
    source_width: int | None = None
    source_height: int | None = None
    method_name: str = "color_segmentation_polynomial_control_point_georef"
    accuracy: str = "calibrated_from_rendered_image_control_points"

    def __post_init__(self) -> None:
        if self.width < 2 or self.height < 2:
            raise ValueError("image width and height must be at least 2 pixels")
        if self.degree < 1 or self.degree > 4:
            raise ValueError("calibration degree must be between 1 and 4")
        required = len(polynomial_terms(0.0, 0.0, self.degree))
        if len(self.control_points) < required:
            raise ValueError(f"degree {self.degree} calibration requires at least {required} control points")
        source_width = self.source_width or self.width
        source_height = self.source_height or self.height
        if source_width < 2 or source_height < 2:
            raise ValueError("calibration source image size must be at least 2 pixels")

        matrix: list[list[float]] = []
        target_x: list[float] = []
        target_y: list[float] = []
        for point in self.control_points:
            matrix.append(polynomial_terms(point.pixel.x / source_width, point.pixel.y / source_height, self.degree))
            mercator_x, mercator_y = lonlat_to_web_mercator(point.lonlat)
            target_x.append(mercator_x)
            target_y.append(mercator_y)

        design = np.asarray(matrix, dtype=float)
        coeff_x = np.linalg.lstsq(design, np.asarray(target_x, dtype=float), rcond=None)[0]
        coeff_y = np.linalg.lstsq(design, np.asarray(target_y, dtype=float), rcond=None)[0]
        object.__setattr__(self, "_coeff_x", coeff_x)
        object.__setattr__(self, "_coeff_y", coeff_y)
        object.__setattr__(self, "_residuals", self._calculate_residuals())

    @classmethod
    def from_mapping(cls, value: dict[str, Any], *, width: int, height: int) -> "PolynomialControlPointGeoReference":
        image_size = value.get("image_size") or [width, height]
        control_points = [ControlPoint.from_mapping(item) for item in value.get("control_points", [])]
        return cls(
            width=width,
            height=height,
            source_width=int(image_size[0]),
            source_height=int(image_size[1]),
            control_points=control_points,
            degree=int(value.get("degree", 2)),
            calibration_name=str(value.get("name", "control_point_calibration")),
        )

    @classmethod
    def from_file(cls, path: str | Path, *, width: int, height: int) -> "PolynomialControlPointGeoReference":
        return cls.from_mapping(load_calibration_document(path), width=width, height=height)

    def pixel_to_lonlat(self, point: PixelPoint) -> LonLatPoint:
        terms = np.asarray(polynomial_terms(point.x / self.width, point.y / self.height, self.degree), dtype=float)
        mercator_x = float(terms @ self._coeff_x)
        mercator_y = float(terms @ self._coeff_y)
        return web_mercator_to_lonlat(mercator_x, mercator_y)

    def polygon_to_lonlat(self, polygon: list[PixelPoint]) -> list[LonLatPoint]:
        if len(polygon) < 3:
            raise ValueError("polygon must contain at least three points")
        return [self.pixel_to_lonlat(point) for point in polygon]

    @property
    def residuals(self) -> list[CalibrationResidual]:
        return list(self._residuals)

    def residual_summary(self) -> dict[str, float]:
        residuals = [item.residual_m for item in self.residuals]
        if not residuals:
            return {"mean_m": 0.0, "max_m": 0.0}
        return {
            "mean_m": round(float(np.mean(residuals)), 2),
            "max_m": round(float(np.max(residuals)), 2),
        }

    def calibration_report(self) -> dict[str, Any]:
        summary = self.residual_summary()
        return {
            "name": self.calibration_name,
            "degree": self.degree,
            "control_point_count": len(self.control_points),
            "mean_residual_m": summary["mean_m"],
            "max_residual_m": summary["max_m"],
            "residuals": [
                {
                    "name": item.name,
                    "residual_m": round(item.residual_m, 2),
                    "expected": item.expected.to_position(),
                    "predicted": item.predicted.to_position(),
                }
                for item in sorted(self.residuals, key=lambda residual: residual.residual_m, reverse=True)
            ],
        }

    def geojson_properties(self) -> dict[str, Any]:
        summary = self.residual_summary()
        return {
            "georef_model": "polynomial_control_points",
            "calibration_name": self.calibration_name,
            "calibration_degree": self.degree,
            "control_point_count": len(self.control_points),
            "control_point_mean_residual_m": summary["mean_m"],
            "control_point_max_residual_m": summary["max_m"],
            "accuracy": self.accuracy,
        }

    def _calculate_residuals(self) -> list[CalibrationResidual]:
        residuals: list[CalibrationResidual] = []
        source_width = self.source_width or self.width
        source_height = self.source_height or self.height
        for point in self.control_points:
            normalized_point = PixelPoint(
                x=point.pixel.x * self.width / source_width,
                y=point.pixel.y * self.height / source_height,
            )
            predicted = self.pixel_to_lonlat(normalized_point)
            predicted_x, predicted_y = lonlat_to_web_mercator(predicted)
            expected_x, expected_y = lonlat_to_web_mercator(point.lonlat)
            residuals.append(
                CalibrationResidual(
                    name=point.name,
                    residual_m=math.hypot(predicted_x - expected_x, predicted_y - expected_y),
                    expected=point.lonlat,
                    predicted=predicted,
                )
            )
        return residuals


def load_calibration_document(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as file:
        payload = json.load(file)
    if not isinstance(payload.get("control_points"), list) or not payload["control_points"]:
        raise ValueError(f"{path} must contain a non-empty control_points array")
    return payload


def calibration_ignore_rects(payload: dict[str, Any]) -> list[tuple[int, int, int, int]]:
    rects: list[tuple[int, int, int, int]] = []
    for rect in payload.get("ignore_rects", []):
        if len(rect) != 4:
            raise ValueError(f"invalid ignore rect in calibration: {rect}")
        x1, y1, x2, y2 = [int(value) for value in rect]
        if x1 >= x2 or y1 >= y2:
            raise ValueError(f"invalid ignore rect in calibration: {rect}")
        rects.append((x1, y1, x2, y2))
    return rects

