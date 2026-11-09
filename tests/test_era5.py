"""Tests for the ERA5 multi-level vertical stacking adapter (P0)."""

from __future__ import annotations

import math

import pytest

from weather_geo_extractor.era5 import (
    ERA5_PRESSURE_VARIABLES,
    STANDARD_PRESSURE_LEVELS,
    build_era5_cds_request,
    era5_example_grid,
    era5_vertical_profile_adapter,
    era5_wind_composite_adapter,
    era5_wind_example_grid,
)


def test_era5_example_grid_temperature_decreases_with_altitude() -> None:
    grid = era5_example_grid(variable="t", levels=[1000, 500, 200], bbox=(100, 35, 110, 40), resolution=2.0)
    t_1000 = grid["data"]["1000"][0][0]
    t_500 = grid["data"]["500"][0][0]
    t_200 = grid["data"]["200"][0][0]
    assert t_1000 > t_500 > t_200, "temperature must decrease with altitude"


def test_era5_vertical_profile_adapter_produces_stacked_features() -> None:
    grid = era5_example_grid(variable="t", levels=[1000, 850, 500], bbox=(100, 35, 104, 37), resolution=1.0)
    payload = era5_vertical_profile_adapter(grid, variable="t")

    assert payload["type"] == "FeatureCollection"
    assert payload["metadata"]["adapter"] == "era5_vertical_profile_adapter"
    assert payload["metadata"]["vertical_stacking"] is True
    assert payload["metadata"]["pressure_levels"] == [1000, 850, 500]
    assert len(payload["metadata"]["levels"]) == 3
    # Each level should produce features for every grid cell.
    expected_per_level = len(grid["lats"]) * len(grid["lons"])
    total_expected = expected_per_level * 3
    assert len(payload["features"]) == total_expected

    # Check that pressure_level_hpa and altitude_m are set.
    sample = payload["features"][0]["properties"]
    assert sample["pressure_level_hpa"] == 1000
    assert sample["altitude_m"] == pytest.approx(110.9, abs=2)
    assert sample["variable"] == "t"
    assert sample["source"] == "ERA5"


def test_era5_vertical_profile_adapter_rejects_unsupported_variable() -> None:
    grid = era5_example_grid(variable="t", levels=[1000])
    with pytest.raises(ValueError, match="unsupported ERA5 variable"):
        era5_vertical_profile_adapter(grid, variable="xxx")


def test_era5_vertical_profile_adapter_rejects_missing_levels() -> None:
    grid = {"lons": [100, 101], "lats": [35, 34], "data": {}}
    with pytest.raises(ValueError, match="levels"):
        era5_vertical_profile_adapter(grid, variable="t")


def test_era5_vertical_profile_temperature_thresholds_assigned() -> None:
    grid = era5_example_grid(variable="t", levels=[1000, 200], bbox=(100, 35, 102, 36), resolution=1.0)
    payload = era5_vertical_profile_adapter(grid, variable="t")

    # 1000 hPa should be warm (heat/mild), 200 hPa should be extreme_cold.
    levels_found = {f["properties"]["pressure_level_hpa"] for f in payload["features"]}
    assert 1000 in levels_found
    assert 200 in levels_found

    cold_feature = next(f for f in payload["features"] if f["properties"]["pressure_level_hpa"] == 200)
    warm_feature = next(f for f in payload["features"] if f["properties"]["pressure_level_hpa"] == 1000)
    assert cold_feature["properties"]["level"] == "extreme_cold"
    assert warm_feature["properties"]["level"] in {"heat", "warm", "mild"}


def test_era5_wind_composite_adapter_produces_wind_speed_and_direction() -> None:
    grid = era5_wind_example_grid(levels=[1000, 500, 200], bbox=(100, 35, 104, 37), resolution=1.0)
    payload = era5_wind_composite_adapter(grid)

    assert payload["metadata"]["adapter"] == "era5_wind_composite_adapter"
    assert payload["metadata"]["variable"] == "wind"
    assert payload["metadata"]["pressure_levels"] == [1000, 500, 200]

    sample = payload["features"][0]["properties"]
    assert "wind_speed" in sample
    assert "wind_direction" in sample
    assert "u" in sample
    assert "v" in sample
    assert 0 <= sample["wind_direction"] <= 360
    assert sample["wind_speed"] == pytest.approx(
        math.hypot(sample["u"], sample["v"]), rel=1e-3
    )


def test_era5_wind_composite_jet_stream_strength_increases_with_altitude() -> None:
    grid = era5_wind_example_grid(levels=[1000, 200], bbox=(100, 35, 102, 36), resolution=1.0)
    payload = era5_wind_composite_adapter(grid)

    level_summaries = {l["pressure_level_hpa"]: l for l in payload["metadata"]["levels"]}
    assert level_summaries[200]["max_wind_speed"] > level_summaries[1000]["max_wind_speed"]


def test_era5_wind_composite_rejects_missing_uv_data() -> None:
    grid = {"lons": [100, 101], "lats": [35, 34], "levels": [1000]}
    with pytest.raises(ValueError, match="u.*v"):
        era5_wind_composite_adapter(grid)


def test_build_era5_cds_request_structure() -> None:
    request = build_era5_cds_request(
        variable="t",
        pressure_levels=[1000, 850, 500],
        year=2026,
        month=6,
        day=10,
        hour=18,
        bbox=[100, 35, 120, 45],
    )
    assert request["dataset"] == "reanalysis-era5-pressure-levels"
    payload = request["request"]
    assert payload["variable"] == "temperature"
    assert payload["pressure_level"] == ["1000", "850", "500"]
    assert payload["year"] == "2026"
    assert payload["month"] == "06"
    assert payload["day"] == "10"
    assert payload["time"] == "18:00"
    assert payload["area"] == [45, 100, 35, 120]  # north, west, south, east


def test_build_era5_cds_request_without_bbox() -> None:
    request = build_era5_cds_request(
        variable="u",
        pressure_levels=[200],
        year=2026,
        month=6,
        day=10,
        hour=0,
    )
    assert "area" not in request["request"]
    assert request["request"]["variable"] == "u_component_of_wind"


def test_standard_pressure_levels_covers_troposphere_and_stratosphere() -> None:
    assert STANDARD_PRESSURE_LEVELS[0] == 1000
    assert STANDARD_PRESSURE_LEVELS[-1] == 10
    assert 500 in STANDARD_PRESSURE_LEVELS
    assert 200 in STANDARD_PRESSURE_LEVELS


def test_era5_pressure_variables_coverage() -> None:
    expected = {"t", "z", "u", "v", "q", "r", "w", "vo", "d"}
    assert expected.issubset(set(ERA5_PRESSURE_VARIABLES))
    for var, meta in ERA5_PRESSURE_VARIABLES.items():
        assert "label" in meta
        assert "unit" in meta
        assert "weather_type" in meta
