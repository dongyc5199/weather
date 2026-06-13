from weather_geo_extractor.georef import PolynomialControlPointGeoReference
from weather_geo_extractor.models import LonLatPoint, PixelPoint


def test_polynomial_control_point_georef_maps_center() -> None:
    top_left = LonLatPoint(lon=100, lat=40)
    top_right = LonLatPoint(lon=120, lat=40)
    bottom_left = LonLatPoint(lon=100, lat=20)
    bottom_right = LonLatPoint(lon=120, lat=20)
    calibration = {
        "name": "test",
        "image_size": [101, 101],
        "degree": 1,
        "control_points": [
            {"name": "top_left", "pixel": [0, 0], "lon": top_left.lon, "lat": top_left.lat},
            {"name": "top_right", "pixel": [100, 0], "lon": top_right.lon, "lat": top_right.lat},
            {"name": "bottom_left", "pixel": [0, 100], "lon": bottom_left.lon, "lat": bottom_left.lat},
            {"name": "bottom_right", "pixel": [100, 100], "lon": bottom_right.lon, "lat": bottom_right.lat},
        ],
    }

    georef = PolynomialControlPointGeoReference.from_mapping(calibration, width=101, height=101)
    center = georef.pixel_to_lonlat(PixelPoint(50, 50))

    assert round(center.lon, 6) == 110.0
    assert 29.0 < center.lat < 31.0
    assert georef.residual_summary()["max_m"] < 1

