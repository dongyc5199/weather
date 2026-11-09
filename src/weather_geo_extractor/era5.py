"""ERA5 reanalysis multi-level vertical stacking adapter.

P0 plan: ERA5 single-dataset multi-level vertical stacking.

Supports:
  - Fetching ERA5 pressure-level data via CDS API (when ``cdsapi`` is available).
  - Converting decoded ERA5 grid JSON into Weather Earth GeoJSON with vertical
    pressure-level stacking (temperature, geopotential, wind, humidity profiles).
  - Generating synthetic example data for testing without CDS credentials.

The output GeoJSON schema is compatible with ``viewer/earth.html`` — each
pressure level becomes a feature collection layer that can be toggled and
visualised as 3D extruded volumes or colour-mapped surfaces.
"""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

JsonFetcher = Callable[[str], dict[str, Any]]

# Standard pressure levels (hPa) shared across ERA5, MERRA-2, CFSR, JRA-55, NCEP R1.
STANDARD_PRESSURE_LEVELS = (
    1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30, 20, 10,
)

# ERA5 pressure-level variable name mapping: ERA5 short name -> display metadata.
ERA5_PRESSURE_VARIABLES: dict[str, dict[str, str]] = {
    "t": {"label": "气温", "unit": "K", "english": "Temperature", "weather_type": "temperature-region"},
    "z": {"label": "位势高度", "unit": "m²/s²", "english": "Geopotential", "weather_type": "geopotential-region"},
    "u": {"label": "纬向风", "unit": "m/s", "english": "U-component wind", "weather_type": "wind-region"},
    "v": {"label": "经向风", "unit": "m/s", "english": "V-component wind", "weather_type": "wind-region"},
    "q": {"label": "比湿", "unit": "kg/kg", "english": "Specific humidity", "weather_type": "humidity-region"},
    "r": {"label": "相对湿度", "unit": "%", "english": "Relative humidity", "weather_type": "humidity-region"},
    "w": {"label": "垂直速度", "unit": "Pa/s", "english": "Vertical velocity", "weather_type": "vertical-motion"},
    "vo": {"label": "涡度", "unit": "s⁻¹", "english": "Vorticity", "weather_type": "vorticity-region"},
    "d": {"label": "散度", "unit": "s⁻¹", "english": "Divergence", "weather_type": "divergence-region"},
}

# Temperature thresholds (°C) for surface-like colour mapping at each pressure level.
TEMPERATURE_THRESHOLDS = (
    (35.0, "extreme_heat", "极端高温区", "extreme-heat"),
    (30.0, "heat", "高温区", "heat"),
    (25.0, "warm", "温暖区", "warm"),
    (15.0, "mild", "温和区", "mild"),
    (5.0, "cool", "凉爽区", "cool"),
    (-5.0, "cold", "寒冷区", "cold"),
    (-999.0, "extreme_cold", "极端寒冷区", "extreme-cold"),
)

# Wind speed thresholds (m/s) derived from U/V components.
WIND_THRESHOLDS = (
    (24.5, "level_10", "10级以上风区", "storm"),
    (20.8, "level_9", "9级风区", "strong-gale"),
    (17.2, "level_8", "8级风区", "gale"),
    (13.9, "level_7", "7级风区", "near-gale"),
    (10.8, "level_6", "6级风区", "strong-breeze"),
    (5.5, "level_4", "4级风区", "moderate-breeze"),
)

# Relative humidity thresholds (%).
HUMIDITY_THRESHOLDS = (
    (90.0, "very_humid", "极湿区", "very-humid"),
    (80.0, "humid", "湿润区", "humid"),
    (60.0, "moderate_humidity", "中等湿度区", "moderate-humidity"),
    (40.0, "dry", "干燥区", "dry"),
    (0.0, "very_dry", "极干区", "very-dry"),
)


def era5_vertical_profile_adapter(
    grid: dict[str, Any],
    *,
    variable: str = "t",
    levels: Sequence[int] | None = None,
) -> dict[str, Any]:
    """Convert decoded ERA5 pressure-level grid JSON into stacked Weather Earth GeoJSON.

    The input ``grid`` follows this structure::

        {
          "source": "ERA5",
          "time": "2026-06-10T18:00:00Z",
          "variable": "t",
          "unit": "K",
          "levels": [1000, 850, 500, 200],
          "lons": [100.0, 100.25, 100.5],
          "lats": [40.0, 39.75, 39.5],
          "data": {
            "1000": [[290, 291, 292], [289, 290, 291], [288, 289, 290]],
            "850":  [[285, 286, 287], ...],
            ...
          }
        }

    Each pressure level produces a FeatureCollection layer. The full output is a
    ``FeatureCollection`` whose ``metadata`` records the vertical stacking plan so
    the viewer can render 3D extruded volumes or toggle individual levels.
    """
    var_meta = ERA5_PRESSURE_VARIABLES.get(variable)
    if var_meta is None:
        raise ValueError(
            f"unsupported ERA5 variable '{variable}'; supported: {', '.join(ERA5_PRESSURE_VARIABLES)}"
        )

    lons = _axis(grid, "lons", "longitudes", "longitude")
    lats = _axis(grid, "lats", "latitudes", "latitude")
    if not lons or not lats:
        raise ValueError("grid JSON requires lons/longitudes and lats/latitudes arrays")

    raw_levels = list(levels or grid.get("levels") or [])
    if not raw_levels:
        raise ValueError("grid JSON requires a 'levels' array of pressure levels (hPa)")

    level_values: list[int] = [int(lv) for lv in raw_levels]
    data_block = grid.get("data") or grid.get("levels_data") or {}
    if not isinstance(data_block, dict) or not data_block:
        raise ValueError("grid JSON requires a 'data' dict keyed by pressure level")

    source = str(grid.get("source") or "ERA5")
    source_url = str(grid.get("source_url") or grid.get("url") or "")
    time_value = str(grid.get("time") or grid.get("valid_time") or "")
    unit = str(grid.get("unit") or var_meta["unit"])
    confidence = float(grid.get("confidence", 0.85))

    thresholds = _select_thresholds(variable)
    features: list[dict[str, Any]] = []
    layer_summaries: list[dict[str, Any]] = []

    for level in level_values:
        key = str(level)
        level_grid = data_block.get(key) or data_block.get(key + "hPa")
        if level_grid is None:
            continue
        rows = _grid_values(level_grid, lons)
        level_features: list[dict[str, Any]] = []
        level_min = math.inf
        level_max = -math.inf
        level_count = 0

        for lat_index, row in enumerate(rows):
            for lon_index, raw_value in enumerate(row):
                if raw_value is None:
                    continue
                value = float(raw_value)
                level_min = min(level_min, value)
                level_max = max(level_max, value)
                level_count += 1

                # Convert temperature from Kelvin to Celsius for threshold matching.
                display_value = value - 273.15 if variable == "t" and unit.upper().startswith("K") else value
                matched = _threshold_match(display_value, thresholds) if thresholds else None
                if matched:
                    level_key, level_label, intensity = matched
                else:
                    level_key = "observed"
                    level_label = var_meta["label"]
                    intensity = var_meta["weather_type"]

                # Estimate altitude from pressure level (barometric formula).
                altitude_m = _pressure_to_altitude(level)

                properties = {
                    "weather_type": var_meta["weather_type"],
                    "name": f"ERA5 {var_meta['label']} {level}hPa",
                    "time": time_value,
                    "valid_time": time_value,
                    "level": level_key,
                    "intensity": intensity,
                    "variable": variable,
                    "variable_label": var_meta["label"],
                    "variable_english": var_meta["english"],
                    "pressure_level_hpa": level,
                    "altitude_m": round(altitude_m, 1),
                    "observed_value": round(value, 3),
                    "display_value": round(display_value, 3),
                    "unit": unit,
                    "display_unit": "°C" if variable == "t" and unit.upper().startswith("K") else unit,
                    "source": source,
                    "source_url": source_url or None,
                    "confidence": confidence,
                    "vertical_stacking": True,
                    "grid_i": lon_index,
                    "grid_j": lat_index,
                    "narrative": f"{source} {var_meta['label']} {level}hPa 垂直层叠加。",
                }
                level_features.append(
                    {
                        "type": "Feature",
                        "properties": _drop_none(properties),
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [_cell_ring(lons, lats, lon_index, lat_index)],
                        },
                    }
                )

        features.extend(level_features)
        layer_summaries.append(
            {
                "pressure_level_hpa": level,
                "altitude_m": round(_pressure_to_altitude(level), 1),
                "feature_count": level_count,
                "min_value": round(level_min, 3) if level_min != math.inf else None,
                "max_value": round(level_max, 3) if level_max != math.inf else None,
                "unit": unit,
            }
        )

    return {
        "type": "FeatureCollection",
        "name": f"era5-{variable}-vertical-profile",
        "metadata": {
            "adapter": "era5_vertical_profile_adapter",
            "source": source,
            "source_url": source_url or None,
            "schema": "weather-earth-geojson-v1",
            "projection": "WGS84 lon/lat",
            "vertical_stacking": True,
            "variable": variable,
            "variable_label": var_meta["label"],
            "variable_english": var_meta["english"],
            "unit": unit,
            "pressure_levels": level_values,
            "levels": layer_summaries,
            "feature_strategy": "one-cell-per-level-per-feature",
            "time": time_value,
            "confidence": confidence,
        },
        "features": features,
    }


def era5_wind_composite_adapter(grid: dict[str, Any], *, levels: Sequence[int] | None = None) -> dict[str, Any]:
    """Convert ERA5 U+V wind components into wind-speed vertical stacking GeoJSON.

    The input grid provides both ``u`` and ``v`` data blocks keyed by pressure level.
    The output features carry ``wind_speed``, ``wind_direction``, ``u``, and ``v``
    properties for each cell at each level.
    """
    lons = _axis(grid, "lons", "longitudes", "longitude")
    lats = _axis(grid, "lats", "latitudes", "latitude")
    if not lons or not lats:
        raise ValueError("grid JSON requires lons/longitudes and lats/latitudes arrays")

    raw_levels = list(levels or grid.get("levels") or [])
    if not raw_levels:
        raise ValueError("grid JSON requires a 'levels' array of pressure levels (hPa)")

    level_values: list[int] = [int(lv) for lv in raw_levels]
    u_data = grid.get("u") or grid.get("u_data") or {}
    v_data = grid.get("v") or grid.get("v_data") or {}
    if not u_data or not v_data:
        raise ValueError("wind composite grid requires 'u' and 'v' data blocks keyed by pressure level")

    source = str(grid.get("source") or "ERA5")
    source_url = str(grid.get("source_url") or grid.get("url") or "")
    time_value = str(grid.get("time") or grid.get("valid_time") or "")
    confidence = float(grid.get("confidence", 0.85))
    features: list[dict[str, Any]] = []
    layer_summaries: list[dict[str, Any]] = []

    for level in level_values:
        key = str(level)
        u_rows = _grid_values(u_data.get(key) or u_data.get(key + "hPa") or [], lons)
        v_rows = _grid_values(v_data.get(key) or v_data.get(key + "hPa") or [], lons)
        level_count = 0
        level_max_speed = 0.0
        level_features: list[dict[str, Any]] = []

        for lat_index, u_row in enumerate(u_rows):
            v_row = v_rows[lat_index] if lat_index < len(v_rows) else []
            for lon_index, u_value in enumerate(u_row):
                if u_value is None:
                    continue
                v_value = v_row[lon_index] if lon_index < len(v_row) else None
                if v_value is None:
                    continue
                speed = math.hypot(u_value, v_value)
                direction = (math.degrees(math.atan2(v_value, u_value)) + 180) % 360
                level_max_speed = max(level_max_speed, speed)
                level_count += 1
                matched = _threshold_match(speed, WIND_THRESHOLDS)
                if matched:
                    level_key, level_label, intensity = matched
                else:
                    level_key, level_label, intensity = "calm", "静风区", "calm"
                altitude_m = _pressure_to_altitude(level)
                properties = {
                    "weather_type": "wind-region",
                    "name": f"ERA5 风场 {level}hPa",
                    "time": time_value,
                    "valid_time": time_value,
                    "level": level_key,
                    "intensity": intensity,
                    "pressure_level_hpa": level,
                    "altitude_m": round(altitude_m, 1),
                    "wind_speed": round(speed, 3),
                    "wind_direction": round(direction, 1),
                    "u": round(u_value, 3),
                    "v": round(v_value, 3),
                    "unit": "m/s",
                    "source": source,
                    "source_url": source_url or None,
                    "confidence": confidence,
                    "vertical_stacking": True,
                    "grid_i": lon_index,
                    "grid_j": lat_index,
                    "narrative": f"{source} 风场 {level}hPa 垂直层叠加，风速 {round(speed, 1)} m/s。",
                }
                level_features.append(
                    {
                        "type": "Feature",
                        "properties": _drop_none(properties),
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [_cell_ring(lons, lats, lon_index, lat_index)],
                        },
                    }
                )

        features.extend(level_features)
        layer_summaries.append(
            {
                "pressure_level_hpa": level,
                "altitude_m": round(_pressure_to_altitude(level), 1),
                "feature_count": level_count,
                "max_wind_speed": round(level_max_speed, 3),
                "unit": "m/s",
            }
        )

    return {
        "type": "FeatureCollection",
        "name": "era5-wind-vertical-composite",
        "metadata": {
            "adapter": "era5_wind_composite_adapter",
            "source": source,
            "source_url": source_url or None,
            "schema": "weather-earth-geojson-v1",
            "projection": "WGS84 lon/lat",
            "vertical_stacking": True,
            "variable": "wind",
            "variable_label": "风场合成",
            "unit": "m/s",
            "pressure_levels": level_values,
            "levels": layer_summaries,
            "feature_strategy": "wind-composite-per-level-per-feature",
            "time": time_value,
            "confidence": confidence,
        },
        "features": features,
    }


def build_era5_cds_request(
    *,
    variable: str,
    pressure_levels: Sequence[int],
    year: int,
    month: int,
    day: int,
    hour: int,
    bbox: tuple[float, float, float, float] | None = None,
    dataset: str = "reanalysis-era5-pressure-levels",
) -> dict[str, Any]:
    """Build a CDS API request payload for ERA5 pressure-level data.

    Returns a dict that can be passed to ``cdsapi.Client().retrieve()``.
    """
    var_meta = ERA5_PRESSURE_VARIABLES.get(variable)
    if var_meta is None:
        raise ValueError(f"unsupported ERA5 variable '{variable}'")

    era5_var_name = _era5_cds_variable_name(variable)
    request: dict[str, Any] = {
        "product_type": "reanalysis",
        "variable": era5_var_name,
        "pressure_level": [str(lv) for lv in pressure_levels],
        "year": f"{year:04d}",
        "month": f"{month:02d}",
        "day": f"{day:02d}",
        "time": f"{hour:02d}:00",
        "format": "netcdf",
    }
    if bbox is not None:
        min_lon, min_lat, max_lon, max_lat = _normalize_bbox(bbox)
        request["area"] = [max_lat, min_lon, min_lat, max_lon]  # CDS: north, west, south, east
    return {"dataset": dataset, "request": request}


def era5_example_grid(
    *,
    variable: str = "t",
    levels: Sequence[int] | None = None,
    bbox: tuple[float, float, float, float] = (100.0, 35.0, 120.0, 45.0),
    resolution: float = 1.0,
    time_value: str = "2026-06-10T18:00:00Z",
) -> dict[str, Any]:
    """Generate a synthetic ERA5-like grid for testing without CDS credentials.

    Produces physically plausible values that decrease with altitude for
    temperature and vary smoothly for other variables.
    """
    var_meta = ERA5_PRESSURE_VARIABLES.get(variable)
    if var_meta is None:
        raise ValueError(f"unsupported ERA5 variable '{variable}'")

    target_levels = list(levels or [1000, 850, 700, 500, 300, 200])
    min_lon, min_lat, max_lon, max_lat = bbox
    lons = _arange(min_lon, max_lon, resolution)
    lats = list(reversed(_arange(min_lat, max_lat, resolution)))
    data_block: dict[str, list[list[float]]] = {}

    for level in target_levels:
        rows: list[list[float]] = []
        base_temp_k = _pressure_to_temperature(level)
        for lat in lats:
            row: list[float] = []
            for lon in lons:
                if variable == "t":
                    # Temperature decreases poleward and with longitude variation.
                    lat_factor = (45.0 - lat) * 0.6
                    lon_factor = math.sin(math.radians((lon - 100) * 6)) * 1.5
                    row.append(round(base_temp_k + lat_factor + lon_factor, 2))
                elif variable == "z":
                    # Geopotential roughly scales with altitude.
                    alt = _pressure_to_altitude(level)
                    row.append(round(9.80665 * alt, 1))
                elif variable == "u":
                    # Zonal wind: jet stream around 200-300 hPa, easterlies near surface.
                    jet_factor = 25.0 * math.exp(-((level - 250) / 120) ** 2)
                    lat_factor = math.sin(math.radians((lat - 40) * 3)) * 5
                    row.append(round(jet_factor + lat_factor, 2))
                elif variable == "v":
                    # Meridional wind: weaker, sinusoidal.
                    row.append(round(math.sin(math.radians((lon - 100) * 4)) * 3, 2))
                elif variable == "q":
                    # Specific humidity decreases rapidly with altitude.
                    base_q = 0.012 * (level / 1000.0) ** 3
                    row.append(round(base_q + math.sin(math.radians(lat * 5)) * 0.001, 5))
                elif variable == "r":
                    # Relative humidity: higher near surface, variable aloft.
                    base_rh = 40 + (level / 1000.0) * 50
                    row.append(round(min(100, base_rh + math.sin(math.radians(lon * 4)) * 15), 1))
                elif variable == "w":
                    # Vertical velocity: small values, sign varies.
                    row.append(round(math.sin(math.radians((lon + lat) * 5)) * 0.05, 4))
                elif variable == "vo":
                    row.append(round(math.sin(math.radians(lat * 6)) * 2e-5, 8))
                elif variable == "d":
                    row.append(round(math.cos(math.radians(lon * 6)) * 2e-5, 8))
                else:
                    row.append(0.0)
            rows.append(row)
        data_block[str(level)] = rows

    return {
        "source": "ERA5",
        "source_url": "https://cds.climate.copernicus.eu/",
        "time": time_value,
        "variable": variable,
        "unit": var_meta["unit"],
        "levels": target_levels,
        "lons": lons,
        "lats": lats,
        "data": data_block,
        "confidence": 0.85,
    }


def era5_wind_example_grid(
    *,
    levels: Sequence[int] | None = None,
    bbox: tuple[float, float, float, float] = (100.0, 35.0, 120.0, 45.0),
    resolution: float = 1.0,
    time_value: str = "2026-06-10T18:00:00Z",
) -> dict[str, Any]:
    """Generate a synthetic ERA5-like U+V wind grid for testing."""
    target_levels = list(levels or [1000, 850, 700, 500, 300, 200])
    min_lon, min_lat, max_lon, max_lat = bbox
    lons = _arange(min_lon, max_lon, resolution)
    lats = list(reversed(_arange(min_lat, max_lat, resolution)))
    u_data: dict[str, list[list[float]]] = {}
    v_data: dict[str, list[list[float]]] = {}

    for level in target_levels:
        u_rows: list[list[float]] = []
        v_rows: list[list[float]] = []
        jet_factor = 25.0 * math.exp(-((level - 250) / 120) ** 2)
        for lat in lats:
            u_row: list[float] = []
            v_row: list[float] = []
            for lon in lons:
                u_val = jet_factor + math.sin(math.radians((lat - 40) * 3)) * 5
                v_val = math.sin(math.radians((lon - 100) * 4)) * 3 + math.cos(math.radians(lat * 5)) * 2
                u_row.append(round(u_val, 2))
                v_row.append(round(v_val, 2))
            u_rows.append(u_row)
            v_rows.append(v_row)
        u_data[str(level)] = u_rows
        v_data[str(level)] = v_rows

    return {
        "source": "ERA5",
        "source_url": "https://cds.climate.copernicus.eu/",
        "time": time_value,
        "levels": target_levels,
        "lons": lons,
        "lats": lats,
        "u": u_data,
        "v": v_data,
        "confidence": 0.85,
    }


def _era5_cds_variable_name(variable: str) -> str:
    """Map internal short names to ERA5 CDS variable names."""
    mapping = {
        "t": "temperature",
        "z": "geopotential",
        "u": "u_component_of_wind",
        "v": "v_component_of_wind",
        "q": "specific_humidity",
        "r": "relative_humidity",
        "w": "vertical_velocity",
        "vo": "vorticity",
        "d": "divergence",
    }
    if variable not in mapping:
        raise ValueError(f"no CDS variable name for '{variable}'")
    return mapping[variable]


def _pressure_to_altitude(pressure_hpa: float) -> float:
    """Convert pressure level (hPa) to approximate altitude (m) using the barometric formula."""
    return 44330.0 * (1.0 - (pressure_hpa / 1013.25) ** 0.1903)


def _pressure_to_temperature(pressure_hpa: float) -> float:
    """Estimate standard atmospheric temperature (K) at a pressure level."""
    altitude = _pressure_to_altitude(pressure_hpa)
    return max(216.65, 288.15 - 0.0065 * altitude)


def _select_thresholds(variable: str) -> tuple[tuple[float, str, str, str], ...] | None:
    if variable == "t":
        return TEMPERATURE_THRESHOLDS
    if variable in ("u", "v"):
        return WIND_THRESHOLDS
    if variable in ("q", "r"):
        return HUMIDITY_THRESHOLDS
    return None


def _axis(grid: dict[str, Any], *keys: str) -> list[float]:
    for key in keys:
        raw = grid.get(key)
        if raw:
            return [float(v) for v in raw]
    return []


def _grid_values(level_grid: Any, lons: list[float]) -> list[list[float | None]]:
    if not isinstance(level_grid, list):
        raise ValueError("level grid data must be a list of rows")
    if level_grid and all(not isinstance(item, list) for item in level_grid):
        width = len(lons)
        if width <= 0 or len(level_grid) % width:
            raise ValueError("flat level grid array requires a width matching lons")
        level_grid = [level_grid[i : i + width] for i in range(0, len(level_grid), width)]
    return [[None if v is None else float(v) for v in row] for row in level_grid]


def _threshold_match(
    value: float,
    thresholds: tuple[tuple[float, str, str, str], ...],
) -> tuple[str, str, str] | None:
    for threshold, level, label, intensity in thresholds:
        if value >= threshold:
            return level, label, intensity
    return None


def _cell_ring(lons: list[float], lats: list[float], lon_index: int, lat_index: int) -> list[list[float]]:
    west, east = _axis_cell_bounds(lons, lon_index)
    south, north = _axis_cell_bounds(lats, lat_index)
    west, east = min(west, east), max(west, east)
    south, north = min(south, north), max(south, north)
    return [
        [round(west, 6), round(south, 6)],
        [round(east, 6), round(south, 6)],
        [round(east, 6), round(north, 6)],
        [round(west, 6), round(north, 6)],
        [round(west, 6), round(south, 6)],
    ]


def _axis_cell_bounds(values: list[float], index: int) -> tuple[float, float]:
    if len(values) == 1:
        return values[index] - 0.125, values[index] + 0.125
    if index == 0:
        step = values[1] - values[0]
        return values[0] - step / 2, (values[0] + values[1]) / 2
    if index == len(values) - 1:
        step = values[-1] - values[-2]
        return (values[-2] + values[-1]) / 2, values[-1] + step / 2
    return (values[index - 1] + values[index]) / 2, (values[index] + values[index + 1]) / 2


def _arange(start: float, stop: float, step: float) -> list[float]:
    values: list[float] = []
    current = start
    while current <= stop + step * 0.001:
        values.append(round(current, 6))
        current += step
    return values


def _normalize_bbox(values: tuple[float, float, float, float] | list[float]) -> tuple[float, float, float, float]:
    if len(values) != 4:
        raise ValueError("bbox must contain min_lon min_lat max_lon max_lat")
    min_lon, min_lat, max_lon, max_lat = [float(v) for v in values]
    if min_lon >= max_lon or min_lat >= max_lat:
        raise ValueError("bbox values must be ordered")
    return min_lon, min_lat, max_lon, max_lat


def _drop_none(properties: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in properties.items() if value is not None and value != ""}


def fetch_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))
