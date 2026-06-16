from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from .adapters import (
    build_gfs_gust_url,
    gfs_gust_adapter,
    gpm_imerg_adapter,
    load_json,
    open_meteo_point_adapter,
)
from .exif import extract_gps
from .geojson import regions_to_geojson
from .georef import (
    LinearBBoxGeoReference,
    PolynomialControlPointGeoReference,
    calibration_ignore_rects,
    load_calibration_document,
)
from .models import BBox
from .segment import detect_color_regions, load_color_profiles

PACKAGE_ROOT = Path(__file__).resolve().parent
DEFAULT_NMC_PROFILE = str(PACKAGE_ROOT / "resources" / "color_profiles.nmc_wind.json")
DEFAULT_NMC_CALIBRATION = str(PACKAGE_ROOT / "resources" / "calibration.nmc_wind_china.json")
DEFAULT_VIEWER_IMAGE_OUTPUT = "data/nmc-wind-viewer-latest.jpg"
DEFAULT_NMC_MIN_AREA_PX = 50.0
DEFAULT_NMC_SIMPLIFY_EPSILON = 0.8
DEFAULT_NMC_MORPH_KERNEL_SIZE = 5
DEFAULT_NMC_MORPH_OPEN = False
DEFAULT_NMC_MORPH_CLOSE = True
NMC_BEIJING_TZ = timezone(timedelta(hours=8), "Asia/Shanghai")
NMC_UTC_TZ = timezone.utc
NMC_WIND_URL_TEMPLATE = (
    "https://image.nmc.cn/product/{year}/{month}/{day}/STFC/"
    "SEVP_NMC_STFC_SFER_EDA_ACHN_L88_PB_{stamp}0000000.jpg"
)


def _parse_rects(rects: list[list[int]] | None) -> list[tuple[int, int, int, int]]:
    parsed: list[tuple[int, int, int, int]] = []
    for rect in rects or []:
        x1, y1, x2, y2 = rect
        if x1 >= x2 or y1 >= y2:
            raise ValueError("rect values must be ordered as x1 y1 x2 y2")
        parsed.append((x1, y1, x2, y2))
    return parsed


def _write_json(payload: dict[str, Any], output: str | Path | None) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if output:
        path = Path(output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


def _validate_image_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL must start with http:// or https://")
    return url


def _parse_beijing_hour(value: str) -> datetime:
    raw_value = value.strip()
    formats = ("%Y%m%d%H%M", "%Y%m%d%H", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H", "%Y-%m-%d %H")
    for date_format in formats:
        try:
            parsed = datetime.strptime(raw_value, date_format)
        except ValueError:
            continue
        if parsed.minute != 0 or parsed.second != 0 or parsed.microsecond != 0:
            raise ValueError("NMC wind series currently supports whole-hour times only")
        return parsed.replace(tzinfo=NMC_BEIJING_TZ)
    raise ValueError("time must be like 202606101600 or 2026-06-10T16:00 in Beijing time")


def _iter_beijing_hours(start: datetime, end: datetime) -> list[datetime]:
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("start and end must be timezone-aware Beijing datetimes")
    if end < start:
        raise ValueError("end time must be greater than or equal to start time")
    hours: list[datetime] = []
    current = start
    while current <= end:
        hours.append(current)
        current += timedelta(hours=1)
    return hours


def _beijing_hour_id(value: datetime) -> str:
    return value.astimezone(NMC_BEIJING_TZ).strftime("%Y%m%d%H%M")


def _beijing_hour_label(value: datetime) -> str:
    return value.astimezone(NMC_BEIJING_TZ).strftime("%m/%d %H:%M")


def _nmc_wind_url_for_beijing_hour(value: datetime, template: str = NMC_WIND_URL_TEMPLATE) -> str:
    utc_value = value.astimezone(NMC_UTC_TZ)
    return template.format(
        year=utc_value.strftime("%Y"),
        month=utc_value.strftime("%m"),
        day=utc_value.strftime("%d"),
        hour=utc_value.strftime("%H"),
        stamp=utc_value.strftime("%Y%m%d%H"),
    )


def _relative_manifest_url(path: str | Path, manifest_output: str | Path) -> str:
    path = Path(path)
    manifest_dir = Path(manifest_output).parent
    relative_path = os.path.relpath(path, manifest_dir)
    posix_path = Path(relative_path).as_posix()
    return posix_path if posix_path.startswith(".") else f"./{posix_path}"


def _feature_level_rank(feature: dict[str, Any]) -> int:
    label = str(feature.get("properties", {}).get("label", ""))
    marker = "level_"
    if marker not in label:
        return 0
    value = label.split(marker, 1)[1].split("_", 1)[0]
    return int(value) if value.isdigit() else 0


def _count_geometry_points(geometry: dict[str, Any] | None) -> int:
    if not geometry:
        return 0
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Polygon":
        polygons = [coordinates or []]
    elif geometry.get("type") == "MultiPolygon":
        polygons = coordinates or []
    else:
        return 0
    total = 0
    for polygon in polygons:
        for ring in polygon:
            if isinstance(ring, list):
                total += len(ring)
    return total


def _summarize_geojson_for_manifest(payload: dict[str, Any]) -> dict[str, Any]:
    features = payload.get("features") if isinstance(payload.get("features"), list) else []
    labels = Counter(str(feature.get("properties", {}).get("label", "unknown")) for feature in features)
    return {
        "regionCount": len(features),
        "severeCount": sum(1 for feature in features if _feature_level_rank(feature) >= 7),
        "pointCount": sum(_count_geometry_points(feature.get("geometry")) for feature in features),
        "totalAreaPx": sum(float(feature.get("properties", {}).get("area_px", 0) or 0) for feature in features),
        "labels": dict(sorted(labels.items())),
    }


def _default_manifest_title(start: datetime, end: datetime) -> str:
    start_local = start.astimezone(NMC_BEIJING_TZ)
    end_local = end.astimezone(NMC_BEIJING_TZ)
    if start_local.date() == end_local.date():
        return f"{start_local.month}月{start_local.day}日大风过程"
    return f"{start_local.strftime('%m/%d %H:%M')}-{end_local.strftime('%m/%d %H:%M')} 大风过程"


def _resolve_default_index(items: list[dict[str, Any]], mode: str) -> int:
    if not items:
        return 0
    if mode == "first":
        return 0
    if mode == "peak":
        return max(range(len(items)), key=lambda index: int(items[index].get("regionCount", 0) or 0))
    if mode == "latest":
        return len(items) - 1
    try:
        index = int(mode)
    except ValueError as exc:
        raise ValueError("--default-index must be first, latest, peak, or an integer") from exc
    return max(0, min(len(items) - 1, index))


def _build_nmc_wind_manifest(
    *,
    items: list[dict[str, Any]],
    start: datetime,
    end: datetime,
    name: str | None,
    title: str | None,
    default_index: str,
) -> dict[str, Any]:
    resolved_default_index = _resolve_default_index(items, default_index)
    peak_region_item = max(items, key=lambda item: int(item.get("regionCount", 0) or 0)) if items else {}
    peak_severe_item = max(items, key=lambda item: int(item.get("severeCount", 0) or 0)) if items else {}
    peak_area_item = max(items, key=lambda item: float(item.get("totalAreaPx", 0) or 0)) if items else {}
    return {
        "name": name or f"nmc_wind_{_beijing_hour_id(start)}_{_beijing_hour_id(end)}",
        "title": title or _default_manifest_title(start, end),
        "timezone": "Asia/Shanghai",
        "defaultIndex": resolved_default_index,
        "generatedBy": "weather-geo-extractor",
        "summary": {
            "startLabel": _beijing_hour_label(start),
            "endLabel": _beijing_hour_label(end),
            "hourCount": len(items),
            "peakRegionTime": peak_region_item.get("label"),
            "peakRegionCount": peak_region_item.get("regionCount", 0),
            "peakSevereTime": peak_severe_item.get("label"),
            "peakSevereCount": peak_severe_item.get("severeCount", 0),
            "peakAreaTime": peak_area_item.get("label"),
            "peakAreaPx": peak_area_item.get("totalAreaPx", 0),
        },
        "items": items,
    }


def _handle_exif(args: argparse.Namespace) -> None:
    result = extract_gps(args.image)
    _write_json(json.loads(result.to_json()), args.output)


def _build_detection_payload(
    *,
    image: str | Path,
    profile: str | Path,
    calibration: str | Path | None,
    bbox: list[float] | None,
    map_rect: list[float] | None,
    ignore_rect: list[list[int]] | None,
    min_area_px: float,
    simplify_epsilon: float,
    morph_kernel_size: int,
    morph_open: bool,
    morph_close: bool,
) -> dict[str, Any]:
    calibration_payload = load_calibration_document(calibration) if calibration else None
    ignore_rects: list[tuple[int, int, int, int]] = []
    if calibration_payload:
        ignore_rects.extend(calibration_ignore_rects(calibration_payload))
    ignore_rects.extend(_parse_rects(ignore_rect))

    profiles = load_color_profiles(profile)
    regions, (width, height) = detect_color_regions(
        image,
        profiles,
        min_area_px=min_area_px,
        simplify_epsilon=simplify_epsilon,
        ignore_rects=ignore_rects,
        morph_kernel_size=morph_kernel_size,
        morph_open=morph_open,
        morph_close=morph_close,
    )

    georef = None
    if calibration_payload is not None:
        georef = PolynomialControlPointGeoReference.from_mapping(
            calibration_payload,
            width=width,
            height=height,
        )
    elif bbox is not None:
        map_rect = map_rect or [0, 0, width - 1, height - 1]
        georef = LinearBBoxGeoReference(
            width=width,
            height=height,
            bbox=BBox.from_sequence(bbox),
            x_min=map_rect[0],
            y_min=map_rect[1],
            x_max=map_rect[2],
            y_max=map_rect[3],
        )

    payload = regions_to_geojson(regions, georef=georef, source_image=image)
    payload["properties"]["image_width_px"] = width
    payload["properties"]["image_height_px"] = height
    payload["properties"]["region_count"] = len(regions)
    payload["properties"]["segmentation"] = {
        "min_area_px": min_area_px,
        "simplify_epsilon": simplify_epsilon,
        "morph_kernel_size": morph_kernel_size,
        "morph_open": morph_open,
        "morph_close": morph_close,
    }
    return payload


def _handle_detect(args: argparse.Namespace) -> None:
    payload = _build_detection_payload(
        image=args.image,
        profile=args.profile,
        calibration=args.calibration,
        bbox=args.bbox,
        map_rect=args.map_rect,
        ignore_rect=args.ignore_rect,
        min_area_px=args.min_area_px,
        simplify_epsilon=args.simplify_epsilon,
        morph_kernel_size=args.morph_kernel_size,
        morph_open=not args.no_morph_open,
        morph_close=not args.no_morph_close,
    )
    _write_json(payload, args.output)


def _download_url(url: str, output: str | Path) -> Path:
    url = _validate_image_url(url)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=30) as response:
        path.write_bytes(response.read())
    return path


def _attach_source_url(payload: dict[str, Any], url: str) -> None:
    payload["properties"]["source_url"] = url
    for feature in payload.get("features", []):
        if isinstance(feature, dict) and isinstance(feature.get("properties"), dict):
            feature["properties"]["source_image"] = url


def _static_url_for_path(path: str | Path, root: str | Path) -> str:
    resolved_path = Path(path).resolve()
    resolved_root = Path(root).resolve()
    relative_path = resolved_path.relative_to(resolved_root)
    return "/" + quote(relative_path.as_posix())


def _handle_process_nmc_wind(args: argparse.Namespace) -> None:
    if not args.url and not args.image:
        raise ValueError("process-nmc-wind requires --url or --image")
    if args.url and args.image:
        raise ValueError("use only one of --url or --image")

    def build_payload(image_path: str | Path) -> dict[str, Any]:
        return _build_detection_payload(
            image=image_path,
            profile=args.profile,
            calibration=args.calibration,
            bbox=None,
            map_rect=None,
            ignore_rect=args.ignore_rect,
            min_area_px=args.min_area_px,
            simplify_epsilon=args.simplify_epsilon,
            morph_kernel_size=args.morph_kernel_size,
            morph_open=not args.no_morph_open,
            morph_close=not args.no_morph_close,
        )

    if args.image:
        payload = build_payload(Path(args.image))
    elif args.image_output:
        payload = build_payload(_download_url(args.url, args.image_output))
    else:
        with tempfile.TemporaryDirectory(prefix="weather-geo-") as temp_dir:
            image_path = _download_url(args.url, Path(temp_dir) / "source.jpg")
            payload = build_payload(image_path)

    if args.url:
        _attach_source_url(payload, args.url)
    _write_json(payload, args.output)


def _handle_process_nmc_wind_series(args: argparse.Namespace) -> None:
    start = _parse_beijing_hour(args.start)
    end = _parse_beijing_hour(args.end)
    hours = _iter_beijing_hours(start, end)
    image_dir = Path(args.image_dir)
    geojson_dir = Path(args.geojson_dir)
    manifest_output = Path(args.manifest_output)
    image_dir.mkdir(parents=True, exist_ok=True)
    geojson_dir.mkdir(parents=True, exist_ok=True)

    items: list[dict[str, Any]] = []
    for hour in hours:
        hour_id = _beijing_hour_id(hour)
        label = _beijing_hour_label(hour)
        source_url = _nmc_wind_url_for_beijing_hour(hour, template=args.url_template)
        image_path = image_dir / f"{hour_id}.jpg"
        geojson_path = geojson_dir / f"{hour_id}.geojson"
        if args.force_download or not image_path.exists():
            print(f"Downloading {label}: {source_url}")
            _download_url(source_url, image_path)
        else:
            print(f"Using existing image for {label}: {image_path}")

        payload = _build_detection_payload(
            image=image_path,
            profile=args.profile,
            calibration=args.calibration,
            bbox=None,
            map_rect=None,
            ignore_rect=args.ignore_rect,
            min_area_px=args.min_area_px,
            simplify_epsilon=args.simplify_epsilon,
            morph_kernel_size=args.morph_kernel_size,
            morph_open=not args.no_morph_open,
            morph_close=not args.no_morph_close,
        )
        payload["properties"]["source_url"] = source_url
        payload["properties"]["source_time_bjt"] = label
        _write_json(payload, geojson_path)

        item = {
            "id": hour_id,
            "label": label,
            "geojsonUrl": _relative_manifest_url(geojson_path, manifest_output),
            "imageUrl": _relative_manifest_url(image_path, manifest_output),
            "downloadName": f"nmc-wind-{hour_id}.geojson",
            "sourceUrl": source_url,
            **_summarize_geojson_for_manifest(payload),
        }
        items.append(item)

    manifest = _build_nmc_wind_manifest(
        items=items,
        start=start,
        end=end,
        name=args.name,
        title=args.title,
        default_index=args.default_index,
    )
    _write_json(manifest, manifest_output)
    print(f"Wrote manifest: {manifest_output}")


def _handle_calibration_report(args: argparse.Namespace) -> None:
    payload = load_calibration_document(args.calibration)
    image_size = payload.get("image_size") or [2818, 2383]
    width, height = int(image_size[0]), int(image_size[1])
    if args.image:
        from PIL import Image

        with Image.open(args.image) as image:
            width, height = image.size
    georef = PolynomialControlPointGeoReference.from_mapping(payload, width=width, height=height)
    _write_json(georef.calibration_report(), args.output)


def _handle_gfs_gust_url(args: argparse.Namespace) -> None:
    payload = {
        "adapter": "gfs_gust_adapter",
        "source": "NOAA GFS / NOMADS",
        "url": build_gfs_gust_url(
            cycle=args.cycle,
            forecast_hour=args.forecast_hour,
            bbox=args.bbox,
            resolution=args.resolution,
            base_url=args.base_url,
        ),
    }
    _write_json(payload, args.output)


def _handle_gfs_gust_adapter(args: argparse.Namespace) -> None:
    _write_json(gfs_gust_adapter(load_json(args.grid_json)), args.output)


def _handle_gpm_imerg_adapter(args: argparse.Namespace) -> None:
    _write_json(gpm_imerg_adapter(load_json(args.grid_json)), args.output)


def _handle_open_meteo_point_adapter(args: argparse.Namespace) -> None:
    _write_json(
        open_meteo_point_adapter(
            latitude=args.lat,
            longitude=args.lon,
            start=args.start,
            end=args.end,
            name=args.name,
            timezone=args.timezone,
            endpoint=args.endpoint,
        ),
        args.output,
    )


def _write_http_json(handler: SimpleHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class MapViewerRequestHandler(SimpleHTTPRequestHandler):
    def __init__(
        self,
        *args: Any,
        directory: str | None = None,
        profile: str = DEFAULT_NMC_PROFILE,
        calibration: str = DEFAULT_NMC_CALIBRATION,
        image_output: str = DEFAULT_VIEWER_IMAGE_OUTPUT,
        min_area_px: float = DEFAULT_NMC_MIN_AREA_PX,
        simplify_epsilon: float = DEFAULT_NMC_SIMPLIFY_EPSILON,
        morph_kernel_size: int = DEFAULT_NMC_MORPH_KERNEL_SIZE,
        morph_open: bool = DEFAULT_NMC_MORPH_OPEN,
        morph_close: bool = DEFAULT_NMC_MORPH_CLOSE,
        **kwargs: Any,
    ) -> None:
        self.profile = profile
        self.calibration = calibration
        self.image_output = image_output
        self.viewer_root = Path(directory or ".").resolve()
        self.min_area_px = min_area_px
        self.simplify_epsilon = simplify_epsilon
        self.morph_kernel_size = morph_kernel_size
        self.morph_open = morph_open
        self.morph_close = morph_close
        super().__init__(*args, directory=directory, **kwargs)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Allow", "GET,POST,OPTIONS")
        self.end_headers()

    def do_POST(self) -> None:
        if self.path != "/api/process-nmc-wind":
            _write_http_json(self, 404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8192:
                raise ValueError("request body must be 1-8192 bytes")
            request_payload = json.loads(self.rfile.read(length).decode("utf-8"))
            url = _validate_image_url(str(request_payload.get("url", "")).strip())
            image_output = Path(self.image_output)
            if not image_output.is_absolute():
                image_output = self.viewer_root / image_output
            image_path = _download_url(url, image_output)
            payload = _build_detection_payload(
                image=image_path,
                profile=self.profile,
                calibration=self.calibration,
                bbox=None,
                map_rect=None,
                ignore_rect=None,
                min_area_px=self.min_area_px,
                simplify_epsilon=self.simplify_epsilon,
                morph_kernel_size=self.morph_kernel_size,
                morph_open=self.morph_open,
                morph_close=self.morph_close,
            )
            payload["properties"]["source_url"] = url
            payload["properties"]["local_image_url"] = (
                f"{_static_url_for_path(image_path, self.viewer_root)}?v={image_path.stat().st_mtime_ns}"
            )
            payload["properties"]["viewer_api"] = "process-nmc-wind"
            _write_http_json(self, 200, payload)
        except Exception as exc:
            _write_http_json(self, 400, {"error": str(exc)})


def _handle_serve_map(args: argparse.Namespace) -> None:
    root = Path(args.root).resolve()
    if not root.exists():
        raise ValueError(f"root does not exist: {root}")

    handler = partial(
        MapViewerRequestHandler,
        directory=str(root),
        profile=args.profile,
        calibration=args.calibration,
        image_output=args.image_output,
        min_area_px=args.min_area_px,
        simplify_epsilon=args.simplify_epsilon,
        morph_kernel_size=args.morph_kernel_size,
        morph_open=not args.no_morph_open,
        morph_close=not args.no_morph_close,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}/viewer/index.html"
    print(f"Serving map viewer at {url}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="weather-geo",
        description="Image recognition and longitude/latitude extraction tools.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    exif_parser = subparsers.add_parser("exif", help="Extract GPS latitude/longitude from image EXIF.")
    exif_parser.add_argument("image", help="Input image path.")
    exif_parser.add_argument("--output", "-o", help="Optional JSON output path.")
    exif_parser.set_defaults(func=_handle_exif)

    detect_parser = subparsers.add_parser(
        "detect",
        help="Detect colored map regions and export pixel or approximate lon/lat GeoJSON.",
    )
    detect_parser.add_argument("image", help="Input map/weather image path.")
    detect_parser.add_argument("--profile", required=True, help="Color profile JSON path.")
    detect_parser.add_argument(
        "--calibration",
        help="Control-point calibration JSON path. Overrides --bbox georeferencing when present.",
    )
    detect_parser.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        metavar=("MIN_LON", "MIN_LAT", "MAX_LON", "MAX_LAT"),
        help="Map lon/lat bbox for linear georeferencing.",
    )
    detect_parser.add_argument("--output", "-o", help="Optional GeoJSON output path.")
    detect_parser.add_argument("--min-area-px", type=float, default=200.0, help="Ignore smaller regions.")
    detect_parser.add_argument(
        "--ignore-rect",
        action="append",
        nargs=4,
        type=int,
        metavar=("X1", "Y1", "X2", "Y2"),
        help="Pixel rectangle to exclude from segmentation. Can be repeated.",
    )
    detect_parser.add_argument(
        "--map-rect",
        nargs=4,
        type=float,
        metavar=("X1", "Y1", "X2", "Y2"),
        help="Pixel rectangle representing the lon/lat bbox extent for georeferencing.",
    )
    detect_parser.add_argument(
        "--simplify-epsilon",
        type=float,
        default=2.0,
        help="OpenCV polygon simplification epsilon in pixels.",
    )
    detect_parser.add_argument("--morph-kernel-size", type=int, default=3)
    detect_parser.add_argument("--no-morph-open", action="store_true", help="Disable morphological opening.")
    detect_parser.add_argument("--no-morph-close", action="store_true", help="Disable morphological closing.")
    detect_parser.set_defaults(func=_handle_detect)

    nmc_parser = subparsers.add_parser(
        "process-nmc-wind",
        help="Download or read an NMC wind-speed map and export calibrated GeoJSON.",
    )
    nmc_parser.add_argument("--url", help="NMC image URL to download.")
    nmc_parser.add_argument("--image", help="Local NMC image path.")
    nmc_parser.add_argument(
        "--image-output",
        help=argparse.SUPPRESS,
    )
    nmc_parser.add_argument("--output", "-o", default="outputs/nmc-wind-regions-calibrated.geojson")
    nmc_parser.add_argument("--profile", default=DEFAULT_NMC_PROFILE)
    nmc_parser.add_argument("--calibration", default=DEFAULT_NMC_CALIBRATION)
    nmc_parser.add_argument("--min-area-px", type=float, default=DEFAULT_NMC_MIN_AREA_PX)
    nmc_parser.add_argument("--simplify-epsilon", type=float, default=DEFAULT_NMC_SIMPLIFY_EPSILON)
    nmc_parser.add_argument("--morph-kernel-size", type=int, default=DEFAULT_NMC_MORPH_KERNEL_SIZE)
    nmc_parser.add_argument(
        "--no-morph-open",
        action="store_true",
        default=not DEFAULT_NMC_MORPH_OPEN,
        help="Disable morphological opening.",
    )
    nmc_parser.add_argument(
        "--no-morph-close",
        action="store_true",
        default=not DEFAULT_NMC_MORPH_CLOSE,
        help="Disable morphological closing.",
    )
    nmc_parser.add_argument(
        "--ignore-rect",
        action="append",
        nargs=4,
        type=int,
        metavar=("X1", "Y1", "X2", "Y2"),
        help="Additional pixel rectangle to exclude. Can be repeated.",
    )
    nmc_parser.set_defaults(func=_handle_process_nmc_wind)

    nmc_series_parser = subparsers.add_parser(
        "process-nmc-wind-series",
        help="Process an inclusive Beijing-time hourly NMC wind map range and write GeoJSON plus manifest.",
    )
    nmc_series_parser.add_argument("--start", required=True, help="Beijing start hour, e.g. 202606101600.")
    nmc_series_parser.add_argument("--end", required=True, help="Beijing end hour, inclusive, e.g. 202606102200.")
    nmc_series_parser.add_argument("--image-dir", default="data/nmc-wind", help="Directory for downloaded JPG files.")
    nmc_series_parser.add_argument("--geojson-dir", default="outputs/nmc-wind", help="Directory for hourly GeoJSON files.")
    nmc_series_parser.add_argument(
        "--manifest-output",
        default="outputs/nmc-wind/manifest.json",
        help="Manifest JSON path consumed by the map viewer.",
    )
    nmc_series_parser.add_argument("--title", help="Optional manifest title.")
    nmc_series_parser.add_argument("--name", help="Optional manifest stable name.")
    nmc_series_parser.add_argument(
        "--default-index",
        default="latest",
        help="Viewer default time: first, latest, peak, or a zero-based integer.",
    )
    nmc_series_parser.add_argument(
        "--url-template",
        default=NMC_WIND_URL_TEMPLATE,
        help="NMC high-resolution URL template. Supports {year}, {month}, {day}, {hour}, {stamp}.",
    )
    nmc_series_parser.add_argument("--force-download", action="store_true", help="Redownload images even if present.")
    nmc_series_parser.add_argument("--profile", default=DEFAULT_NMC_PROFILE)
    nmc_series_parser.add_argument("--calibration", default=DEFAULT_NMC_CALIBRATION)
    nmc_series_parser.add_argument("--min-area-px", type=float, default=DEFAULT_NMC_MIN_AREA_PX)
    nmc_series_parser.add_argument("--simplify-epsilon", type=float, default=DEFAULT_NMC_SIMPLIFY_EPSILON)
    nmc_series_parser.add_argument("--morph-kernel-size", type=int, default=DEFAULT_NMC_MORPH_KERNEL_SIZE)
    nmc_series_parser.add_argument(
        "--no-morph-open",
        action="store_true",
        default=not DEFAULT_NMC_MORPH_OPEN,
        help="Disable morphological opening.",
    )
    nmc_series_parser.add_argument(
        "--no-morph-close",
        action="store_true",
        default=not DEFAULT_NMC_MORPH_CLOSE,
        help="Disable morphological closing.",
    )
    nmc_series_parser.add_argument(
        "--ignore-rect",
        action="append",
        nargs=4,
        type=int,
        metavar=("X1", "Y1", "X2", "Y2"),
        help="Additional pixel rectangle to exclude. Can be repeated.",
    )
    nmc_series_parser.set_defaults(func=_handle_process_nmc_wind_series)

    report_parser = subparsers.add_parser(
        "calibration-report",
        help="Report residual error for a control-point calibration JSON file.",
    )
    report_parser.add_argument("calibration", help="Control-point calibration JSON path.")
    report_parser.add_argument("--image", help="Optional image path for current image dimensions.")
    report_parser.add_argument("--output", "-o", help="Optional JSON output path.")
    report_parser.set_defaults(func=_handle_calibration_report)

    gfs_url_parser = subparsers.add_parser(
        "gfs-gust-url",
        help="Build an open NOAA NOMADS URL for GFS surface gust GRIB2 data.",
    )
    gfs_url_parser.add_argument("--cycle", required=True, help="UTC GFS cycle, e.g. 2026061000.")
    gfs_url_parser.add_argument("--forecast-hour", type=int, required=True, help="Forecast hour, e.g. 18.")
    gfs_url_parser.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        metavar=("MIN_LON", "MIN_LAT", "MAX_LON", "MAX_LAT"),
        help="Optional subregion bbox.",
    )
    gfs_url_parser.add_argument("--resolution", default="0p25", help="GFS resolution token, default 0p25.")
    gfs_url_parser.add_argument("--base-url", default="https://nomads.ncep.noaa.gov/cgi-bin")
    gfs_url_parser.add_argument("--output", "-o", help="Optional JSON output path.")
    gfs_url_parser.set_defaults(func=_handle_gfs_gust_url)

    gfs_adapter_parser = subparsers.add_parser(
        "gfs-gust-adapter",
        help="Convert decoded GFS gust grid JSON into Weather Earth wind-region GeoJSON.",
    )
    gfs_adapter_parser.add_argument("--grid-json", required=True, help="Decoded grid JSON with lons, lats and values/gust.")
    gfs_adapter_parser.add_argument("--output", "-o", help="Optional GeoJSON output path.")
    gfs_adapter_parser.set_defaults(func=_handle_gfs_gust_adapter)

    gpm_adapter_parser = subparsers.add_parser(
        "gpm-imerg-adapter",
        help="Convert decoded GPM IMERG precipitation grid JSON into Weather Earth rain-region GeoJSON.",
    )
    gpm_adapter_parser.add_argument("--grid-json", required=True, help="Decoded grid JSON with lons, lats and precipitation values.")
    gpm_adapter_parser.add_argument("--output", "-o", help="Optional GeoJSON output path.")
    gpm_adapter_parser.set_defaults(func=_handle_gpm_imerg_adapter)

    open_meteo_parser = subparsers.add_parser(
        "open-meteo-point-adapter",
        help="Fetch Open-Meteo hourly point data and export Weather Earth station GeoJSON.",
    )
    open_meteo_parser.add_argument("--lat", type=float, required=True, help="Latitude.")
    open_meteo_parser.add_argument("--lon", type=float, required=True, help="Longitude.")
    open_meteo_parser.add_argument("--start", required=True, help="Start time, e.g. 2026-06-10T18:00.")
    open_meteo_parser.add_argument("--end", required=True, help="End time, e.g. 2026-06-10T22:00.")
    open_meteo_parser.add_argument("--name", default="Open-Meteo point", help="Feature name.")
    open_meteo_parser.add_argument("--timezone", default="Asia/Shanghai")
    open_meteo_parser.add_argument("--endpoint", default="https://api.open-meteo.com/v1/forecast")
    open_meteo_parser.add_argument("--output", "-o", help="Optional GeoJSON output path.")
    open_meteo_parser.set_defaults(func=_handle_open_meteo_point_adapter)

    serve_parser = subparsers.add_parser("serve-map", help="Serve the local Leaflet map viewer.")
    serve_parser.add_argument("--host", default="127.0.0.1", help="Host to bind.")
    serve_parser.add_argument("--port", type=int, default=8765, help="Port to bind.")
    serve_parser.add_argument(
        "--root",
        default=".",
        help="Project root to serve. Defaults to current directory.",
    )
    serve_parser.add_argument("--profile", default=DEFAULT_NMC_PROFILE)
    serve_parser.add_argument("--calibration", default=DEFAULT_NMC_CALIBRATION)
    serve_parser.add_argument("--image-output", default=DEFAULT_VIEWER_IMAGE_OUTPUT)
    serve_parser.add_argument("--min-area-px", type=float, default=DEFAULT_NMC_MIN_AREA_PX)
    serve_parser.add_argument("--simplify-epsilon", type=float, default=DEFAULT_NMC_SIMPLIFY_EPSILON)
    serve_parser.add_argument("--morph-kernel-size", type=int, default=DEFAULT_NMC_MORPH_KERNEL_SIZE)
    serve_parser.add_argument(
        "--no-morph-open",
        action="store_true",
        default=not DEFAULT_NMC_MORPH_OPEN,
        help="Disable morphological opening.",
    )
    serve_parser.add_argument(
        "--no-morph-close",
        action="store_true",
        default=not DEFAULT_NMC_MORPH_CLOSE,
        help="Disable morphological closing.",
    )
    serve_parser.set_defaults(func=_handle_serve_map)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
