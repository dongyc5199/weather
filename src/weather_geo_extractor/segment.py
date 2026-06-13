from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .models import ColorRange, PixelPoint, PixelRegion


def load_color_profiles(profile_path: str | Path) -> list[ColorRange]:
    path = Path(profile_path)
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    profiles = payload.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise ValueError(f"{path} must contain a non-empty 'profiles' array")
    return [ColorRange.from_mapping(item) for item in profiles]


def detect_color_regions(
    image_path: str | Path,
    color_ranges: list[ColorRange],
    *,
    min_area_px: float = 200.0,
    simplify_epsilon: float = 2.0,
    ignore_rects: list[tuple[int, int, int, int]] | None = None,
    morph_kernel_size: int = 3,
    morph_open: bool = True,
    morph_close: bool = True,
) -> tuple[list[PixelRegion], tuple[int, int]]:
    """Detect colored regions in an image using OpenCV HSV segmentation."""

    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is required for image segmentation. Install with: pip install -e .") from exc

    path = Path(image_path)
    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"unable to read image: {path}")

    height, width = image.shape[:2]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    if morph_kernel_size < 1:
        raise ValueError("morph_kernel_size must be at least 1")
    kernel = np.ones((morph_kernel_size, morph_kernel_size), np.uint8)

    regions: list[PixelRegion] = []
    for color_range in color_ranges:
        lower = np.array(color_range.lower_hsv, dtype=np.uint8)
        upper = np.array(color_range.upper_hsv, dtype=np.uint8)
        mask = cv2.inRange(hsv, lower, upper)
        for x1, y1, x2, y2 in ignore_rects or []:
            left = max(0, min(width, int(x1)))
            right = max(0, min(width, int(x2)))
            top = max(0, min(height, int(y1)))
            bottom = max(0, min(height, int(y2)))
            if left < right and top < bottom:
                mask[top:bottom, left:right] = 0
        if morph_kernel_size > 1 and morph_open:
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        if morph_kernel_size > 1 and morph_close:
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < min_area_px:
                continue
            approximation = cv2.approxPolyDP(contour, simplify_epsilon, True)
            points = [
                PixelPoint(x=float(point[0][0]), y=float(point[0][1]))
                for point in approximation
            ]
            if len(points) < 3:
                continue
            regions.append(
                PixelRegion(
                    label=color_range.label,
                    polygon=points,
                    area_px=round(area, 2),
                    source_image=path,
                )
            )

    regions.sort(key=lambda item: item.area_px, reverse=True)
    return regions, (width, height)
