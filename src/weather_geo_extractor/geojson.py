from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import BBox, LonLatPoint, PixelPoint, PixelRegion


def close_ring(positions: list[list[float]]) -> list[list[float]]:
    if positions[0] != positions[-1]:
        return [*positions, positions[0]]
    return positions


def lonlat_bbox(points: list[LonLatPoint]) -> BBox:
    lons = [point.lon for point in points]
    lats = [point.lat for point in points]
    return BBox(min_lon=min(lons), min_lat=min(lats), max_lon=max(lons), max_lat=max(lats))


def pixel_positions(points: list[PixelPoint]) -> list[list[float]]:
    return [[round(point.x, 2), round(point.y, 2)] for point in points]


def regions_to_geojson(
    regions: list[PixelRegion],
    *,
    georef: Any | None = None,
    source_image: str | Path | None = None,
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []

    for index, region in enumerate(regions, start=1):
        geometry_type = "Polygon"
        properties: dict[str, Any] = {
            "id": index,
            "label": region.label,
            "area_px": region.area_px,
            "source_image": str(source_image or region.source_image),
            "accuracy": "approximate_from_rendered_image",
        }

        if georef is None:
            ring = close_ring(pixel_positions(region.polygon))
            coordinates: list[Any] = [ring]
            properties["method"] = "color_segmentation_pixel_coordinates"
            properties["coordinate_system"] = "image_pixels"
        else:
            lonlat_points = georef.polygon_to_lonlat(region.polygon)
            ring = close_ring([point.to_position() for point in lonlat_points])
            coordinates = [ring]
            bbox = lonlat_bbox(lonlat_points)
            properties["method"] = getattr(georef, "method_name", "color_segmentation_georef")
            properties["coordinate_system"] = "EPSG:4326"
            properties["bbox_lonlat"] = bbox.to_geojson_bbox()
            if hasattr(georef, "geojson_properties"):
                properties.update(georef.geojson_properties())

        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": {
                    "type": geometry_type,
                    "coordinates": coordinates,
                },
            }
        )

    collection = {
        "type": "FeatureCollection",
        "properties": {
            "generated_by": "weather-geo-extractor",
            "accuracy": "approximate_from_rendered_image",
            "warning": "Coordinates are estimated from rendered image pixels, not authoritative GIS or raw meteorological data.",
        },
        "features": features,
    }
    if georef is not None and hasattr(georef, "geojson_properties"):
        collection["properties"].update(georef.geojson_properties())
    return collection
