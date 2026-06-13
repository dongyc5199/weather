from pathlib import Path

from PIL import Image, ImageDraw

from weather_geo_extractor.models import ColorRange
from weather_geo_extractor.segment import detect_color_regions, load_color_profiles


def test_detect_color_regions_honors_ignore_rect(tmp_path: Path) -> None:
    image_path = tmp_path / "map.png"
    image = Image.new("RGB", (100, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 30, 30), fill=(0, 200, 255))
    draw.rectangle((60, 60, 90, 90), fill=(0, 200, 255))
    image.save(image_path)

    regions, _ = detect_color_regions(
        image_path,
        [ColorRange(label="cyan", lower_hsv=(90, 80, 80), upper_hsv=(105, 255, 255))],
        min_area_px=50,
        ignore_rects=[(0, 0, 50, 50)],
    )

    assert len(regions) == 1
    x_min, y_min, x_max, y_max = regions[0].pixel_bbox()
    assert x_min >= 55
    assert y_min >= 55


def test_detect_color_regions_can_preserve_tiny_regions_without_morph_open(tmp_path: Path) -> None:
    image_path = tmp_path / "tiny.png"
    image = Image.new("RGB", (40, 40), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 12, 12), fill=(0, 200, 255))
    image.save(image_path)

    coarse_regions, _ = detect_color_regions(
        image_path,
        [ColorRange(label="cyan", lower_hsv=(90, 80, 80), upper_hsv=(105, 255, 255))],
        min_area_px=0.5,
        simplify_epsilon=0.1,
        morph_kernel_size=5,
        morph_open=True,
        morph_close=True,
    )
    fine_regions, _ = detect_color_regions(
        image_path,
        [ColorRange(label="cyan", lower_hsv=(90, 80, 80), upper_hsv=(105, 255, 255))],
        min_area_px=1,
        simplify_epsilon=0.1,
        morph_kernel_size=1,
        morph_open=False,
        morph_close=False,
    )

    assert len(coarse_regions) == 0
    assert len(fine_regions) == 1


def test_nmc_wind_profile_rejects_pale_river_lines(tmp_path: Path) -> None:
    image_path = tmp_path / "river-vs-wind.png"
    image = Image.new("RGB", (160, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 20, 70, 70), fill=(0, 200, 255))
    draw.line((90, 20, 150, 30, 90, 45, 150, 60), fill=(132, 204, 212), width=5)
    image.save(image_path)

    profiles = [
        profile
        for profile in load_color_profiles("examples/color_profiles.nmc_wind.json")
        if profile.label == "wind_level_6_cyan"
    ]
    regions, _ = detect_color_regions(
        image_path,
        profiles,
        min_area_px=20,
        simplify_epsilon=0.5,
        morph_kernel_size=1,
        morph_open=False,
        morph_close=False,
    )

    assert len(regions) == 1
    x_min, _, x_max, _ = regions[0].pixel_bbox()
    assert x_min < 25
    assert x_max < 75


def test_morph_close_repairs_thin_black_wind_barb_gaps(tmp_path: Path) -> None:
    image_path = tmp_path / "wind-barb-gap.png"
    image = Image.new("RGB", (120, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((25, 20, 95, 80), fill=(0, 200, 255))
    draw.line((0, 34, 70, 50), fill="black", width=5)
    draw.line((30, 38, 30, 20), fill="black", width=3)
    draw.line((38, 40, 38, 23), fill="black", width=3)
    image.save(image_path)

    profile = [ColorRange(label="cyan", lower_hsv=(92, 180, 190), upper_hsv=(101, 255, 255))]
    raw_regions, _ = detect_color_regions(
        image_path,
        profile,
        min_area_px=20,
        simplify_epsilon=0.5,
        morph_kernel_size=1,
        morph_open=False,
        morph_close=False,
    )
    repaired_regions, _ = detect_color_regions(
        image_path,
        profile,
        min_area_px=20,
        simplify_epsilon=0.5,
        morph_kernel_size=5,
        morph_open=False,
        morph_close=True,
    )

    assert len(raw_regions) > 1
    assert len(repaired_regions) == 1
    assert repaired_regions[0].area_px > raw_regions[0].area_px
