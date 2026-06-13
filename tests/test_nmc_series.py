from weather_geo_extractor.cli import (
    _beijing_hour_id,
    _build_nmc_wind_manifest,
    _iter_beijing_hours,
    _nmc_wind_url_for_beijing_hour,
    _parse_beijing_hour,
    _relative_manifest_url,
    _summarize_geojson_for_manifest,
)


def test_nmc_wind_url_uses_utc_product_timestamp() -> None:
    hour = _parse_beijing_hour("202606101800")

    url = _nmc_wind_url_for_beijing_hour(hour)

    assert url == (
        "https://image.nmc.cn/product/2026/06/10/STFC/"
        "SEVP_NMC_STFC_SFER_EDA_ACHN_L88_PB_20260610100000000.jpg"
    )


def test_iter_beijing_hours_is_inclusive() -> None:
    hours = _iter_beijing_hours(_parse_beijing_hour("202606101600"), _parse_beijing_hour("202606101800"))

    assert [_beijing_hour_id(hour) for hour in hours] == ["202606101600", "202606101700", "202606101800"]


def test_relative_manifest_url_matches_viewer_layout() -> None:
    assert _relative_manifest_url("outputs/nmc-wind/202606101800.geojson", "outputs/nmc-wind/manifest.json") == (
        "./202606101800.geojson"
    )
    assert _relative_manifest_url("data/nmc-wind/202606101800.jpg", "outputs/nmc-wind/manifest.json") == (
        "../../data/nmc-wind/202606101800.jpg"
    )


def test_summarize_geojson_for_manifest_counts_severe_regions() -> None:
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"label": "wind_level_6_cyan", "area_px": 100},
                "geometry": {"type": "Polygon", "coordinates": [[(1, 1), (2, 1), (2, 2), (1, 1)]]},
            },
            {
                "type": "Feature",
                "properties": {"label": "wind_level_7_blue", "area_px": 50.5},
                "geometry": {"type": "Polygon", "coordinates": [[(3, 3), (4, 3), (4, 4), (3, 3)]]},
            },
            {
                "type": "Feature",
                "properties": {"label": "wind_level_8_deep_blue", "area_px": 10},
                "geometry": {"type": "MultiPolygon", "coordinates": [[[(5, 5), (6, 5), (6, 6), (5, 5)]]]},
            },
        ],
    }

    summary = _summarize_geojson_for_manifest(payload)

    assert summary["regionCount"] == 3
    assert summary["severeCount"] == 2
    assert summary["pointCount"] == 12
    assert summary["totalAreaPx"] == 160.5
    assert summary["labels"] == {
        "wind_level_6_cyan": 1,
        "wind_level_7_blue": 1,
        "wind_level_8_deep_blue": 1,
    }


def test_build_nmc_wind_manifest_resolves_peak_and_latest_defaults() -> None:
    start = _parse_beijing_hour("202606101600")
    end = _parse_beijing_hour("202606101800")
    items = [
        {"id": "202606101600", "label": "06/10 16:00", "regionCount": 3, "severeCount": 1, "totalAreaPx": 30},
        {"id": "202606101700", "label": "06/10 17:00", "regionCount": 5, "severeCount": 2, "totalAreaPx": 60},
        {"id": "202606101800", "label": "06/10 18:00", "regionCount": 4, "severeCount": 3, "totalAreaPx": 40},
    ]

    latest_manifest = _build_nmc_wind_manifest(
        items=items,
        start=start,
        end=end,
        name=None,
        title=None,
        default_index="latest",
    )
    peak_manifest = _build_nmc_wind_manifest(
        items=items,
        start=start,
        end=end,
        name=None,
        title=None,
        default_index="peak",
    )

    assert latest_manifest["defaultIndex"] == 2
    assert peak_manifest["defaultIndex"] == 1
    assert latest_manifest["title"] == "6月10日大风过程"
    assert latest_manifest["summary"]["peakRegionTime"] == "06/10 17:00"
    assert latest_manifest["summary"]["peakSevereTime"] == "06/10 18:00"
