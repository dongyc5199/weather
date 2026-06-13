import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

from weather_geo_extractor import extract_nmc_wind_geojson
import weather_geo_extractor.api as extractor_api


def test_extract_nmc_wind_geojson_writes_output_with_custom_profile(tmp_path: Path) -> None:
    image_path = tmp_path / "weather.png"
    image = Image.new("RGB", (80, 80), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle([20, 20, 55, 50], fill=(255, 0, 0))
    image.save(image_path)

    profile_path = tmp_path / "profile.json"
    profile_path.write_text(
        json.dumps(
            {
                "profiles": [
                    {
                        "label": "test_red_region",
                        "lower_hsv": [0, 120, 120],
                        "upper_hsv": [10, 255, 255],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    output_path = tmp_path / "regions.geojson"
    payload = extract_nmc_wind_geojson(
        image=image_path,
        profile=profile_path,
        calibration=None,
        output=output_path,
        min_area_px=20,
        simplify_epsilon=1,
        morph_kernel_size=1,
    )

    written = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["properties"]["region_count"] == 1
    assert written["features"][0]["properties"]["label"] == "test_red_region"


def test_extract_nmc_wind_geojson_accepts_url_without_image_output(tmp_path: Path, monkeypatch) -> None:
    image_path = tmp_path / "weather.png"
    image = Image.new("RGB", (80, 80), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle([20, 20, 55, 50], fill=(255, 0, 0))
    image.save(image_path)

    profile_path = tmp_path / "profile.json"
    profile_path.write_text(
        json.dumps(
            {
                "profiles": [
                    {
                        "label": "test_red_region",
                        "lower_hsv": [0, 120, 120],
                        "upper_hsv": [10, 255, 255],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    def fake_download(url: str, output: str | Path) -> Path:
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(image_path, output_path)
        return output_path

    monkeypatch.setattr(extractor_api, "_download_url", fake_download)

    source_url = "https://image.nmc.cn/example.jpg"
    output_path = tmp_path / "regions.geojson"
    payload = extract_nmc_wind_geojson(
        url=source_url,
        profile=profile_path,
        calibration=None,
        output=output_path,
        min_area_px=20,
        simplify_epsilon=1,
        morph_kernel_size=1,
    )

    assert payload["properties"]["source_url"] == source_url
    assert payload["features"][0]["properties"]["source_image"] == source_url
    assert output_path.exists()
