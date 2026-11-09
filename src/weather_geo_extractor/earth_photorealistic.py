"""Resolve Google's textured 3D basemap using the existing Cesium ion account."""

import json
from pathlib import Path
import re
import threading
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

from .earth_layers import cached, fetch_bytes, _cache, _lock

PHOTOREALISTIC_ASSET_ID = 2275207
_endpoint_lock = threading.Lock()


def photorealistic_config(viewer_root: Path, *, refresh: bool = False) -> dict:
    config = viewer_root.parent / "earth.config.local.js"
    key = "photorealistic:" + str(config)

    def resolve():
        text = config.read_text() if config.is_file() else ""
        match = re.search(r"\bcesiumIonToken\s*:\s*[\"']([^\"']*)[\"']", text)
        if not match or not match.group(1).strip():
            return {"available": False, "message": "请先配置 Cesium ion 授权并启用 Google 实景三维"}
        try:
            endpoint = json.loads(fetch_bytes(
                f"https://api.cesium.com/v1/assets/{PHOTOREALISTIC_ASSET_ID}/endpoint?access_token=" + match.group(1)
            ))
        except HTTPError as error:
            if error.code in (401, 403, 404):
                return {"available": False, "message": f"当前授权无法读取 Google 实景三维（HTTP {error.code}）"}
            raise
        url = endpoint.get("options", {}).get("url", "")
        parsed = urlparse(url)
        if (
            endpoint.get("type") != "3DTILES"
            or endpoint.get("externalType") != "3DTILES"
            or parsed.scheme != "https"
            or parsed.netloc != "tile.googleapis.com"
            or parsed.path != "/v1/3dtiles/root.json"
            or not parse_qs(parsed.query).get("key", [""])[0]
        ):
            raise ValueError("Invalid Google Photorealistic 3D Tiles endpoint")
        # Only the provider-issued visualization endpoint reaches the browser.
        # Account credentials and Google tile bodies are never written to disk.
        return {
            "available": True, "assetId": PHOTOREALISTIC_ASSET_ID,
            "provider": "Google Maps", "url": url,
            "attributions": [
                {"html": row.get("html", ""), "collapsible": bool(row.get("collapsible", False))}
                for row in endpoint.get("attributions", [])
            ],
        }

    with _endpoint_lock:
        if refresh:
            with _lock:
                _cache.pop(key, None)
        return cached(key, 900, resolve)
