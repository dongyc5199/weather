"""Local Earth viewer with cached GFS data and an optional periodic refresh worker."""

from __future__ import annotations

import argparse
import json
import threading
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import re

from .earth_data import UTC, iso_time, load_manifest, sync_latest

DEFAULT_VIEWER = Path(__file__).resolve().parents[2] / "viewer" / "nullschool"


class Updates:
    def __init__(self, cache: Path, refresh_seconds: int = 1800):
        self.cache = cache
        self.refresh_seconds = refresh_seconds
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.updating = False
        self.last_error: str | None = None
        self.last_attempt: str | None = None

    def status(self) -> dict:
        with self.lock:
            return {"updating": self.updating, "last_error": self.last_error,
                    "last_attempt": self.last_attempt, "refresh_seconds": self.refresh_seconds,
                    "manifest": load_manifest(self.cache)}

    def refresh(self) -> bool:
        with self.lock:
            if self.updating:
                return False
            self.updating = True
            self.last_attempt = iso_time(datetime.now(UTC))
        threading.Thread(target=self._run, name="gfs-refresh", daemon=True).start()
        return True

    def _run(self) -> None:
        try:
            manifest = sync_latest(self.cache)
            print(f"GFS ready: run={manifest['run_time']} valid={manifest['valid_time']} layers={len(manifest.get('layers', {}))}", flush=True)
            with self.lock:
                self.last_error = None
        except Exception as exc:
            print(f"GFS update failed; keeping cached data: {exc}", flush=True)
            with self.lock:
                self.last_error = str(exc)
        finally:
            with self.lock:
                self.updating = False

    def periodic(self) -> None:
        if self.refresh_seconds <= 0:
            return
        while not self.stop.wait(self.refresh_seconds):
            self.refresh()


class EarthRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, updates: Updates, **kwargs):
        self.updates = updates
        super().__init__(*args, **kwargs)

    def end_headers(self) -> None:
        # The manifest and UI must not get stuck on yesterday's forecast.
        path = urlparse(self.path).path
        policy = "no-store" if path in {"/api/earth/3d/terrain", "/api/earth/3d/buildings", "/api/earth/3d/photorealistic"} else ("private, max-age=3600" if getattr(self, "_terrain_tile_ok", False) else "no-store") if path.startswith("/api/earth/3d/terrain-tile/") else "no-cache"
        self.send_header("Cache-Control", policy)
        super().end_headers()

    def json_response(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/earth/3d/"):
            self.map_data_response(path)
        elif path == "/api/earth/status":
            self.json_response(200, self.updates.status())
        else:
            super().do_GET()

    def map_data_response(self, path: str) -> None:
        from .earth_layers import cloud_metadata, terrain_bootstrap, weather_tile, TEMP_STOPS, TEMP_COLORS
        try:
            if path == "/api/earth/3d/terrain":
                self.json_response(200, terrain_bootstrap(Path(self.directory)))
            elif path == "/api/earth/3d/buildings":
                from .earth_buildings import buildings_config
                refresh = parse_qs(urlparse(self.path).query).get("refresh") == ["1"]
                self.json_response(200, buildings_config(Path(self.directory), refresh=refresh))
            elif path == "/api/earth/3d/photorealistic":
                from .earth_photorealistic import photorealistic_config
                refresh = parse_qs(urlparse(self.path).query).get("refresh") == ["1"]
                self.json_response(200, photorealistic_config(Path(self.directory), refresh=refresh))
            elif match := re.fullmatch(r"/api/earth/3d/terrain-tile/(\d+)/(\d+)/(\d+)\.terrain", path):
                from .earth_layers import terrain_tile
                self._terrain_tile_ok = False
                source = parse_qs(urlparse(self.path).query).get("source", [""])[0]
                body = terrain_tile(Path(self.directory), source, *map(int, match.groups()))
                self._terrain_tile_ok = True
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.quantized-mesh")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            elif path == "/api/earth/3d/cloud":
                self.json_response(200, cloud_metadata(Path(self.directory) / "data" / "earth3d-cache" / "cloud-metadata.json"))
            elif path == "/api/earth/3d/palette":
                self.json_response(200, {"unit": "K", "stops": TEMP_STOPS.tolist(), "colors": TEMP_COLORS.tolist()})
            elif match := re.fullmatch(r"/api/earth/3d/height/([^/]+)/([^/]+)", path):
                from .earth_heights import height_profile
                self.json_response(200, height_profile(Path(self.directory), *match.groups()))
            elif match := re.fullmatch(r"/api/earth/3d/grid/([^/]+)/([^/]+)/(temp|wind)/(\d+)/(\d+)/(\d+)\.png", path):
                snapshot, layer, kind, z, x, y = match.groups()
                body = weather_tile(Path(self.directory), snapshot, layer, kind, int(z), int(x), int(y))
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.json_response(404, {"error": "not found"})
        except FileNotFoundError:
            self.json_response(404, {"error": "Map dataset is not available"})
        except ValueError as exc:
            self.json_response(400, {"error": str(exc)})
        except Exception as exc:
            # Never include authenticated provider URLs or tokens in responses/logs.
            self.json_response(502, {"error": "Map provider is temporarily unavailable", "type": type(exc).__name__})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/earth/refresh":
            self.json_response(404, {"error": "not found"})
            return
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            self.json_response(403, {"error": "same-origin requests only"})
            return
        self.updates.refresh()
        self.json_response(202, self.updates.status())


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Nullschool viewer and NOAA GFS data updates")
    parser.add_argument("command", choices=("serve", "sync"), nargs="?", default="serve")
    parser.add_argument("--viewer-root", type=Path, default=DEFAULT_VIEWER)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--refresh-seconds", type=int, default=1800, help="Automatic refresh interval; 0 disables periodic checks")
    args = parser.parse_args()
    viewer = args.viewer_root.resolve()
    if not (viewer / "index.html").is_file():
        parser.error(f"Earth viewer not found: {viewer}")
    cache = viewer / "data" / "live"
    if args.command == "sync":
        print(json.dumps(sync_latest(cache), ensure_ascii=False, indent=2))
        return
    updates = Updates(cache, args.refresh_seconds)
    handler = partial(EarthRequestHandler, directory=str(viewer), updates=updates)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Weather Earth: http://{args.host}:{args.port}/", flush=True)
    updates.refresh()
    def warm_terrain():
        from .earth_layers import terrain_bootstrap
        try:
            terrain_bootstrap(viewer)
        except Exception:
            pass  # The interactive request retains the normal provider fallback.
    threading.Thread(target=warm_terrain, name="terrain-warmup", daemon=True).start()
    threading.Thread(target=updates.periodic, name="gfs-schedule", daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        updates.stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
