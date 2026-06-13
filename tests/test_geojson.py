from pathlib import Path

from weather_geo_extractor.geojson import regions_to_geojson
from weather_geo_extractor.georef import LinearBBoxGeoReference
from weather_geo_extractor.models import BBox, PixelPoint, PixelRegion


def test_regions_to_geojson_closes_ring_and_sets_accuracy() -> None:
    region = PixelRegion(
        label="target",
        polygon=[
            PixelPoint(0, 0),
            PixelPoint(10, 0),
            PixelPoint(10, 10),
            PixelPoint(0, 10),
        ],
        area_px=100,
        source_image=Path("sample.png"),
    )
    georef = LinearBBoxGeoReference(
        width=11,
        height=11,
        bbox=BBox(min_lon=100, min_lat=20, max_lon=110, max_lat=30),
    )

    payload = regions_to_geojson([region], georef=georef)

    feature = payload["features"][0]
    ring = feature["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1]
    assert feature["properties"]["coordinate_system"] == "EPSG:4326"
    assert feature["properties"]["accuracy"] == "approximate_from_rendered_image"

