"""Tests for precipitation ensemble and aerosol energy budget (P2)."""

from __future__ import annotations

import math

import pytest

from weather_geo_extractor.precipitation import (
    AEROSOL_TYPES,
    AEROSOL_FORCING_EFFICIENCY,
    PRECIPITATION_BIAS_FACTORS,
    PRECIPITATION_THRESHOLDS,
    aerosol_energy_budget_adapter,
    aerosol_energy_example_grid,
    precipitation_ensemble_adapter,
    precipitation_example_sources,
)


# ===========================================================================
# P2-A: Precipitation ensemble
# ===========================================================================

def test_precipitation_ensemble_produces_bma_features() -> None:
    sources = precipitation_example_sources(bbox=(100, 20, 125, 40))
    result = precipitation_ensemble_adapter(sources)

    assert result["type"] == "FeatureCollection"
    assert result["metadata"]["adapter"] == "precipitation_ensemble_adapter"
    assert result["metadata"]["ensemble"] is True
    assert result["metadata"]["method"] == "bma"
    assert len(result["metadata"]["sources"]) == 4

    sample = result["features"][0]["properties"]
    assert "ensemble_mean" in sample
    assert "ensemble_std" in sample
    assert "prob_heavy_rain" in sample
    assert "per_source_values" in sample
    assert sample["source_count"] == 4
    assert "ERA5" in sample["per_source_values"]


def test_precipitation_ensemble_mean_within_source_range() -> None:
    sources = precipitation_example_sources(bbox=(105, 25, 115, 35))
    result = precipitation_ensemble_adapter(sources)

    for feature in result["features"]:
        props = feature["properties"]
        ensemble = props["ensemble_mean"]
        per_source = list(props["per_source_values"].values())
        assert min(per_source) - 0.5 <= ensemble <= max(per_source) + 0.5


def test_precipitation_ensemble_bias_correction_applied() -> None:
    sources = precipitation_example_sources(bbox=(100, 25, 120, 35))
    result_corrected = precipitation_ensemble_adapter(sources, apply_bias_correction=True)
    result_raw = precipitation_ensemble_adapter(sources, apply_bias_correction=False)

    assert result_corrected["metadata"]["bias_correction"] is True
    assert result_raw["metadata"]["bias_correction"] is False
    # Bias-corrected sources should report non-1.0 bias factors.
    for src in result_corrected["metadata"]["sources"]:
        if src["dataset"] in ("cfsr", "ncep_r1"):
            assert src["bias_factor"] != 1.0


def test_precipitation_ensemble_rejects_single_source() -> None:
    sources = [{"dataset": "era5", "lons": [100], "lats": [30], "values": [[5.0]]}]
    with pytest.raises(ValueError, match="at least two"):
        precipitation_ensemble_adapter(sources)


def test_precipitation_ensemble_rain_band_has_high_probability() -> None:
    """The synthetic rain band centered at (113, 30) should produce high prob_heavy."""
    sources = precipitation_example_sources(bbox=(108, 27, 118, 33))
    result = precipitation_ensemble_adapter(sources)

    # Find the feature near the rain center by checking centroid.
    center_features = []
    for f in result["features"]:
        ring = f["geometry"]["coordinates"][0]
        cx = sum(p[0] for p in ring) / len(ring)
        if 109 <= cx <= 117:
            center_features.append(f)
    assert len(center_features) > 0
    max_prob = max(f["properties"]["prob_heavy_rain"] for f in center_features)
    assert max_prob > 0.3, f"rain center should have high heavy-rain probability, got {max_prob}"


def test_precipitation_thresholds_ordered() -> None:
    for i in range(len(PRECIPITATION_THRESHOLDS) - 1):
        assert PRECIPITATION_THRESHOLDS[i][0] > PRECIPITATION_THRESHOLDS[i + 1][0]


def test_bias_factors_direction() -> None:
    """CFSR should overestimate (factor > 1), NCEP R1 underestimate (factor < 1)."""
    assert PRECIPITATION_BIAS_FACTORS["cfsr"] > 1.0
    assert PRECIPITATION_BIAS_FACTORS["ncep_r1"] < 1.0
    assert PRECIPITATION_BIAS_FACTORS["era5"] == 1.0


# ===========================================================================
# P2-B: Aerosol energy budget
# ===========================================================================

def test_aerosol_energy_budget_produces_diagnostic_fields() -> None:
    grid = aerosol_energy_example_grid(aerosol_type="du", bbox=(70, 20, 140, 50), resolution=5.0)
    result = aerosol_energy_budget_adapter(grid, aerosol_type="du")

    assert result["metadata"]["adapter"] == "aerosol_energy_budget_adapter"
    assert result["metadata"]["energy_budget"] is True
    assert result["metadata"]["aerosol_type"] == "du"
    assert len(result["features"]) > 0

    sample = result["features"][0]["properties"]
    assert "aod" in sample
    assert "net_sw" in sample
    assert "net_lw" in sample
    assert "net_radiation" in sample
    assert "aerosol_forcing_wm2" in sample


def test_aerosol_dust_forcing_is_negative() -> None:
    """Dust aerosol should produce negative (cooling) radiative forcing."""
    grid = aerosol_energy_example_grid(aerosol_type="du", bbox=(80, 35, 90, 45), resolution=2.5)
    result = aerosol_energy_budget_adapter(grid, aerosol_type="du")

    for feature in result["features"]:
        drf = feature["properties"].get("aerosol_forcing_wm2")
        if drf is not None:
            assert drf <= 0, f"dust DRF should be cooling (negative), got {drf}"


def test_aerosol_bc_forcing_is_positive() -> None:
    """Black carbon aerosol should produce positive (warming) radiative forcing."""
    grid = aerosol_energy_example_grid(aerosol_type="bc", bbox=(100, 30, 110, 40), resolution=2.5)
    result = aerosol_energy_budget_adapter(grid, aerosol_type="bc")

    for feature in result["features"]:
        drf = feature["properties"].get("aerosol_forcing_wm2")
        if drf is not None:
            assert drf >= 0, f"black carbon DRF should be warming (positive), got {drf}"


def test_aerosol_aod_decreases_away_from_source() -> None:
    """AOD should be highest near the Taklamakan dust source (85E, 40N)."""
    grid = aerosol_energy_example_grid(aerosol_type="du", bbox=(70, 20, 140, 50), resolution=5.0)
    result = aerosol_energy_budget_adapter(grid, aerosol_type="du")

    center_aod = 0.0
    edge_aod = 0.0
    center_count = 0
    edge_count = 0
    for feature in result["features"]:
        ring = feature["geometry"]["coordinates"][0]
        lon = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        aod = feature["properties"].get("aod", 0)
        dist = math.hypot(lon - 85, lat - 40)
        if dist < 10:
            center_aod += aod
            center_count += 1
        elif dist > 30:
            edge_aod += aod
            edge_count += 1

    if center_count and edge_count:
        assert center_aod / center_count > edge_aod / edge_count


def test_aerosol_energy_budget_rejects_missing_data() -> None:
    with pytest.raises(ValueError, match="aod.*radiation"):
        aerosol_energy_budget_adapter({"lons": [100], "lats": [35]})


def test_aerosol_types_coverage() -> None:
    expected = {"so2", "bc", "oc", "du", "ss"}
    assert expected.issubset(set(AEROSOL_TYPES))


def test_aerosol_forcing_efficiency_signs() -> None:
    """Sulfate and dust should be cooling (negative), black carbon warming (positive)."""
    assert AEROSOL_FORCING_EFFICIENCY["so2"] < 0
    assert AEROSOL_FORCING_EFFICIENCY["du"] < 0
    assert AEROSOL_FORCING_EFFICIENCY["bc"] > 0
