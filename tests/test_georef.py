from weather_geo_extractor.georef import LinearBBoxGeoReference
from weather_geo_extractor.models import BBox, PixelPoint


def test_linear_georef_maps_image_corners() -> None:
    georef = LinearBBoxGeoReference(
        width=101,
        height=101,
        bbox=BBox(min_lon=70, min_lat=10, max_lon=140, max_lat=60),
    )

    top_left = georef.pixel_to_lonlat(PixelPoint(0, 0))
    bottom_right = georef.pixel_to_lonlat(PixelPoint(100, 100))

    assert top_left.lon == 70
    assert top_left.lat == 60
    assert bottom_right.lon == 140
    assert bottom_right.lat == 10


def test_linear_georef_maps_center() -> None:
    georef = LinearBBoxGeoReference(
        width=101,
        height=101,
        bbox=BBox(min_lon=70, min_lat=10, max_lon=140, max_lat=60),
    )

    center = georef.pixel_to_lonlat(PixelPoint(50, 50))

    assert center.lon == 105
    assert center.lat == 35

