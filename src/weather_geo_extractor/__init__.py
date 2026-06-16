"""Tools for image recognition and approximate longitude/latitude extraction."""

from .api import extract_nmc_wind_geojson
from .adapters import (
    build_gfs_gust_url,
    gfs_gust_adapter,
    gpm_imerg_adapter,
    open_meteo_point_adapter,
)

__all__ = [
    "__version__",
    "build_gfs_gust_url",
    "extract_nmc_wind_geojson",
    "gfs_gust_adapter",
    "gpm_imerg_adapter",
    "open_meteo_point_adapter",
]

__version__ = "0.1.0"
