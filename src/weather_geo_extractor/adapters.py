from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable


JsonFetcher = Callable[[str], dict[str, Any]]

GFS_GUST_THRESHOLDS = (
    (20.8, "level_8", "8级及以上风区", "severe-gale"),
    (17.2, "level_7", "7级风区", "strong-gale"),
    (13.9, "level_6", "6级风区", "gale"),
)

GPM_RAIN_THRESHOLDS = (
    (50.0, "extreme", "极端降水区", "extreme-rain"),
    (20.0, "heavy", "强降水区", "heavy-rain"),
    (10.0, "moderate", "中等降水区", "moderate-rain"),
)


def build_gfs_gust_url(
    *,
    cycle: str,
    forecast_hour: int,
    bbox: tuple[float, float, float, float] | list[float] | None = None,
    resolution: str = "0p25",
    base_url: str = "https://nomads.ncep.noaa.gov/cgi-bin",
) -> str:
    """Build a NOMADS filter URL for GFS surface gust GRIB2 data."""
    parsed_cycle = _parse_gfs_cycle(cycle)
    date = parsed_cycle.strftime("%Y%m%d")
    hour = parsed_cycle.strftime("%H")
    forecast = f"{int(forecast_hour):03d}"
    script = f"filter_gfs_{resolution}.pl"
    query: dict[str, str] = {
        "dir": f"/gfs.{date}/{hour}/atmos",
        "file": f"gfs.t{hour}z.pgrb2.{resolution}.f{forecast}",
        "lev_surface": "on",
        "var_GUST": "on",
    }
    if bbox is not None:
        min_lon, min_lat, max_lon, max_lat = _normalize_bbox(bbox)
        query.update(
            {
                "subregion": "",
                "leftlon": _fmt_number(min_lon),
                "rightlon": _fmt_number(max_lon),
                "toplat": _fmt_number(max_lat),
                "bottomlat": _fmt_number(min_lat),
            }
        )
    return f"{base_url.rstrip('/')}/{script}?{urllib.parse.urlencode(query)}"


def gfs_gust_adapter(grid: dict[str, Any]) -> dict[str, Any]:
    """Convert decoded GFS wind-gust grid JSON into Weather Earth GeoJSON."""
    return _grid_threshold_adapter(
        grid,
        adapter="gfs_gust_adapter",
        weather_type="wind-region",
        source_default="NOAA GFS",
        value_keys=("gust", "wind_gust", "wind_gusts_10m", "values"),
        value_property="observed_value",
        unit_default="m/s",
        thresholds=GFS_GUST_THRESHOLDS,
        collection_name="gfs-gust-wind-regions",
        name_prefix="GFS",
    )


def gpm_imerg_adapter(grid: dict[str, Any]) -> dict[str, Any]:
    """Convert decoded GPM IMERG precipitation-rate grid JSON into Weather Earth GeoJSON."""
    return _grid_threshold_adapter(
        grid,
        adapter="gpm_imerg_adapter",
        weather_type="rain-region",
        source_default="NASA GPM IMERG",
        value_keys=("precipitation", "precipitation_rate", "rain_rate", "values"),
        value_property="precipitation_rate",
        unit_default="mm/h",
        thresholds=GPM_RAIN_THRESHOLDS,
        collection_name="gpm-imerg-rain-regions",
        name_prefix="IMERG",
    )


def open_meteo_point_adapter(
    *,
    latitude: float,
    longitude: float,
    start: str,
    end: str,
    name: str = "Open-Meteo point",
    timezone: str = "Asia/Shanghai",
    endpoint: str = "https://api.open-meteo.com/v1/forecast",
    fetcher: JsonFetcher | None = None,
) -> dict[str, Any]:
    """Fetch Open-Meteo hourly point data and convert it to station evidence features."""
    start_dt = _parse_iso_like_datetime(start)
    end_dt = _parse_iso_like_datetime(end)
    if end_dt < start_dt:
        raise ValueError("end must be greater than or equal to start")
    lat = float(latitude)
    lon = float(longitude)
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError("latitude/longitude out of range")

    query = {
        "latitude": _fmt_number(lat),
        "longitude": _fmt_number(lon),
        "hourly": ",".join(
            [
                "wind_gusts_10m",
                "wind_speed_10m",
                "wind_direction_10m",
                "precipitation",
                "showers",
                "temperature_2m",
            ]
        ),
        "timezone": timezone,
        "wind_speed_unit": "ms",
        "start_date": start_dt.date().isoformat(),
        "end_date": end_dt.date().isoformat(),
    }
    url = f"{endpoint}?{urllib.parse.urlencode(query)}"
    payload = (fetcher or fetch_json)(url)
    hourly = payload.get("hourly") or {}
    units = payload.get("hourly_units") or {}
    times = hourly.get("time") or []
    features: list[dict[str, Any]] = []
    for index, time_value in enumerate(times):
        current_dt = _parse_iso_like_datetime(str(time_value))
        if current_dt < start_dt or current_dt > end_dt:
            continue
        gust = _series_value(hourly, "wind_gusts_10m", index)
        wind_speed = _series_value(hourly, "wind_speed_10m", index)
        precipitation = _series_value(hourly, "precipitation", index)
        showers = _series_value(hourly, "showers", index)
        if gust is None and wind_speed is None and precipitation is None and showers is None:
            continue
        level, level_label, intensity = _threshold_match(float(gust or wind_speed or 0), GFS_GUST_THRESHOLDS) or (
            "observed",
            "站点观测",
            "point-weather",
        )
        properties = {
            "weather_type": "station",
            "name": name,
            "time": str(time_value),
            "valid_time": str(time_value),
            "level": level,
            "intensity": intensity,
            "observed_value": gust,
            "unit": units.get("wind_gusts_10m") or "m/s",
            "wind_speed": wind_speed,
            "wind_speed_unit": units.get("wind_speed_10m") or "m/s",
            "wind_direction": _series_value(hourly, "wind_direction_10m", index),
            "wind_direction_unit": units.get("wind_direction_10m") or "degree",
            "precipitation": precipitation,
            "precipitation_unit": units.get("precipitation") or "mm",
            "showers": showers,
            "temperature_2m": _series_value(hourly, "temperature_2m", index),
            "source": "Open-Meteo Forecast API",
            "source_url": url,
            "confidence": 0.66,
            "narrative": f"{name} {time_value} 开放点位数据：{level_label}。",
        }
        features.append(
            {
                "type": "Feature",
                "properties": _drop_none(properties),
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            }
        )
    return {
        "type": "FeatureCollection",
        "name": "open-meteo-point-weather",
        "metadata": {
            "adapter": "open_meteo_point_adapter",
            "source": "Open-Meteo",
            "source_url": url,
            "schema": "weather-earth-geojson-v1",
            "projection": "WGS84 lon/lat",
        },
        "features": features,
    }


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def fetch_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _grid_threshold_adapter(
    grid: dict[str, Any],
    *,
    adapter: str,
    weather_type: str,
    source_default: str,
    value_keys: tuple[str, ...],
    value_property: str,
    unit_default: str,
    thresholds: tuple[tuple[float, str, str, str], ...],
    collection_name: str,
    name_prefix: str,
) -> dict[str, Any]:
    lons = [float(value) for value in grid.get("lons") or grid.get("longitudes") or grid.get("longitude") or []]
    lats = [float(value) for value in grid.get("lats") or grid.get("latitudes") or grid.get("latitude") or []]
    values = _grid_values(grid, value_keys)
    if not lons or not lats:
        raise ValueError("grid JSON requires lons/longitudes and lats/latitudes arrays")
    if len(values) != len(lats) or any(len(row) != len(lons) for row in values):
        raise ValueError("grid values must be shaped as len(lats) x len(lons)")

    source = str(grid.get("source") or source_default)
    source_url = str(grid.get("source_url") or grid.get("url") or "")
    time_value = str(grid.get("time") or grid.get("valid_time") or grid.get("validTime") or "")
    forecast_time = str(grid.get("forecast_time") or grid.get("forecastTime") or time_value)
    unit = str(grid.get("unit") or unit_default)
    features: list[dict[str, Any]] = []
    for lat_index, row in enumerate(values):
        for lon_index, raw_value in enumerate(row):
            if raw_value is None:
                continue
            value = float(raw_value)
            matched = _threshold_match(value, thresholds)
            if not matched:
                continue
            level, level_label, intensity = matched
            properties = {
                "weather_type": weather_type,
                "name": f"{name_prefix} {level_label}",
                "time": time_value,
                "valid_time": forecast_time,
                "level": level,
                "intensity": intensity,
                value_property: round(value, 3),
                "unit": unit,
                "source": source,
                "source_url": source_url or None,
                "confidence": float(grid.get("confidence", 0.7)),
                "grid_i": lon_index,
                "grid_j": lat_index,
                "narrative": f"{source} 开放网格数据超过 {level_label} 阈值。",
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": _drop_none(properties),
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [_cell_ring(lons, lats, lon_index, lat_index)],
                    },
                }
            )
    return {
        "type": "FeatureCollection",
        "name": collection_name,
        "metadata": {
            "adapter": adapter,
            "source": source,
            "source_url": source_url or None,
            "schema": "weather-earth-geojson-v1",
            "projection": "WGS84 lon/lat",
            "feature_strategy": "one-threshold-cell-per-feature",
        },
        "features": features,
    }


def _grid_values(grid: dict[str, Any], keys: Iterable[str]) -> list[list[float | None]]:
    raw: Any = None
    for key in keys:
        if key in grid:
            raw = grid[key]
            break
    if raw is None:
        raise ValueError(f"grid JSON requires one value array: {', '.join(keys)}")
    if not isinstance(raw, list):
        raise ValueError("grid value array must be a list")
    if raw and all(not isinstance(item, list) for item in raw):
        width = len(grid.get("lons") or grid.get("longitudes") or grid.get("longitude") or [])
        if width <= 0 or len(raw) % width:
            raise ValueError("flat grid value array requires a width matching lons")
        raw = [raw[index : index + width] for index in range(0, len(raw), width)]
    return [[None if value is None else float(value) for value in row] for row in raw]


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


def _parse_gfs_cycle(value: str) -> datetime:
    raw = str(value).strip()
    for date_format in ("%Y%m%d%H", "%Y-%m-%dT%H", "%Y-%m-%d %H"):
        try:
            parsed = datetime.strptime(raw, date_format)
            if parsed.hour not in {0, 6, 12, 18}:
                raise ValueError("GFS cycle hour must be 00, 06, 12, or 18 UTC")
            return parsed
        except ValueError:
            continue
    raise ValueError("cycle must be like 2026061000 or 2026-06-10T00")


def _parse_iso_like_datetime(value: str) -> datetime:
    raw = str(value).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError("time must be ISO-like, e.g. 2026-06-10T18:00") from exc


def _normalize_bbox(values: tuple[float, float, float, float] | list[float]) -> tuple[float, float, float, float]:
    if len(values) != 4:
        raise ValueError("bbox must contain min_lon min_lat max_lon max_lat")
    min_lon, min_lat, max_lon, max_lat = [float(value) for value in values]
    if min_lon >= max_lon or min_lat >= max_lat:
        raise ValueError("bbox values must be ordered")
    return min_lon, min_lat, max_lon, max_lat


def _fmt_number(value: float) -> str:
    return f"{float(value):g}"


def _series_value(hourly: dict[str, Any], key: str, index: int) -> float | None:
    values = hourly.get(key)
    if not isinstance(values, list) or index >= len(values) or values[index] is None:
        return None
    return float(values[index])


def _drop_none(properties: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in properties.items() if value is not None and value != ""}
