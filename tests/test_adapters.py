from __future__ import annotations

from weather_geo_extractor.adapters import (
    build_gfs_gust_url,
    gfs_gust_adapter,
    gpm_imerg_adapter,
    open_meteo_point_adapter,
)


def test_build_gfs_gust_url_uses_open_nomads_filter() -> None:
    url = build_gfs_gust_url(
        cycle="2026061000",
        forecast_hour=18,
        bbox=[70, 15, 140, 55],
    )

    assert url.startswith("https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?")
    assert "file=gfs.t00z.pgrb2.0p25.f018" in url
    assert "var_GUST=on" in url
    assert "lev_surface=on" in url
    assert "leftlon=70" in url
    assert "rightlon=140" in url
    assert "toplat=55" in url
    assert "bottomlat=15" in url


def test_gfs_gust_adapter_converts_threshold_cells_to_wind_regions() -> None:
    payload = gfs_gust_adapter(
        {
            "lons": [100, 101],
            "lats": [31, 30],
            "values": [[12.0, 14.1], [17.5, 21.2]],
            "time": "2026-06-10T00:00Z",
            "forecast_time": "2026-06-10T18:00+08:00",
            "source_url": "https://nomads.example/gfs.grib2",
        }
    )

    assert payload["metadata"]["adapter"] == "gfs_gust_adapter"
    assert [feature["properties"]["level"] for feature in payload["features"]] == ["level_6", "level_7", "level_8"]
    assert payload["features"][0]["properties"]["weather_type"] == "wind-region"
    assert payload["features"][0]["geometry"]["type"] == "Polygon"
    assert payload["features"][2]["properties"]["observed_value"] == 21.2


def test_gpm_imerg_adapter_converts_precipitation_cells_to_rain_regions() -> None:
    payload = gpm_imerg_adapter(
        {
            "longitudes": [108, 109],
            "latitudes": [35, 34],
            "precipitation": [[2.0, 10.5], [22.0, 55.0]],
            "time": "2026-06-10T20:00+08:00",
            "unit": "mm/h",
        }
    )

    assert payload["metadata"]["adapter"] == "gpm_imerg_adapter"
    assert [feature["properties"]["level"] for feature in payload["features"]] == ["moderate", "heavy", "extreme"]
    assert all(feature["properties"]["weather_type"] == "rain-region" for feature in payload["features"])
    assert payload["features"][1]["properties"]["precipitation_rate"] == 22.0


def test_open_meteo_point_adapter_fetches_hourly_station_features() -> None:
    requested_urls: list[str] = []

    def fake_fetcher(url: str) -> dict[str, object]:
        requested_urls.append(url)
        return {
            "hourly_units": {
                "wind_gusts_10m": "m/s",
                "wind_speed_10m": "m/s",
                "wind_direction_10m": "degree",
                "precipitation": "mm",
            },
            "hourly": {
                "time": ["2026-06-10T18:00", "2026-06-10T19:00", "2026-06-10T20:00"],
                "wind_gusts_10m": [12.0, 18.0, 22.0],
                "wind_speed_10m": [7.0, 10.0, 12.0],
                "wind_direction_10m": [280, 290, 300],
                "precipitation": [0.0, 1.2, 3.4],
                "showers": [0.0, 0.4, 1.0],
                "temperature_2m": [28.0, 27.5, 26.8],
            },
        }

    payload = open_meteo_point_adapter(
        latitude=34.34,
        longitude=108.94,
        start="2026-06-10T19:00",
        end="2026-06-10T20:00",
        name="西安",
        fetcher=fake_fetcher,
    )

    assert "wind_speed_unit=ms" in requested_urls[0]
    assert len(payload["features"]) == 2
    assert payload["features"][0]["properties"]["level"] == "level_7"
    assert payload["features"][1]["properties"]["level"] == "level_8"
    assert payload["features"][1]["geometry"]["coordinates"] == [108.94, 34.34]
