"""Multi-source reanalysis fusion adapters (P1 plan).

P1-A: ERA5 + MERRA-2 weighted fusion for temperature / pressure-level fields.
P1-B: ERA5 atmosphere + CFSR ocean coupling for sea-air interaction diagnostics.

Both adapters accept decoded grid JSON from multiple datasets, align them to a
common spatial grid via bilinear interpolation, and produce a unified Weather
Earth GeoJSON that carries source attribution and per-cell fusion uncertainty.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Sequence

JsonFetcher = Callable[[str], dict[str, Any]]

# Datasets supported in multi-source fusion.
SUPPORTED_DATASETS = ("era5", "merra2", "cfsr", "jra55", "ncep_r1")

DATASET_METADATA: dict[str, dict[str, Any]] = {
    "era5": {"label": "ERA5", "resolution_deg": 0.25, "time_step_hours": 1, "levels": 37, "provider": "ECMWF"},
    "merra2": {"label": "MERRA-2", "resolution_deg": 0.5, "time_step_hours": 1, "levels": 72, "provider": "NASA GMAO"},
    "cfsr": {"label": "CFSR", "resolution_deg": 0.3, "time_step_hours": 6, "levels": 64, "provider": "NCEP"},
    "jra55": {"label": "JRA-55", "resolution_deg": 0.5625, "time_step_hours": 6, "levels": 37, "provider": "JMA"},
    "ncep_r1": {"label": "NCEP/NCAR R1", "resolution_deg": 2.5, "time_step_hours": 6, "levels": 17, "provider": "NCEP/NCAR"},
}

# Default fusion weights — higher resolution and more recent systems get higher weight.
DEFAULT_FUSION_WEIGHTS: dict[str, float] = {
    "era5": 0.50,
    "merra2": 0.30,
    "jra55": 0.20,
}

# Ocean depth levels (m) used by CFSR.
CFSR_OCEAN_DEPTH_LEVELS = (0, 5, 15, 25, 35, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000)


def multi_source_fusion_adapter(
    sources: list[dict[str, Any]],
    *,
    variable: str = "t",
    level: int | None = None,
    weights: dict[str, float] | None = None,
    target_lons: list[float] | None = None,
    target_lats: list[float] | None = None,
) -> dict[str, Any]:
    """Fuse multiple reanalysis datasets into a single weighted-average GeoJSON.

    Each source in ``sources`` is a dict with::

        {
          "dataset": "era5",
          "lons": [...],
          "lats": [...],
          "values": [[...], ...],          # for single-level
          "data": {"1000": [[...]], ...},   # for pressure-level (optional)
          "time": "2026-06-10T18:00Z",
          "unit": "K",
        }

    The output is a FeatureCollection where each cell carries the fused value,
    per-source values, and fusion uncertainty (weighted standard deviation).
    """
    if not sources:
        raise ValueError("fusion requires at least one source dataset")
    if len(sources) < 2:
        raise ValueError("multi-source fusion requires at least two datasets")

    # Validate dataset identifiers and normalise weights.
    fusion_weights = dict(weights or DEFAULT_FUSION_WEIGHTS)
    total_weight = 0.0
    for src in sources:
        ds = str(src.get("dataset", "")).strip().lower()
        if ds not in SUPPORTED_DATASETS:
            raise ValueError(f"unsupported dataset '{ds}'; supported: {', '.join(SUPPORTED_DATASETS)}")
        if ds not in fusion_weights:
            fusion_weights[ds] = 1.0 / len(sources)
        total_weight += fusion_weights[ds]
    if total_weight <= 0:
        raise ValueError("fusion weights must sum to a positive value")

    # Determine target grid: use provided target or the first source grid.
    ref = sources[0]
    target_lon_axis = target_lons or _axis(ref, "lons", "longitudes", "longitude")
    target_lat_axis = target_lats or _axis(ref, "lats", "latitudes", "latitude")
    if not target_lon_axis or not target_lat_axis:
        raise ValueError("fusion requires a target grid (lons/lats)")

    time_value = str(ref.get("time") or ref.get("valid_time") or "")
    unit = str(ref.get("unit") or "")

    # Extract per-source value grids, interpolating to the target grid.
    aligned_values: list[list[list[float]]] = []  # [source][lat][lon]
    aligned_weights: list[float] = []
    source_labels: list[str] = []
    source_details: list[dict[str, Any]] = []

    for src in sources:
        ds = str(src.get("dataset", "")).strip().lower()
        ds_meta = DATASET_METADATA[ds]
        source_labels.append(ds_meta["label"])
        src_lons = _axis(src, "lons", "longitudes", "longitude")
        src_lats = _axis(src, "lats", "latitudes", "latitude")

        # Get the value grid for this source.
        # Priority: pressure-level data block > single-level values.
        raw_grid = None
        if level is not None:
            data_block = src.get("data") or src.get("levels_data") or {}
            raw_grid = data_block.get(str(level)) or data_block.get(f"{level}hPa")
        if raw_grid is None:
            raw_grid = src.get("values") or src.get("data")
        if raw_grid is None:
            if level is not None:
                raise ValueError(f"source '{ds}' missing pressure level {level} data")
            raise ValueError(f"source '{ds}' missing 'values' data")

        src_values = _grid_values(raw_grid, src_lons)
        # Bilinear interpolation to target grid.
        interpolated = _bilinear_interpolate_grid(src_lons, src_lats, src_values, target_lon_axis, target_lat_axis)
        aligned_values.append(interpolated)
        aligned_weights.append(fusion_weights[ds] / total_weight)
        source_details.append({
            "dataset": ds,
            "label": ds_meta["label"],
            "provider": ds_meta["provider"],
            "native_resolution_deg": ds_meta["resolution_deg"],
            "weight": round(fusion_weights[ds] / total_weight, 4),
            "time_step_hours": ds_meta["time_step_hours"],
        })

    # Compute weighted average and per-cell uncertainty.
    features: list[dict[str, Any]] = []
    for lat_index, lat in enumerate(target_lat_axis):
        for lon_index, lon in enumerate(target_lon_axis):
            cell_values: list[float] = []
            cell_weighted_sum = 0.0
            cell_weight_sum = 0.0
            per_source: dict[str, float] = {}
            for src_idx, src_values in enumerate(aligned_values):
                val = src_values[lat_index][lon_index]
                if val is None or not math.isfinite(val):
                    continue
                cell_values.append(val)
                w = aligned_weights[src_idx]
                cell_weighted_sum += val * w
                cell_weight_sum += w
                per_source[source_labels[src_idx]] = round(val, 3)

            if not cell_values or cell_weight_sum <= 0:
                continue

            fused_value = cell_weighted_sum / cell_weight_sum
            # Weighted standard deviation as fusion uncertainty.
            variance = sum(aligned_weights[i] * (aligned_values[i][lat_index][lon_index] - fused_value) ** 2
                          for i in range(len(aligned_values))
                          if aligned_values[i][lat_index][lon_index] is not None) / max(cell_weight_sum, 1e-12)
            uncertainty = math.sqrt(variance)
            spread = max(cell_values) - min(cell_values) if len(cell_values) > 1 else 0.0

            properties = {
                "weather_type": "fusion-region",
                "name": f"多源融合 {variable}{' ' + str(level) + 'hPa' if level else ''}",
                "time": time_value,
                "valid_time": time_value,
                "variable": variable,
                "fused_value": round(fused_value, 3),
                "unit": unit,
                "fusion_uncertainty": round(uncertainty, 4),
                "source_spread": round(spread, 4),
                "source_count": len(cell_values),
                "per_source_values": per_source,
                "source": "ERA5+MERRA-2+JRA-55 Fusion",
                "fusion_weights": {s["label"]: s["weight"] for s in source_details},
                "confidence": round(1.0 - min(uncertainty / 5.0, 0.5), 3),
                "narrative": f"多源融合 {variable}，{len(cell_values)} 数据集加权平均，不确定度 ±{round(uncertainty, 2)}。",
            }
            features.append({
                "type": "Feature",
                "properties": _drop_none(properties),
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [_cell_ring(target_lon_axis, target_lat_axis, lon_index, lat_index)],
                },
            })

    return {
        "type": "FeatureCollection",
        "name": f"multi-source-fusion-{variable}" + (f"-{level}hPa" if level else ""),
        "metadata": {
            "adapter": "multi_source_fusion_adapter",
            "schema": "weather-earth-geojson-v1",
            "projection": "WGS84 lon/lat",
            "fusion": True,
            "variable": variable,
            "pressure_level_hpa": level,
            "unit": unit,
            "sources": source_details,
            "time": time_value,
            "grid_lons": len(target_lon_axis),
            "grid_lats": len(target_lat_axis),
            "feature_count": len(features),
            "feature_strategy": "fused-cell-per-feature",
        },
        "features": features,
    }


def ocean_atmosphere_coupling_adapter(
    *,
    atmosphere: dict[str, Any],
    ocean: dict[str, Any],
    variable: str = "sst_air_coupling",
) -> dict[str, Any]:
    """Couple ERA5 atmosphere fields with CFSR ocean fields for sea-air diagnostics.

    The ``atmosphere`` grid provides surface air temperature (2m) and/or wind,
    while the ``ocean`` grid provides sea surface temperature and mixed-layer
    data. The output features carry both atmospheric and oceanic values plus
    derived coupling diagnostics (air-sea temperature difference, sensible heat
    flux proxy, stability indicator).
    """
    atm_lons = _axis(atmosphere, "lons", "longitudes", "longitude")
    atm_lats = _axis(atmosphere, "lats", "latitudes", "latitude")
    ocn_lons = _axis(ocean, "lons", "longitudes", "longitude")
    ocn_lats = _axis(ocean, "lats", "latitudes", "latitude")
    if not atm_lons or not atm_lats:
        raise ValueError("atmosphere grid requires lons and lats")
    if not ocn_lons or not ocn_lats:
        raise ValueError("ocean grid requires lons and lats")

    atm_values = _grid_values(atmosphere.get("values") or atmosphere.get("data"), atm_lons)
    ocn_values = _grid_values(ocean.get("values") or ocean.get("data"), ocn_lons)
    atm_time = str(atmosphere.get("time") or "")
    ocn_time = str(ocean.get("time") or atm_time)

    # Interpolate ocean grid to atmosphere grid (atmosphere is usually higher resolution).
    ocn_interp = _bilinear_interpolate_grid(ocn_lons, ocn_lats, ocn_values, atm_lons, atm_lats)

    atm_unit = str(atmosphere.get("unit") or "K")
    ocn_unit = str(ocean.get("unit") or "K")
    atm_source = str(atmosphere.get("source") or "ERA5")
    ocn_source = str(ocean.get("source") or "CFSR")
    atm_var = str(atmosphere.get("variable") or "t2m")
    ocn_var = str(ocean.get("variable") or "sst")

    features: list[dict[str, Any]] = []
    for lat_index, lat in enumerate(atm_lats):
        for lon_index, lon in enumerate(atm_lons):
            atm_val = atm_values[lat_index][lon_index] if lat_index < len(atm_values) and lon_index < len(atm_values[lat_index]) else None
            ocn_val = ocn_interp[lat_index][lon_index] if lat_index < len(ocn_interp) else None
            if atm_val is None or ocn_val is None:
                continue

            # Air-sea temperature difference (positive = ocean warmer than air → unstable).
            delta_t = ocn_val - atm_val
            # Sensible heat flux proxy: Q_h ≈ ρ * c_p * C_H * U * ΔT
            # Using simplified proxy without wind: proportional to |ΔT| * sign.
            heat_flux_proxy = 1.2 * 1005 * 1.1e-3 * abs(delta_t) * 5.0  # approximate W/m²
            # Stability: stable if air warmer than ocean (δT < 0), unstable otherwise.
            stability = "unstable" if delta_t > 0.5 else ("stable" if delta_t < -0.5 else "neutral")

            properties = {
                "weather_type": "ocean-atmosphere-coupling",
                "name": "海气耦合诊断",
                "time": atm_time,
                "valid_time": atm_time,
                "atmosphere_source": atm_source,
                "ocean_source": ocn_source,
                "atmosphere_variable": atm_var,
                "ocean_variable": ocn_var,
                "atmosphere_value": round(atm_val, 3),
                "ocean_value": round(ocn_val, 3),
                "atmosphere_unit": atm_unit,
                "ocean_unit": ocn_unit,
                "air_sea_delta": round(delta_t, 3),
                "heat_flux_proxy_wm2": round(heat_flux_proxy, 2),
                "boundary_layer_stability": stability,
                "confidence": 0.78,
                "narrative": f"{atm_source}大气({atm_var}={round(atm_val,1)}) + {ocn_source}海洋({ocn_var}={round(ocn_val,1)})，ΔT={round(delta_t,1)}K，{stability}。",
            }
            features.append({
                "type": "Feature",
                "properties": _drop_none(properties),
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [_cell_ring(atm_lons, atm_lats, lon_index, lat_index)],
                },
            })

    return {
        "type": "FeatureCollection",
        "name": "ocean-atmosphere-coupling",
        "metadata": {
            "adapter": "ocean_atmosphere_coupling_adapter",
            "schema": "weather-earth-geojson-v1",
            "projection": "WGS84 lon/lat",
            "coupling": True,
            "variable": variable,
            "atmosphere_source": atm_source,
            "ocean_source": ocn_source,
            "atmosphere_variable": atm_var,
            "ocean_variable": ocn_var,
            "atmosphere_time": atm_time,
            "ocean_time": ocn_time,
            "feature_count": len(features),
            "feature_strategy": "coupled-cell-per-feature",
        },
        "features": features,
    }


def multi_source_example_sources(
    *,
    variable: str = "t",
    level: int = 850,
    bbox: tuple[float, float, float, float] = (100.0, 30.0, 125.0, 40.0),
    time_value: str = "2026-06-10T18:00:00Z",
) -> list[dict[str, Any]]:
    """Generate synthetic multi-source grids for ERA5, MERRA-2, and JRA-55.

    Each dataset uses its native resolution and has slightly different values
    to simulate real cross-dataset discrepancies.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    sources: list[dict[str, Any]] = []

    dataset_configs = [
        ("era5", 0.5, 0.0, 1.0),      # ERA5: fine, accurate, weight 0.5
        ("merra2", 1.0, 0.3, 0.96),   # MERRA-2: medium, slight bias, scale 0.96
        ("jra55", 1.25, -0.2, 1.03),   # JRA-55: coarse, slight cool bias, scale 1.03
    ]

    for ds_id, resolution, bias, scale in dataset_configs:
        ds_meta = DATASET_METADATA[ds_id]
        lons = _arange(min_lon, max_lon, resolution)
        lats = list(reversed(_arange(min_lat, max_lat, resolution)))
        rows: list[list[float]] = []
        # Base temperature at this pressure level (standard atmosphere).
        base_temp_k = _pressure_to_temperature(level)
        for lat in lats:
            row: list[float] = []
            for lon in lons:
                lat_factor = (40.0 - lat) * 0.4
                lon_factor = math.sin(math.radians((lon - 100) * 5)) * 1.0
                value = (base_temp_k + lat_factor + lon_factor) * scale + bias
                row.append(round(value, 2))
            rows.append(row)

        sources.append({
            "dataset": ds_id,
            "source": ds_meta["label"],
            "source_url": f"https://{ds_id}.example/",
            "time": time_value,
            "variable": variable,
            "unit": "K",
            "lons": lons,
            "lats": lats,
            "values": rows,
        })

    return sources


def ocean_atmosphere_example(
    *,
    bbox: tuple[float, float, float, float] = (120.0, 25.0, 140.0, 40.0),
    resolution: float = 2.0,
    time_value: str = "2026-06-10T18:00:00Z",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Generate synthetic ERA5 atmosphere + CFSR ocean example grids.

    Returns (atmosphere_grid, ocean_grid) for the Northwest Pacific where
    sea-air coupling is strongest (Kuroshio region).
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    atm_lons = _arange(min_lon, max_lon, resolution)
    atm_lats = list(reversed(_arange(min_lat, max_lat, resolution)))
    ocn_lons = _arange(min_lon, max_lon, resolution * 1.5)
    ocn_lats = list(reversed(_arange(min_lat, max_lat, resolution * 1.5)))

    # ERA5 2m air temperature: cooler over ocean, warmer near coast.
    atm_rows: list[list[float]] = []
    for lat in atm_lats:
        row: list[float] = []
        for lon in atm_lons:
            # Air temp: ~295K near coast, ~290K over open ocean.
            coastal_factor = max(0, (lon - 120) / 20) * 3
            lat_factor = (35 - lat) * 0.3
            row.append(round(291 + coastal_factor + lat_factor, 2))
        atm_rows.append(row)

    # CFSR SST: Kuroshio warm current ~302K, cooler north.
    ocn_rows: list[list[float]] = []
    for lat in ocn_lats:
        row: list[float] = []
        for lon in ocn_lons:
            # SST: warm near Kuroshio (130E, 30N), cooler north.
            kuroshio_dist = math.hypot((lon - 132) / 10, (lat - 30) / 8)
            sst = 302 - kuroshio_dist * 2.5
            row.append(round(max(278, sst), 2))
        ocn_rows.append(row)

    atmosphere = {
        "dataset": "era5",
        "source": "ERA5",
        "source_url": "https://cds.climate.copernicus.eu/",
        "time": time_value,
        "variable": "t2m",
        "unit": "K",
        "lons": atm_lons,
        "lats": atm_lats,
        "values": atm_rows,
    }
    ocean = {
        "dataset": "cfsr",
        "source": "CFSR",
        "source_url": "https://nomads.ncep.noaa.gov/",
        "time": time_value,
        "variable": "sst",
        "unit": "K",
        "lons": ocn_lons,
        "lats": ocn_lats,
        "values": ocn_rows,
    }
    return atmosphere, ocean


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _bilinear_interpolate_grid(
    src_lons: list[float],
    src_lats: list[float],
    src_values: list[list[float | None]],
    tgt_lons: list[float],
    tgt_lats: list[float],
) -> list[list[float | None]]:
    """Bilinear-interpolate a source grid onto a target grid."""
    if not src_lons or not src_lats:
        return [[None] * len(tgt_lons) for _ in tgt_lats]
    result: list[list[float | None]] = []
    for tgt_lat in tgt_lats:
        row: list[float | None] = []
        for tgt_lon in tgt_lons:
            row.append(_bilinear_sample(src_lons, src_lats, src_values, tgt_lon, tgt_lat))
        result.append(row)
    return result


def _bilinear_sample(
    xs: list[float],
    ys: list[float],
    grid: list[list[float | None]],
    x: float,
    y: float,
) -> float | None:
    """Sample a value at (x, y) from a gridded field using bilinear interpolation."""
    nx = len(xs)
    ny = len(ys)
    if nx < 2 or ny < 2:
        # Fall back to nearest for degenerate grids.
        if nx == 1 and ny == 1:
            return grid[0][0]
        return None

    # Find x indices.
    xi = _find_bracket(xs, x)
    if xi is None:
        return None
    x0, x1 = xi
    # Find y indices (ys may be ascending or descending).
    yi = _find_bracket(ys, y)
    if yi is None:
        return None
    y0, y1 = yi

    v00 = _safe_grid_get(grid, y0, x0)
    v01 = _safe_grid_get(grid, y0, x1)
    v10 = _safe_grid_get(grid, y1, x0)
    v11 = _safe_grid_get(grid, y1, x1)
    if v00 is None or v01 is None or v10 is None or v11 is None:
        return None

    tx = (x - xs[x0]) / (xs[x1] - xs[x0]) if xs[x1] != xs[x0] else 0.0
    ty = (y - ys[y0]) / (ys[y1] - ys[y0]) if ys[y1] != ys[y0] else 0.0
    tx = max(0.0, min(1.0, tx))
    ty = max(0.0, min(1.0, ty))

    v0 = v00 * (1 - tx) + v01 * tx
    v1 = v10 * (1 - tx) + v11 * tx
    return v0 * (1 - ty) + v1 * ty


def _find_bracket(axis: list[float], value: float) -> tuple[int, int] | None:
    """Find the index pair (i, i+1) that brackets ``value`` in a sorted axis."""
    n = len(axis)
    if axis[0] <= axis[-1]:
        # Ascending.
        if value < axis[0] or value > axis[-1]:
            # Clamp to edges.
            if value < axis[0]:
                return 0, 1
            return n - 2, n - 1
        for i in range(n - 1):
            if axis[i] <= value <= axis[i + 1]:
                return i, i + 1
    else:
        # Descending.
        if value > axis[0] or value < axis[-1]:
            if value > axis[0]:
                return 0, 1
            return n - 2, n - 1
        for i in range(n - 1):
            if axis[i] >= value >= axis[i + 1]:
                return i, i + 1
    return None


def _safe_grid_get(grid: list[list[float | None]], row: int, col: int) -> float | None:
    if 0 <= row < len(grid) and 0 <= col < len(grid[row]):
        val = grid[row][col]
        return float(val) if val is not None else None
    return None


def _axis(grid: dict[str, Any], *keys: str) -> list[float]:
    for key in keys:
        raw = grid.get(key)
        if raw:
            return [float(v) for v in raw]
    return []


def _grid_values(raw: Any, lons: list[float]) -> list[list[float | None]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("grid data must be a list of rows")
    if raw and all(not isinstance(item, list) for item in raw):
        width = len(lons)
        if width <= 0 or len(raw) % width:
            raise ValueError("flat grid array requires a width matching lons")
        raw = [raw[i : i + width] for i in range(0, len(raw), width)]
    return [[None if v is None else float(v) for v in row] for row in raw]


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


def _pressure_to_temperature(pressure_hpa: float) -> float:
    """Estimate standard atmospheric temperature (K) at a pressure level."""
    altitude = 44330.0 * (1.0 - (pressure_hpa / 1013.25) ** 0.1903)
    return max(216.65, 288.15 - 0.0065 * altitude)


def _drop_none(properties: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in properties.items() if value is not None and value != ""}
