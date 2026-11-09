"""Tools for image recognition and approximate longitude/latitude extraction."""

from .api import extract_nmc_wind_geojson
from .adapters import (
    build_gfs_gust_url,
    gfs_gust_adapter,
    gpm_imerg_adapter,
    open_meteo_point_adapter,
)
from .era5 import (
    ERA5_PRESSURE_VARIABLES,
    STANDARD_PRESSURE_LEVELS,
    build_era5_cds_request,
    era5_example_grid,
    era5_vertical_profile_adapter,
    era5_wind_composite_adapter,
    era5_wind_example_grid,
)
from .fusion import (
    DATASET_METADATA,
    multi_source_example_sources,
    multi_source_fusion_adapter,
    ocean_atmosphere_coupling_adapter,
    ocean_atmosphere_example,
)
from .precipitation import (
    AEROSOL_TYPES,
    PRECIPITATION_THRESHOLDS,
    aerosol_energy_budget_adapter,
    aerosol_energy_example_grid,
    precipitation_ensemble_adapter,
    precipitation_example_sources,
)

__all__ = [
    "__version__",
    "build_gfs_gust_url",
    "extract_nmc_wind_geojson",
    "gfs_gust_adapter",
    "gpm_imerg_adapter",
    "open_meteo_point_adapter",
    "ERA5_PRESSURE_VARIABLES",
    "STANDARD_PRESSURE_LEVELS",
    "build_era5_cds_request",
    "era5_example_grid",
    "era5_vertical_profile_adapter",
    "era5_wind_composite_adapter",
    "era5_wind_example_grid",
    "DATASET_METADATA",
    "multi_source_example_sources",
    "multi_source_fusion_adapter",
    "ocean_atmosphere_coupling_adapter",
    "ocean_atmosphere_example",
    "AEROSOL_TYPES",
    "PRECIPITATION_THRESHOLDS",
    "aerosol_energy_budget_adapter",
    "aerosol_energy_example_grid",
    "precipitation_ensemble_adapter",
    "precipitation_example_sources",
]

__version__ = "0.1.0"
