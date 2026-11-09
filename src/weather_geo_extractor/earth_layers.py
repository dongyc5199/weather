"""Data adapters for the local Three.js globe: terrain, imagery metadata and map tiles."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from functools import lru_cache
import gzip
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import re
import struct
import threading
import time
import tempfile
from urllib.request import Request, urlopen
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

from .earth_data import atomic_json, LAYER_KEYS

UTC = timezone.utc
DATAV = "https://geo.datav.aliyun.com/areas_v3/bound/"
COUNTRIES = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"
GIBS_CAPABILITIES = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml"
CLOUD_LAYER = "Himawari_AHI_Band13_Clean_Infrared"
_cache: dict = {}
_lock = threading.Lock()
_terrain_layer_lock = threading.Lock()
_terrain_tile_locks: dict[str, threading.Lock] = {}
_terrain_pruned_at: dict[str, float] = {}


def utc_string() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def fetch_bytes(url: str, headers: dict | None = None, limit: int = 32_000_000) -> bytes:
    request = Request(url, headers={"User-Agent": "WeatherEarth/0.1", **(headers or {})})
    with urlopen(request, timeout=30) as response:
        body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError("Map response exceeds the download limit")
    return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body


def cached(key: str, seconds: int, fn):
    with _lock:
        item = _cache.get(key)
        if item and time.monotonic() < item[0]:
            return item[1]
    value = fn()
    with _lock:
        _cache[key] = (time.monotonic() + seconds, value)
    return value


def terrain_config(viewer_root: Path) -> dict:
    """Exchange the configured client token for a short-lived, terrain-scoped token."""
    config_path = viewer_root.parent / "earth.config.local.js"

    def fetch():
        if not config_path.is_file():
            return {"available": False, "message": "尚未配置地形服务"}
        match = re.search(r"\bcesiumIonToken\s*:\s*[\"']([^\"']*)[\"']", config_path.read_text())
        if not match or not match.group(1).strip():
            return {"available": False, "message": "尚未配置地形服务"}
        payload = json.loads(fetch_bytes("https://api.cesium.com/v1/assets/1/endpoint?access_token=" + match.group(1)))
        if payload.get("type") != "TERRAIN":
            raise ValueError("The configured asset is not terrain")
        credits = [html.unescape(re.sub("<[^>]+>", "", row.get("html", ""))) for row in payload.get("attributions", [])]
        return {"available": True, "url": payload["url"], "accessToken": payload["accessToken"],
                "credits": credits, "provider": "Cesium World Terrain"}

    return cached("terrain:" + str(config_path), 900, fetch)


def terrain_bootstrap(viewer_root: Path) -> dict:
    """Cache the public terrain directory separately from short-lived credentials."""
    info = terrain_config(viewer_root)
    if not info.get("available"):
        return info
    source_id = hashlib.sha256(info["url"].encode()).hexdigest()
    path = viewer_root / "data" / "earth3d-cache" / "terrain" / (source_id + ".json")

    def directory():
        try:
            saved = json.loads(path.read_text())
            if saved["source_id"] == source_id and 0 <= time.time() - saved["fetched_at"] < 3600:
                return saved["layer"]
        except (OSError, ValueError, KeyError, TypeError):
            pass
        body = fetch_bytes(urljoin(info["url"], "layer.json"), {
            "Authorization": "Bearer " + info["accessToken"], "Accept-Encoding": "gzip",
        })
        layer = json.loads(body)
        if not isinstance(layer, dict) or not isinstance(layer.get("tiles"), list) or not layer["tiles"]:
            raise ValueError("Invalid terrain directory")
        # A directory should contain only tile templates and terrain metadata.
        # Never persist a provider response if it embeds any credential.
        serialized = json.dumps(layer)
        if info["accessToken"] not in serialized and not re.search(r'access.?token|authorization', serialized, re.I):
            atomic_json(path, {"source_id": source_id, "fetched_at": time.time(), "layer": layer})
        return layer

    try:
        with _terrain_layer_lock:
            layer = cached("terrain-layer:" + source_id, 3600, directory)
        contract = json.dumps({"url": info["url"], "tiles": layer["tiles"], "extensions": layer.get("extensions", [])}, sort_keys=True)
        return {**info, "layer": layer, "terrain_cache_key": hashlib.sha256(contract.encode()).hexdigest()}
    except Exception:
        # A transient proxy failure still permits the browser to try the provider.
        return info


def prune_terrain_cache(directory: Path, maximum_bytes: int = 256 * 1024 * 1024) -> None:
    entries = []
    for path in directory.rglob("*.terrain"):
        try:
            stat = path.stat()
            entries.append((stat.st_mtime, stat.st_size, path))
        except OSError:
            pass
    size = sum(entry[1] for entry in entries)
    for _, length, path in sorted(entries):
        if size <= maximum_bytes:
            break
        try:
            path.unlink()
            size -= length
        except OSError:
            pass


def terrain_tile(viewer_root: Path, source_id: str, z: int, x: int, y: int) -> bytes:
    """On-demand runtime cache for the configured provider, never a generic URL proxy."""
    if not re.fullmatch(r"[a-f0-9]{64}", source_id) or not 0 <= z <= 24 or not 0 <= x < 2 ** (z + 1) or not 0 <= y < 2 ** z:
        raise ValueError("Invalid terrain tile")
    directory = viewer_root / "data" / "earth3d-cache" / "terrain-tiles"
    path = directory / source_id / str(z) / str(x) / (str(y) + ".terrain")
    try:
        if 0 <= time.time() - path.stat().st_mtime < 86400:
            return path.read_bytes()
    except OSError:
        pass
    info = terrain_bootstrap(viewer_root)
    if not info.get("available") or info.get("terrain_cache_key") != source_id or not info.get("layer"):
        raise ValueError("Terrain source changed; reload the globe")
    layer = info["layer"]
    template = layer["tiles"][0]
    for name, value in {"z": z, "x": x, "y": y, "version": 1}.items():
        template = re.sub(r"\{\s*" + name + r"\s*\}", str(value), template)
    url = urljoin(info["url"], template)
    accept = "application/vnd.quantized-mesh,application/octet-stream;q=0.9"
    if layer.get("extensions"):
        accept += ";extensions=" + "-".join(layer["extensions"])
    with _lock:
        lock = _terrain_tile_locks.setdefault(str(path), threading.Lock())
    with lock:
        try:
            if 0 <= time.time() - path.stat().st_mtime < 86400:
                return path.read_bytes()
        except OSError:
            pass
        payload = fetch_bytes(url, {"Authorization": "Bearer " + info["accessToken"], "Accept": accept})
        if len(payload) < 96:
            raise ValueError("Invalid terrain content")
        vertices = struct.unpack_from("<I", payload, 88)[0]
        if not 3 <= vertices <= 5_000_000 or len(payload) < 96 + vertices * 6:
            raise ValueError("Invalid terrain content")
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, pending = tempfile.mkstemp(prefix=".tile-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(payload)
            os.replace(pending, path)
        finally:
            Path(pending).unlink(missing_ok=True)
    with _lock:
        prune = time.monotonic() - _terrain_pruned_at.get(str(directory), -60) >= 60
        if prune:
            _terrain_pruned_at[str(directory)] = time.monotonic()
    if prune:
        prune_terrain_cache(directory)
    return payload


def parse_cloud_metadata(xml: bytes) -> dict:
    ns = {"w": "http://www.opengis.net/wmts/1.0", "o": "http://www.opengis.net/ows/1.1"}
    for layer in ET.fromstring(xml).findall(".//w:Layer", ns):
        if layer.findtext("o:Identifier", "", ns) != CLOUD_LAYER:
            continue
        observation = layer.findtext("w:Dimension/w:Default", "", ns)
        observed = datetime.fromisoformat(observation.replace("Z", "+00:00"))
        if observed.tzinfo is None:
            raise ValueError("Cloud observation time has no timezone")
        return {"layer": CLOUD_LAYER, "observation_time": observation,
                "provider": "NASA GIBS / JMA Himawari AHI", "coverage": "东亚与西太平洋",
                "wms_url": "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
                "retrieved_at": utc_string()}
    raise ValueError("Himawari infrared imagery is not advertised by the source")


def cloud_metadata(cache_path: Path | None = None) -> dict:
    def latest():
        data = parse_cloud_metadata(fetch_bytes(GIBS_CAPABILITIES, {"Accept-Encoding": "gzip"}))
        if cache_path is not None:
            atomic_json(cache_path, data)
        return {**data, "stale": False}

    try:
        return cached("cloud:" + str(cache_path), 300, latest)
    except Exception:
        # Keep a real observation across server restarts and provider outages.
        if cache_path is not None and cache_path.is_file():
            return {**json.loads(cache_path.read_text()), "stale": True}
        raise


def _gcj_offset(lon: float, lat: float) -> tuple[float, float]:
    if not (72.004 < lon < 137.8347 and 0.8293 < lat < 55.8271):
        return 0.0, 0.0
    x, y = lon - 105, lat - 35
    dlat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*math.sqrt(abs(x))
    dlat += (20*math.sin(6*x*math.pi) + 20*math.sin(2*x*math.pi))*2/3
    dlat += (20*math.sin(y*math.pi) + 40*math.sin(y*math.pi/3))*2/3
    dlat += (160*math.sin(y*math.pi/12) + 320*math.sin(y*math.pi/30))*2/3
    dlon = 300 + x + 2*y + .1*x*x + .1*x*y + .1*math.sqrt(abs(x))
    dlon += (20*math.sin(6*x*math.pi) + 20*math.sin(2*x*math.pi))*2/3
    dlon += (20*math.sin(x*math.pi) + 40*math.sin(x*math.pi/3))*2/3
    dlon += (150*math.sin(x*math.pi/12) + 300*math.sin(x*math.pi/30))*2/3
    rad = math.radians(lat)
    magic = 1 - .00669342162296594323 * math.sin(rad)**2
    root = math.sqrt(magic)
    return (dlon*180/(6378245/root*math.cos(rad)*math.pi),
            dlat*180/((6378245*(1-.00669342162296594323)/(magic*root))*math.pi))


def gcj_to_wgs(lon: float, lat: float) -> list[float]:
    x, y = lon, lat
    for _ in range(4):
        dx, dy = _gcj_offset(x, y)
        x, y = lon - dx, lat - dy
    return [round(x, 6), round(y, 6)]


def convert_coordinates(value):
    if value and isinstance(value[0], (int, float)):
        return gcj_to_wgs(value[0], value[1])
    return [convert_coordinates(part) for part in value]


def normalize_admin(feature: dict) -> dict:
    props = feature["properties"]
    return {"type": "Feature", "id": str(props["adcode"]), "properties": {
        "name": props["name"], "adcode": props["adcode"], "level": props["level"],
        "parent": props.get("parent", {}).get("adcode"),
    }, "geometry": {"type": feature["geometry"]["type"],
                    "coordinates": convert_coordinates(feature["geometry"]["coordinates"])}}


def prepare_admin(destination: Path) -> dict:
    destination.mkdir(parents=True, exist_ok=True)
    world = json.loads(fetch_bytes(COUNTRIES))
    world["features"] = [{"type": "Feature", "id": f["properties"]["ADM0_A3"],
        "properties": {"name": f["properties"].get("NAME_ZH") or f["properties"]["NAME"],
                       "name_en": f["properties"]["NAME"], "level": "country"},
        "geometry": f["geometry"]} for f in world["features"]]
    world.pop("crs", None)
    atomic_json(destination / "countries.geojson", world)
    raw = json.loads(fetch_bytes(DATAV + "100000_full.json"))
    provinces = [f for f in raw["features"] if f.get("properties", {}).get("level") == "province"]
    normalized = [normalize_admin(f) for f in provinces]
    atomic_json(destination / "china-provinces.geojson", {"type": "FeatureCollection", "features": normalized})
    municipalities = {110000, 120000, 310000, 500000, 810000, 820000}

    def get_cities(province):
        code = province["properties"]["adcode"]
        if code in municipalities:
            result = normalize_admin(province)
            result["properties"]["level"] = "municipality"
            return [result]
        if not province["properties"].get("childrenNum"):
            return []
        collection = json.loads(fetch_bytes(DATAV + str(code) + "_full.json"))
        return [normalize_admin(f) for f in collection["features"] if f.get("properties", {}).get("level") == "city"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        cities = [feature for batch in pool.map(get_cities, provinces) for feature in batch]
    if len(provinces) != 34 or len(cities) < 250:
        raise ValueError("Administrative dataset is incomplete")
    atomic_json(destination / "china-cities.geojson", {"type": "FeatureCollection", "features": cities})
    metadata = {"retrieved_at": utc_string(), "crs": "EPSG:4326",
        "countries": {"source": COUNTRIES, "count": len(world["features"]), "license": "Natural Earth public domain"},
        "provinces": {"source": DATAV + "100000_full.json", "count": len(provinces)},
        "cities": {"source": DATAV, "count": len(cities), "scope": "DataV city-level features and province-level municipalities"},
        "china_coordinate_processing": "GCJ-02 to WGS84 numerical inverse; source geometry retained.",
        "china_source_documentation": "https://help.aliyun.com/zh/datav/datav-7-0/user-guide/map-data-format-1"}
    atomic_json(destination / "sources.json", metadata)
    return metadata


TEMP_STOPS = np.array([193,206,219,233.15,255.372,273.15,275.15,291,298,311,328])
TEMP_COLORS = np.array([[37,4,42],[41,10,130],[81,40,40],[192,37,149],[70,215,215],
                      [21,84,187],[24,132,14],[247,251,59],[235,167,21],[230,71,39],[88,27,67]])


@lru_cache(maxsize=16)
def _grid(path: str):
    records = json.loads(Path(path).read_text())
    header = records[0]["header"]
    arrays = [np.asarray(record["data"], dtype=np.float32).reshape(header["ny"], header["nx"]) for record in records]
    return header, arrays


def weather_tile(viewer: Path, snapshot: str, layer: str, kind: str, z: int, x: int, y: int) -> bytes:
    """EPSG:4326 XYZ pyramid (2×1 root tiles), with actual grid interpolation."""
    if not re.fullmatch(r"\d{8}T\d{2}Z-f\d{3}-\d+p\d+(?:-v2)?", snapshot):
        raise ValueError("Invalid snapshot")
    if layer not in LAYER_KEYS or kind not in {"temp", "wind"} or not 0 <= z <= 8:
        raise ValueError("Invalid weather tile")
    if not 0 <= x < 2**(z+1) or not 0 <= y < 2**z:
        raise ValueError("Tile outside the globe")
    prefix = Path() if layer == "surface" else Path(layer)
    source = viewer / "data" / "live" / snapshot / prefix / f"{kind}.json"
    cache = viewer / "data" / "earth3d-cache" / "weather" / snapshot / layer / kind / str(z) / f"{x}-{y}.png"
    if cache.is_file():
        return cache.read_bytes()
    header, arrays = _grid(str(source))
    lon = -180 + (x + (np.arange(256)+.5)/256) * 360 / 2**(z+1)
    lat = 90 - (y + (np.arange(256)+.5)/256) * 180 / 2**z
    ix = ((lon - header["lo1"]) % 360) / header["dx"]
    iy = (header["la1"] - lat) / header["dy"]
    x0 = np.floor(ix).astype(int) % header["nx"]
    y0 = np.clip(np.floor(iy).astype(int), 0, header["ny"]-2)
    fx, fy = (ix-np.floor(ix))[None,:], (iy-y0)[:,None]
    x1 = (x0+1) % header["nx"]
    interpolated = []
    for array in arrays:
        interpolated.append(array[y0[:,None],x0]*(1-fx)*(1-fy) + array[y0[:,None],x1]*fx*(1-fy)
                            + array[(y0+1)[:,None],x0]*(1-fx)*fy + array[(y0+1)[:,None],x1]*fx*fy)
    values = interpolated[0] if kind == "temp" else np.hypot(*interpolated)
    valid = np.isfinite(values)
    safe = np.where(valid, values, 0)
    if kind == "temp":
        channels = [np.interp(safe, TEMP_STOPS, TEMP_COLORS[:,i]) for i in range(3)]
    else:
        stops = [0,10,20,35,55,80,100]
        colors = np.array([[36,74,160],[40,175,200],[63,190,130],[230,223,60],[246,133,35],[220,60,100],[132,40,160]])
        channels = [np.interp(safe, stops, colors[:,i]) for i in range(3)]
    rgba = np.stack([*channels, valid.astype(np.uint8)*255], axis=-1).astype(np.uint8)
    output = io.BytesIO()
    Image.fromarray(rgba).save(output, format="PNG")
    data = output.getvalue()
    cache.parent.mkdir(parents=True, exist_ok=True)
    fd, pending = tempfile.mkstemp(prefix=".tile-", dir=cache.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(pending, cache)
    finally:
        Path(pending).unlink(missing_ok=True)
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["prepare-admin"])
    parser.add_argument("--output", type=Path, default=Path("viewer/nullschool/data/geography"))
    args = parser.parse_args()
    print(json.dumps(prepare_admin(args.output), ensure_ascii=False, indent=2))
