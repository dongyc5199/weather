from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from .cli import (
    DEFAULT_NMC_CALIBRATION,
    DEFAULT_NMC_MIN_AREA_PX,
    DEFAULT_NMC_MORPH_CLOSE,
    DEFAULT_NMC_MORPH_KERNEL_SIZE,
    DEFAULT_NMC_MORPH_OPEN,
    DEFAULT_NMC_PROFILE,
    DEFAULT_NMC_SIMPLIFY_EPSILON,
    _attach_source_url,
    _build_detection_payload,
    _download_url,
)


def extract_nmc_wind_geojson(
    *,
    image: str | Path | None = None,
    url: str | None = None,
    image_output: str | Path | None = None,
    output: str | Path | None = None,
    profile: str | Path = DEFAULT_NMC_PROFILE,
    calibration: str | Path | None = DEFAULT_NMC_CALIBRATION,
    min_area_px: float = DEFAULT_NMC_MIN_AREA_PX,
    simplify_epsilon: float = DEFAULT_NMC_SIMPLIFY_EPSILON,
    morph_kernel_size: int = DEFAULT_NMC_MORPH_KERNEL_SIZE,
    morph_open: bool = DEFAULT_NMC_MORPH_OPEN,
    morph_close: bool = DEFAULT_NMC_MORPH_CLOSE,
    ignore_rect: list[list[int]] | None = None,
) -> dict[str, Any]:
    """Extract calibrated GeoJSON wind regions from an NMC wind map image."""

    if not image and not url:
        raise ValueError("extract_nmc_wind_geojson requires image or url")
    if image and url:
        raise ValueError("use only one of image or url")

    def build_payload(image_path: str | Path) -> dict[str, Any]:
        return _build_detection_payload(
            image=image_path,
            profile=profile,
            calibration=calibration,
            bbox=None,
            map_rect=None,
            ignore_rect=ignore_rect,
            min_area_px=min_area_px,
            simplify_epsilon=simplify_epsilon,
            morph_kernel_size=morph_kernel_size,
            morph_open=morph_open,
            morph_close=morph_close,
        )

    if image:
        payload = build_payload(Path(image))
    elif image_output:
        payload = build_payload(_download_url(str(url), image_output))
    else:
        with tempfile.TemporaryDirectory(prefix="weather-geo-") as temp_dir:
            image_path = _download_url(str(url), Path(temp_dir) / "source.jpg")
            payload = build_payload(image_path)

    if url:
        _attach_source_url(payload, url)
    if output:
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload
