import pytest

from weather_geo_extractor.cli import _attach_source_url, _validate_image_url, build_parser


def test_validate_image_url_accepts_http_and_https() -> None:
    assert _validate_image_url("https://image.nmc.cn/a.jpg") == "https://image.nmc.cn/a.jpg"
    assert _validate_image_url("http://image.nmc.cn/a.jpg") == "http://image.nmc.cn/a.jpg"


def test_validate_image_url_rejects_non_http_url() -> None:
    with pytest.raises(ValueError):
        _validate_image_url("file:///tmp/a.jpg")


def test_process_nmc_wind_url_does_not_require_image_output() -> None:
    args = build_parser().parse_args(
        [
            "process-nmc-wind",
            "--url",
            "https://image.nmc.cn/a.jpg",
            "--output",
            "outputs/a.geojson",
        ]
    )
    assert args.image_output is None


def test_attach_source_url_rewrites_feature_source_image() -> None:
    payload = {
        "properties": {},
        "features": [
            {"properties": {"source_image": "/tmp/weather-geo/source.jpg"}},
        ],
    }
    _attach_source_url(payload, "https://image.nmc.cn/a.jpg")
    assert payload["properties"]["source_url"] == "https://image.nmc.cn/a.jpg"
    assert payload["features"][0]["properties"]["source_image"] == "https://image.nmc.cn/a.jpg"
