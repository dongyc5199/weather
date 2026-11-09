"""Tests for multi-source fusion and ocean-atmosphere coupling (P1)."""

from __future__ import annotations

import math

import pytest

from weather_geo_extractor.fusion import (
    DATASET_METADATA,
    SUPPORTED_DATASETS,
    multi_source_example_sources,
    multi_source_fusion_adapter,
    ocean_atmosphere_coupling_adapter,
    ocean_atmosphere_example,
)


def test_multi_source_fusion_produces_weighted_average() -> None:
    sources = multi_source_example_sources(variable="t", level=850, bbox=(100, 35, 110, 40))
    result = multi_source_fusion_adapter(sources, variable="t", level=850)

    assert result["type"] == "FeatureCollection"
    assert result["metadata"]["adapter"] == "multi_source_fusion_adapter"
    assert result["metadata"]["fusion"] is True
    assert result["metadata"]["pressure_level_hpa"] == 850
    assert len(result["metadata"]["sources"]) == 3

    # Check weights sum to 1.0.
    total_weight = sum(s["weight"] for s in result["metadata"]["sources"])
    assert total_weight == pytest.approx(1.0, abs=1e-3)

    # ERA5 should have the highest weight.
    era5_source = next(s for s in result["metadata"]["sources"] if s["dataset"] == "era5")
    assert era5_source["weight"] == 0.5

    sample = result["features"][0]["properties"]
    assert "fused_value" in sample
    assert "fusion_uncertainty" in sample
    assert "per_source_values" in sample
    assert sample["source_count"] == 3
    assert "ERA5" in sample["per_source_values"]


def test_multi_source_fusion_value_between_source_extremes() -> None:
    sources = multi_source_example_sources(variable="t", level=500, bbox=(100, 35, 102, 36))
    result = multi_source_fusion_adapter(sources, variable="t", level=500)

    for feature in result["features"]:
        props = feature["properties"]
        fused = props["fused_value"]
        per_source = list(props["per_source_values"].values())
        assert min(per_source) <= fused <= max(per_source), (
            f"fused {fused} should be within source range [{min(per_source)}, {max(per_source)}]"
        )


def test_multi_source_fusion_rejects_single_source() -> None:
    sources = [{"dataset": "era5", "lons": [100], "lats": [35], "values": [[280]], "unit": "K"}]
    with pytest.raises(ValueError, match="at least two"):
        multi_source_fusion_adapter(sources, variable="t")


def test_multi_source_fusion_rejects_unsupported_dataset() -> None:
    sources = [
        {"dataset": "era5", "lons": [100], "lats": [35], "values": [[280]], "unit": "K"},
        {"dataset": "invalid_ds", "lons": [100], "lats": [35], "values": [[281]], "unit": "K"},
    ]
    with pytest.raises(ValueError, match="unsupported dataset"):
        multi_source_fusion_adapter(sources, variable="t")


def test_multi_source_example_sources_have_different_resolutions() -> None:
    sources = multi_source_example_sources(variable="t", level=850, bbox=(100, 35, 110, 40))
    assert len(sources) == 3
    # ERA5 (0.5°) should have more grid points than JRA-55 (1.25°).
    era5_cells = len(sources[0]["lons"]) * len(sources[0]["lats"])
    jra55_cells = len(sources[2]["lons"]) * len(sources[2]["lats"])
    assert era5_cells > jra55_cells


def test_ocean_atmosphere_coupling_produces_diagnostic_fields() -> None:
    atmosphere, ocean = ocean_atmosphere_example(bbox=(120, 25, 140, 40), resolution=2.0)
    result = ocean_atmosphere_coupling_adapter(atmosphere=atmosphere, ocean=ocean)

    assert result["metadata"]["adapter"] == "ocean_atmosphere_coupling_adapter"
    assert result["metadata"]["coupling"] is True
    assert result["metadata"]["atmosphere_source"] == "ERA5"
    assert result["metadata"]["ocean_source"] == "CFSR"
    assert len(result["features"]) > 0

    sample = result["features"][0]["properties"]
    assert "atmosphere_value" in sample
    assert "ocean_value" in sample
    assert "air_sea_delta" in sample
    assert "heat_flux_proxy_wm2" in sample
    assert "boundary_layer_stability" in sample
    assert sample["air_sea_delta"] == pytest.approx(
        sample["ocean_value"] - sample["atmosphere_value"], abs=1e-2
    )


def test_ocean_atmosphere_coupling_stability_classification() -> None:
    atmosphere, ocean = ocean_atmosphere_example(bbox=(120, 25, 140, 40), resolution=2.0)
    result = ocean_atmosphere_coupling_adapter(atmosphere=atmosphere, ocean=ocean)

    stabilities = {f["properties"]["boundary_layer_stability"] for f in result["features"]}
    # Kuroshio region should have unstable (ocean warmer) cells.
    assert "unstable" in stabilities


def test_ocean_atmosphere_coupling_rejects_missing_grids() -> None:
    with pytest.raises(ValueError, match="atmosphere grid requires"):
        ocean_atmosphere_coupling_adapter(atmosphere={}, ocean={"lons": [130], "lats": [30], "values": [[300]]})


def test_supported_datasets_coverage() -> None:
    assert set(SUPPORTED_DATASETS) == {"era5", "merra2", "cfsr", "jra55", "ncep_r1"}


def test_dataset_metadata_completeness() -> None:
    for ds_id, meta in DATASET_METADATA.items():
        assert "label" in meta
        assert "resolution_deg" in meta
        assert "levels" in meta
        assert "provider" in meta
