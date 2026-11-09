"""P2 adapters: multi-source precipitation ensemble and MERRA-2 aerosol energy budget.

P2-A: Multi-source precipitation integration with bias correction and
      Bayesian Model Averaging (BMA) across ERA5, JRA-55, CFSR, and NCEP R1.
P2-B: MERRA-2 aerosol optical depth + radiation flux energy budget diagnostics.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Sequence

JsonFetcher = Callable[[str], dict[str, Any]]

# ---------------------------------------------------------------------------
# P2-A: Precipitation thresholds (mm/day)
# ---------------------------------------------------------------------------
PRECIPITATION_THRESHOLDS = (
    (50.0, "extreme", "极端降水区", "extreme-rain"),
    (25.0, "heavy", "强降水区", "heavy-rain"),
    (10.0, "moderate", "中等降水区", "moderate-rain"),
    (2.5, "light", "轻度降水区", "light-rain"),
    (0.1, "trace", "微量降水区", "trace-rain"),
    (0.0, "dry", "无降水", "dry"),
)

# Dataset-specific known biases (multiplicative factor; >1 = overestimate).
PRECIPITATION_BIAS_FACTORS: dict[str, float] = {
    "era5": 1.00,    # ERA5 is generally well-calibrated
    "jra55": 0.88,   # JRA-55 tends to underestimate in tropics
    "cfsr": 1.12,    # CFSR tends to overestimate
    "ncep_r1": 0.82, # NCEP R1 coarse resolution, significant underestimate
    "merra2": 0.95,  # MERRA-2 slight underestimate
}

PRECIPITATION_DATASET_METADATA: dict[str, dict[str, Any]] = {
    "era5": {"label": "ERA5", "resolution_deg": 0.25, "weight": 0.40},
    "jra55": {"label": "JRA-55", "resolution_deg": 0.5625, "weight": 0.25},
    "cfsr": {"label": "CFSR", "resolution_deg": 0.3, "weight": 0.20},
    "ncep_r1": {"label": "NCEP/NCAR R1", "resolution_deg": 2.5, "weight": 0.15},
}

# ---------------------------------------------------------------------------
# P2-B: Aerosol types and radiation flux constants
# ---------------------------------------------------------------------------
AEROSOL_TYPES: dict[str, dict[str, str]] = {
    "so2": {"label": "硫酸盐", "english": "Sulfate", "unit": "kg/m²", "weather_type": "aerosol-sulfate"},
    "bc": {"label": "黑碳", "english": "Black Carbon", "unit": "kg/m²", "weather_type": "aerosol-black-carbon"},
    "oc": {"label": "有机碳", "english": "Organic Carbon", "unit": "kg/m²", "weather_type": "aerosol-organic-carbon"},
    "du": {"label": "沙尘", "english": "Dust", "unit": "kg/m²", "weather_type": "aerosol-dust"},
    "ss": {"label": "海盐", "english": "Sea Salt", "unit": "kg/m²", "weather_type": "aerosol-sea-salt"},
}

RADIATION_FLUX_TYPES: dict[str, dict[str, str]] = {
    "sw_down": {"label": "向下短波辐射", "english": "Incoming Shortwave", "unit": "W/m²"},
    "sw_up": {"label": "向上短波辐射", "english": "Outgoing Shortwave", "unit": "W/m²"},
    "lw_down": {"label": "向下长波辐射", "english": "Incoming Longwave", "unit": "W/m²"},
    "lw_up": {"label": "向上长波辐射", "english": "Outgoing Longwave", "unit": "W/m²"},
    "net_sw": {"label": "净短波辐射", "english": "Net Shortwave", "unit": "W/m²"},
    "net_lw": {"label": "净长波辐射", "english": "Net Longwave", "unit": "W/m²"},
    "net_rad": {"label": "净辐射", "english": "Net Radiation", "unit": "W/m²"},
}

# Aerosol direct radiative forcing efficiency (W/m² per AOD unit), approximate.
AEROSOL_FORCING_EFFICIENCY: dict[str, float] = {
    "so2": -4.5,  # Sulfate: cooling
    "bc": 2.8,    # Black carbon: warming
    "oc": -1.2,   # Organic carbon: slight cooling
    "du": -2.0,   # Dust: net cooling at TOA
    "ss": -1.5,   # Sea salt: cooling
}


# ===========================================================================
# P2-A: Multi-source precipitation ensemble with bias correction and BMA
# ===========================================================================

def precipitation_ensemble_adapter(
    sources: list[dict[str, Any]],
    *,
    reference: dict[str, Any] | None = None,
    apply_bias_correction: bool = True,
    method: str = "bma",
    target_lons: list[float] | None = None,
    target_lats: list[float] | None = None,
) -> dict[str, Any]:
    """Integrate multiple reanalysis precipitation datasets with bias correction.

    Steps:
      1. Bias-correct each source using its known multiplicative bias factor
         (or against a reference like GPCC/GPCP if provided).
      2. Align all sources to a common grid via bilinear interpolation.
      3. Combine using Bayesian Model Averaging (BMA) or simple weighted mean.

    Each source dict provides::

        {
          "dataset": "era5",
          "lons": [...], "lats": [...],
          "values": [[...], ...],   # mm/day
          "time": "2026-06-10",
        }

    The optional ``reference`` grid (GPCC/GPCP obs) is used for quantile-based
    bias correction when ``apply_bias_correction`` is True.
    """
    if not sources or len(sources) < 2:
        raise ValueError("precipitation ensemble requires at least two source datasets")

    ref = sources[0]
    target_lon_axis = target_lons or _axis(ref, "lons", "longitudes", "longitude")
    target_lat_axis = target_lats or _axis(ref, "lats", "latitudes", "latitude")
    if not target_lon_axis or not target_lat_axis:
        raise ValueError("ensemble requires a target grid (lons/lats)")

    time_value = str(ref.get("time") or ref.get("valid_time") or "")

    # Optionally interpolate reference (GPCC/GPCP) to target grid.
    ref_values = None
    if reference:
        ref_lons = _axis(reference, "lons", "longitudes", "longitude")
        ref_lats = _axis(reference, "lats", "latitudes", "latitude")
        ref_raw = reference.get("values") or reference.get("data")
        ref_grid = _grid_values(ref_raw, ref_lons)
        ref_values = _bilinear_interpolate_grid(ref_lons, ref_lats, ref_grid, target_lon_axis, target_lat_axis)

    # Process each source: bias-correct and interpolate.
    aligned: list[list[list[float]]] = []
    weights: list[float] = []
    source_info: list[dict[str, Any]] = []
    bma_params: list[dict[str, float]] = []

    for src in sources:
        ds = str(src.get("dataset", "")).strip().lower()
        ds_meta = PRECIPITATION_DATASET_METADATA.get(ds, {"label": ds, "resolution_deg": 1.0, "weight": 0.2})
        src_lons = _axis(src, "lons", "longitudes", "longitude")
        src_lats = _axis(src, "lats", "latitudes", "latitude")
        raw = src.get("values") or src.get("data")
        src_grid = _grid_values(raw, src_lons)

        # Bias correction.
        bias_factor = 1.0
        corrected_grid = src_grid
        if apply_bias_correction:
            bias_factor = PRECIPITATION_BIAS_FACTORS.get(ds, 1.0)
            corrected_grid = [[max(0.0, v / bias_factor) if v is not None else None for v in row] for row in src_grid]
            # If reference obs available, do ratio-based correction.
            if ref_values:
                interp = _bilinear_interpolate_grid(src_lons, src_lats, corrected_grid, target_lon_axis, target_lat_axis)
                ratio = _compute_bias_ratio(interp, ref_values)
                bias_factor *= ratio
                corrected_grid = [[max(0.0, v / ratio) if v is not None else None for v in row] for row in corrected_grid]

        interp = _bilinear_interpolate_grid(src_lons, src_lats, corrected_grid, target_lon_axis, target_lat_axis)
        aligned.append(interp)

        w = ds_meta["weight"]
        weights.append(w)
        source_info.append({
            "dataset": ds,
            "label": ds_meta["label"],
            "native_resolution_deg": ds_meta["resolution_deg"],
            "bias_factor": round(bias_factor, 4),
            "weight": round(w, 4),
        })
        # BMA parameters: estimate skill weight from bias-corrected variance.
        bma_params.append({"weight": w, "variance": _grid_variance(interp)})

    # Normalize BMA weights.
    total_w = sum(weights)
    norm_weights = [w / total_w for w in weights] if total_w > 0 else [1.0 / len(weights)] * len(weights)

    # BMA: posterior mean = sum(w_i * f_i), posterior variance includes spread.
    features: list[dict[str, Any]] = []
    for lat_index, lat in enumerate(target_lat_axis):
        for lon_index, lon in enumerate(target_lon_axis):
            cell_values: list[float] = []
            weighted_sum = 0.0
            per_source: dict[str, float] = {}
            for src_idx, src_grid in enumerate(aligned):
                val = src_grid[lat_index][lon_index]
                if val is None or not math.isfinite(val):
                    continue
                cell_values.append(val)
                weighted_sum += val * norm_weights[src_idx]
                per_source[source_info[src_idx]["label"]] = round(val, 2)

            if not cell_values:
                continue

            ensemble_mean = weighted_sum
            # BMA variance: within-model + between-model spread.
            within = sum(norm_weights[i] * (aligned[i][lat_index][lon_index] - ensemble_mean) ** 2
                        for i in range(len(aligned))
                        if aligned[i][lat_index][lon_index] is not None)
            between = _variance(cell_values)
            bma_variance = within + between
            bma_std = math.sqrt(max(bma_variance, 0.0))

            # Probability of exceeding heavy rain threshold (25 mm/day).
            prob_heavy = _normal_cdf((ensemble_mean - 25.0) / max(bma_std, 0.1)) if bma_std > 0 else (1.0 if ensemble_mean >= 25 else 0.0)

            matched = _threshold_match(ensemble_mean, PRECIPITATION_THRESHOLDS)
            level_key, level_label, intensity = matched or ("observed", "降水", "rain")

            properties = {
                "weather_type": "rain-region",
                "name": f"多源降水集成 {level_label}",
                "time": time_value,
                "valid_time": time_value,
                "level": level_key,
                "intensity": intensity,
                "ensemble_mean": round(ensemble_mean, 2),
                "ensemble_std": round(bma_std, 2),
                "unit": "mm/day",
                "source_count": len(cell_values),
                "per_source_values": per_source,
                "prob_heavy_rain": round(prob_heavy, 3),
                "source": "ERA5+JRA-55+CFSR+NCEP BMA",
                "method": method,
                "bias_corrected": apply_bias_correction,
                "confidence": round(max(0.4, 1.0 - bma_std / 20.0), 3),
                "narrative": f"多源降水集成 {round(ensemble_mean,1)} mm/day，{len(cell_values)}源BMA，强降水概率 {round(prob_heavy*100)}%。",
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
        "name": "precipitation-ensemble-bma",
        "metadata": {
            "adapter": "precipitation_ensemble_adapter",
            "schema": "weather-earth-geojson-v1",
            "projection": "WGS84 lon/lat",
            "ensemble": True,
            "variable": "precipitation",
            "unit": "mm/day",
            "method": method,
            "bias_correction": apply_bias_correction,
            "sources": source_info,
            "reference": "GPCC/GPCP" if reference else "climatology",
            "time": time_value,
            "feature_count": len(features),
            "feature_strategy": "ensemble-cell-per-feature",
        },
        "features": features,
    }


def precipitation_example_sources(
    *,
    bbox: tuple[float, float, float, float] = (100.0, 20.0, 125.0, 40.0),
    time_value: str = "2026-06-10",
) -> list[dict[str, Any]]:
    """Generate synthetic precipitation grids for ERA5, JRA-55, CFSR, NCEP R1."""
    min_lon, min_lat, max_lon, max_lat = bbox
    sources: list[dict[str, Any]] = []

    configs = [
        ("era5", 1.0, 1.0),       # ERA5: fine, accurate
        ("jra55", 1.5, 0.88),     # JRA-55: medium, underestimate
        ("cfsr", 1.25, 1.12),     # CFSR: medium-fine, overestimate
        ("ncep_r1", 2.5, 0.82),   # NCEP R1: coarse, underestimate
    ]

    for ds_id, resolution, bias in configs:
        ds_meta = PRECIPITATION_DATASET_METADATA[ds_id]
        lons = _arange(min_lon, max_lon, resolution)
        lats = list(reversed(_arange(min_lat, max_lat, resolution)))
        rows: list[list[float]] = []
        for lat in lats:
            row: list[float] = []
            for lon in lons:
                # Simulate a rain band centered at (113E, 30N).
                dist = math.hypot((lon - 113) / 8, (lat - 30) / 6)
                base_rain = 45 * math.exp(-dist ** 2)
                # Add noise scaled by dataset bias.
                noise = math.sin(math.radians(lon * 7 + lat * 5)) * 3
                row.append(round(max(0, (base_rain + noise) * bias), 2))
            rows.append(row)
        sources.append({
            "dataset": ds_id,
            "source": ds_meta["label"],
            "time": time_value,
            "lons": lons,
            "lats": lats,
            "values": rows,
        })
    return sources


# ===========================================================================
# P2-B: MERRA-2 aerosol + radiation energy budget
# ===========================================================================

def aerosol_energy_budget_adapter(
    grid: dict[str, Any],
    *,
    aerosol_type: str = "du",
) -> dict[str, Any]:
    """Convert MERRA-2 aerosol + radiation grid JSON into energy budget GeoJSON.

    The input grid provides aerosol optical depth (AOD) and radiation fluxes::

        {
          "source": "MERRA-2",
          "time": "2026-06-10T12:00Z",
          "lons": [...], "lats": [...],
          "aod": {"du": [[...]], "bc": [[...]], ...},
          "radiation": {"sw_down": [[...]], "lw_down": [[...]], ...},
        }

    The output features carry AOD, each radiation flux, derived net fluxes,
    and aerosol direct radiative forcing (DRF) estimates.
    """
    lons = _axis(grid, "lons", "longitudes", "longitude")
    lats = _axis(grid, "lats", "latitudes", "latitude")
    if not lons or not lats:
        raise ValueError("grid requires lons and lats")

    source = str(grid.get("source") or "MERRA-2")
    source_url = str(grid.get("source_url") or grid.get("url") or "")
    time_value = str(grid.get("time") or grid.get("valid_time") or "")
    confidence = float(grid.get("confidence", 0.80))

    aod_block = grid.get("aod") or {}
    rad_block = grid.get("radiation") or {}
    if not aod_block and not rad_block:
        raise ValueError("grid requires 'aod' and/or 'radiation' data blocks")

    # Extract the primary aerosol AOD.
    aero_meta = AEROSOL_TYPES.get(aerosol_type, {"label": aerosol_type, "english": aerosol_type, "unit": "1", "weather_type": "aerosol"})
    primary_aod_raw = aod_block.get(aerosol_type) or aod_block.get(aerosol_type + "_aod")
    primary_aod = _grid_values(primary_aod_raw, lons) if primary_aod_raw else None

    # Extract radiation fluxes.
    rad_grids: dict[str, list[list[float | None]]] = {}
    for flux_key in RADIATION_FLUX_TYPES:
        raw = rad_block.get(flux_key)
        if raw is not None:
            rad_grids[flux_key] = _grid_values(raw, lons)

    # Forcing efficiency for the primary aerosol.
    forcing_eff = AEROSOL_FORCING_EFFICIENCY.get(aerosol_type, -1.0)

    features: list[dict[str, Any]] = []
    for lat_index, lat in enumerate(lats):
        for lon_index, lon in enumerate(lons):
            aod_val = primary_aod[lat_index][lon_index] if primary_aod else None
            sw_down = _grid_get(rad_grids.get("sw_down"), lat_index, lon_index)
            sw_up = _grid_get(rad_grids.get("sw_up"), lat_index, lon_index)
            lw_down = _grid_get(rad_grids.get("lw_down"), lat_index, lon_index)
            lw_up = _grid_get(rad_grids.get("lw_up"), lat_index, lon_index)

            # Derive net fluxes if components available.
            net_sw = sw_down - sw_up if sw_down is not None and sw_up is not None else _grid_get(rad_grids.get("net_sw"), lat_index, lon_index)
            net_lw = lw_down - lw_up if lw_down is not None and lw_up is not None else _grid_get(rad_grids.get("net_lw"), lat_index, lon_index)
            net_rad = (net_sw + net_lw) if net_sw is not None and net_lw is not None else _grid_get(rad_grids.get("net_rad"), lat_index, lon_index)

            # Aerosol direct radiative forcing: DRF = AOD * forcing_efficiency.
            drf = aod_val * forcing_eff if aod_val is not None else None

            if aod_val is None and net_rad is None:
                continue

            properties = {
                "weather_type": aero_meta["weather_type"],
                "name": f"MERRA-2 {aero_meta['label']}能量收支",
                "time": time_value,
                "valid_time": time_value,
                "aerosol_type": aerosol_type,
                "aerosol_label": aero_meta["label"],
                "aerosol_english": aero_meta["english"],
                "aod": round(aod_val, 4) if aod_val is not None else None,
                "sw_down": round(sw_down, 2) if sw_down is not None else None,
                "sw_up": round(sw_up, 2) if sw_up is not None else None,
                "lw_down": round(lw_down, 2) if lw_down is not None else None,
                "lw_up": round(lw_up, 2) if lw_up is not None else None,
                "net_sw": round(net_sw, 2) if net_sw is not None else None,
                "net_lw": round(net_lw, 2) if net_lw is not None else None,
                "net_radiation": round(net_rad, 2) if net_rad is not None else None,
                "aerosol_forcing_wm2": round(drf, 2) if drf is not None else None,
                "unit_aod": "1",
                "unit_flux": "W/m²",
                "source": source,
                "source_url": source_url or None,
                "confidence": confidence,
                "narrative": f"{source} {aero_meta['label']}AOD={round(aod_val,2) if aod_val else 'N/A'}，净辐射={round(net_rad,1) if net_rad else 'N/A'}W/m²，气溶胶辐射强迫={round(drf,1) if drf else 'N/A'}W/m²。",
            }
            features.append({
                "type": "Feature",
                "properties": _drop_none(properties),
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [_cell_ring(lons, lats, lon_index, lat_index)],
                },
            })

    return {
        "type": "FeatureCollection",
        "name": f"aerosol-energy-budget-{aerosol_type}",
        "metadata": {
            "adapter": "aerosol_energy_budget_adapter",
            "schema": "weather-earth-geojson-v1",
            "projection": "WGS84 lon/lat",
            "energy_budget": True,
            "aerosol_type": aerosol_type,
            "aerosol_label": aero_meta["label"],
            "source": source,
            "unit_aod": "1",
            "unit_flux": "W/m²",
            "time": time_value,
            "feature_count": len(features),
            "feature_strategy": "budget-cell-per-feature",
        },
        "features": features,
    }


def aerosol_energy_example_grid(
    *,
    aerosol_type: str = "du",
    bbox: tuple[float, float, float, float] = (70.0, 20.0, 140.0, 50.0),
    resolution: float = 2.5,
    time_value: str = "2026-06-10T12:00:00Z",
) -> dict[str, Any]:
    """Generate synthetic MERRA-2-like aerosol + radiation example data.

    Simulates a dust event over East Asia with corresponding radiation
    perturbations (reduced shortwave, enhanced longwave).
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    lons = _arange(min_lon, max_lon, resolution)
    lats = list(reversed(_arange(min_lat, max_lat, resolution)))

    aero_meta = AEROSOL_TYPES.get(aerosol_type, {"label": aerosol_type, "unit": "kg/m²"})
    forcing_eff = AEROSOL_FORCING_EFFICIENCY.get(aerosol_type, -1.0)

    aod_rows: list[list[float]] = {}
    sw_down_rows: list[list[float]] = []
    lw_down_rows: list[list[float]] = []
    sw_up_rows: list[list[float]] = []
    lw_up_rows: list[list[float]] = []

    aod_grid: list[list[float]] = []
    for lat in lats:
        aod_row: list[float] = []
        sw_row: list[float] = []
        lw_row: list[float] = []
        sw_up_row: list[float] = []
        lw_up_row: list[float] = []
        for lon in lons:
            # Dust source centered at Taklamakan (85E, 40N).
            dist = math.hypot((lon - 85) / 15, (lat - 40) / 12)
            aod = 1.8 * math.exp(-dist ** 2) + 0.1
            aod_row.append(round(aod, 3))

            # Clear-sky SW ~300 W/m² at low lat, reduced by aerosol.
            base_sw = 300 * math.cos(math.radians(lat * 0.9)) + 50
            sw_down = max(50, base_sw - aod * abs(forcing_eff) * 20)
            sw_row.append(round(sw_down, 1))

            # SW reflected: higher albedo with dust.
            sw_up = sw_down * (0.15 + aod * 0.05)
            sw_up_row.append(round(sw_up, 1))

            # LW down: enhanced by aerosol (greenhouse effect of dust).
            base_lw = 250 + math.sin(math.radians(lat * 3)) * 30
            lw_down = base_lw + aod * 8
            lw_row.append(round(lw_down, 1))

            # LW up: surface temperature dependent.
            lw_up = base_lw + 60 - aod * 3
            lw_up_row.append(round(lw_up, 1))

        aod_grid.append(aod_row)
        sw_down_rows.append(sw_row)
        lw_down_rows.append(lw_row)
        sw_up_rows.append(sw_up_row)
        lw_up_rows.append(lw_up_row)

    return {
        "source": "MERRA-2",
        "source_url": "https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/",
        "time": time_value,
        "lons": lons,
        "lats": lats,
        "aod": {aerosol_type: aod_grid},
        "radiation": {
            "sw_down": sw_down_rows,
            "sw_up": sw_up_rows,
            "lw_down": lw_down_rows,
            "lw_up": lw_up_rows,
        },
        "confidence": 0.80,
    }


# ===========================================================================
# Internal helpers
# ===========================================================================

def _normal_cdf(x: float) -> float:
    """Approximate standard normal CDF using the error function."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _compute_bias_ratio(model: list[list[float | None]], obs: list[list[float | None]]) -> float:
    """Compute mean ratio between model and observation for bias correction."""
    total_model = 0.0
    total_obs = 0.0
    count = 0
    for i in range(min(len(model), len(obs))):
        for j in range(min(len(model[i]) if i < len(model) else 0, len(obs[i]) if i < len(obs) else 0)):
            m = model[i][j]
            o = obs[i][j]
            if m is not None and o is not None and o > 0.1:
                total_model += m
                total_obs += o
                count += 1
    if count == 0 or total_obs < 0.1:
        return 1.0
    return total_model / total_obs


def _grid_variance(grid: list[list[float | None]]) -> float:
    values = [v for row in grid for v in row if v is not None and math.isfinite(v)]
    if len(values) < 2:
        return 1.0
    mean = sum(values) / len(values)
    return sum((v - mean) ** 2 for v in values) / len(values)


def _variance(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return sum((v - mean) ** 2 for v in values) / len(values)


def _threshold_match(value: float, thresholds: tuple[tuple[float, str, str, str], ...]) -> tuple[str, str, str] | None:
    for threshold, level, label, intensity in thresholds:
        if value >= threshold:
            return level, label, intensity
    return None


def _grid_get(grid: list[list[float | None]] | None, row: int, col: int) -> float | None:
    if grid is None or row < 0 or row >= len(grid):
        return None
    r = grid[row]
    if col < 0 or col >= len(r):
        return None
    val = r[col]
    return float(val) if val is not None else None


def _bilinear_interpolate_grid(
    src_lons: list[float], src_lats: list[float],
    src_values: list[list[float | None]],
    tgt_lons: list[float], tgt_lats: list[float],
) -> list[list[float | None]]:
    if not src_lons or not src_lats:
        return [[None] * len(tgt_lons) for _ in tgt_lats]
    result: list[list[float | None]] = []
    for tgt_lat in tgt_lats:
        row: list[float | None] = []
        for tgt_lon in tgt_lons:
            row.append(_bilinear_sample(src_lons, src_lats, src_values, tgt_lon, tgt_lat))
        result.append(row)
    return result


def _bilinear_sample(xs: list[float], ys: list[float], grid: list[list[float | None]], x: float, y: float) -> float | None:
    nx = len(xs)
    ny = len(ys)
    if nx < 2 or ny < 2:
        if nx == 1 and ny == 1:
            return grid[0][0]
        return None
    xi = _find_bracket(xs, x)
    yi = _find_bracket(ys, y)
    if xi is None or yi is None:
        return None
    x0, x1 = xi
    y0, y1 = yi
    v00 = _safe_get(grid, y0, x0)
    v01 = _safe_get(grid, y0, x1)
    v10 = _safe_get(grid, y1, x0)
    v11 = _safe_get(grid, y1, x1)
    if v00 is None or v01 is None or v10 is None or v11 is None:
        return None
    tx = max(0.0, min(1.0, (x - xs[x0]) / (xs[x1] - xs[x0]))) if xs[x1] != xs[x0] else 0.0
    ty = max(0.0, min(1.0, (y - ys[y0]) / (ys[y1] - ys[y0]))) if ys[y1] != ys[y0] else 0.0
    v0 = v00 * (1 - tx) + v01 * tx
    v1 = v10 * (1 - tx) + v11 * tx
    return v0 * (1 - ty) + v1 * ty


def _find_bracket(axis: list[float], value: float) -> tuple[int, int] | None:
    n = len(axis)
    if axis[0] <= axis[-1]:
        if value < axis[0]:
            return 0, 1
        if value > axis[-1]:
            return n - 2, n - 1
        for i in range(n - 1):
            if axis[i] <= value <= axis[i + 1]:
                return i, i + 1
    else:
        if value > axis[0]:
            return 0, 1
        if value < axis[-1]:
            return n - 2, n - 1
        for i in range(n - 1):
            if axis[i] >= value >= axis[i + 1]:
                return i, i + 1
    return None


def _safe_get(grid: list[list[float | None]], row: int, col: int) -> float | None:
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


def _drop_none(properties: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in properties.items() if value is not None and value != ""}
