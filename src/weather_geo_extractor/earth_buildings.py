"""Resolve the configured Cesium OSM Buildings layer without exposing the account token."""

from pathlib import Path
import html
import json
import re
import threading
from urllib.error import HTTPError

from .earth_layers import cached, fetch_bytes, _cache, _lock

BUILDINGS_ASSET_ID = 96188
_endpoint_lock = threading.Lock()


def buildings_config(viewer_root: Path, *, refresh: bool = False) -> dict:
    config = viewer_root.parent / "earth.config.local.js"
    key = "buildings:" + str(config)

    def resolve():
        if not config.is_file():
            return {"available": False, "message": "尚未配置建筑服务授权"}
        match = re.search(r"\bcesiumIonToken\s*:\s*[\"']([^\"']*)[\"']", config.read_text())
        if not match or not match.group(1).strip():
            return {"available": False, "message": "尚未配置建筑服务授权"}
        try:
            endpoint = json.loads(fetch_bytes(
                f"https://api.cesium.com/v1/assets/{BUILDINGS_ASSET_ID}/endpoint?access_token=" + match.group(1)
            ))
        except HTTPError as error:
            if error.code in (401, 403, 404):
                return {"available": False, "message": f"当前授权无法读取 OSM 建筑（HTTP {error.code}）"}
            raise
        if endpoint.get("type") != "3DTILES" or endpoint.get("externalType"):
            raise ValueError("The configured building asset is not a native 3D Tiles layer")
        root = json.loads(fetch_bytes(endpoint["url"], {"Authorization": "Bearer " + endpoint["accessToken"]}))
        if not isinstance(root.get("root"), dict):
            raise ValueError("Invalid building tileset")
        credits = [html.unescape(re.sub("<[^>]+>", "", row.get("html", ""))).strip()
                   for row in endpoint.get("attributions", [])]
        return {
            "available": True, "assetId": BUILDINGS_ASSET_ID,
            "provider": "Cesium OSM Buildings", "url": endpoint["url"],
            "accessToken": endpoint["accessToken"], "root": root,
            "credits": [text for text in credits if text],
            "attributions": [{"html": row.get("html", ""), "collapsible": bool(row.get("collapsible", False))}
                             for row in endpoint.get("attributions", [])],
        }

    with _endpoint_lock:
        if refresh:
            with _lock:
                _cache.pop(key, None)
        return cached(key, 900, resolve)
