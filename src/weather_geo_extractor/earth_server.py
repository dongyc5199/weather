"""Local Earth viewer with cached GFS data and an optional periodic refresh worker."""

from __future__ import annotations

import argparse
from collections import OrderedDict
import gzip
import io
import json
import threading
import time
import sqlite3
from contextlib import nullcontext
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import re

from .earth_data import UTC, iso_time, load_manifest, sync_latest
from .earth_heights import SNAPSHOT_PATTERN
from .earth_retention import forecast_timeline, hourly_window, prune_history, retention_lease
from .earth_history import backfill_history

DEFAULT_VIEWER = Path(__file__).resolve().parents[2] / "viewer" / "nullschool"
_compressed_files = OrderedDict()
_compressed_lock = threading.Lock()


def immutable_path(path):
    return bool(re.fullmatch(r"/data/live/" + SNAPSHOT_PATTERN + r"/(?:[^/]+/)?(?:wind|temp|metadata)\.json", path)
                or re.fullmatch(r"/data/earth3d-cache/cloud-observation/" + SNAPSHOT_PATTERN + r"/(?:mask\.png|cloud-ra-v1\.webp)", path)
                or re.fullmatch(r"/api/earth/3d/(?:height|pressure|cloud-observation|cloud-volume|cloud-convection|cloud-cores|cloud-point|cloud-shape|playback-v1)/"
                                + SNAPSHOT_PATTERN + r"(?:/[^/]+)?", path))


class Updates:
    def __init__(self, cache: Path, refresh_seconds: int = 1800):
        self.cache = cache
        self.refresh_seconds = refresh_seconds
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.updating = False
        self.last_error: str | None = None
        self.last_attempt: str | None = None
        self.warmed_snapshot = None
        self.history_running = False
        self.history_retry_at = 0.
        self.live_retry_at = 0.
        self.history_error = None

    def hourly_playback(self, frames, manifest, now):
        hours = hourly_window(now)
        needed = {iso_time(hour) for hour in hours}
        ready = {frame.get("valid_time") for frame in frames if "500hPa" in frame.get("layers", {})}
        gaps = needed - ready
        current_hour = iso_time(hours[-1])
        need_latest = not manifest or manifest.get("valid_time") != current_hour or current_hour not in ready
        clock = time.monotonic()
        with self.lock:
            fill = bool(gaps - {current_hour}) and not self.history_running and clock >= self.history_retry_at
            refresh = need_latest and not self.updating and clock >= self.live_retry_at
            if fill:
                self.history_running = True
                self.history_error = None
            if refresh:
                self.live_retry_at = clock + 90
            result = {"ready": len(needed & ready), "total": len(hours),
                      "loading": self.history_running or (need_latest and (self.updating or refresh)),
                      "error": self.history_error if gaps else None}
        if refresh:
            self.refresh()
        if fill:
            threading.Thread(target=self._fill_history, args=(now,), name="gfs-hourly-history", daemon=True).start()
        return result

    def _fill_history(self, now):
        failure = None
        try:
            errors = backfill_history(self.cache.parent.parent, now=now, stop=self.stop, include_latest=False)
            if errors:
                failure = "; ".join(f"{iso_time(hour)}: {message}" for hour, message in sorted(errors.items()))
        except Exception as exc:
            failure = str(exc)
        finally:
            with self.lock:
                self.history_error = failure
                self.history_retry_at = time.monotonic() + (90 if failure else 5)
                self.history_running = False
        if failure:
            print(f"Hourly GFS history will retry missing hours: {failure}", flush=True)

    def warm(self, manifest):
        if not manifest:
            return
        with self.lock:
            if self.warmed_snapshot == manifest['id']:
                return
            self.warmed_snapshot = manifest['id']
        viewer = self.cache.parent.parent
        def heights():
            from .earth_heights import height_profile
            if not self.stop.is_set():
                try:
                    height_profile(viewer, manifest['id'], 'surface', preload=True)
                except Exception:
                    pass  # Interactive requests retry missing heights.
        def clouds():
            from .earth_observations import cloud_observation
            from .earth_cloud_shape import cloud_shape_profile
            try:
                cloud_observation(viewer, manifest['id'])
                if not self.stop.is_set():
                    cloud_shape_profile(viewer, manifest['id'])
            except Exception:
                pass
        def protected(task):
            with retention_lease(self.cache.parent):
                task()
        for name, task in (('height-warmup', heights), ('cloud-warmup', clouds)):
            threading.Thread(target=protected, args=(task,), name=name, daemon=True).start()

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
            from .earth_heights import height_profile
            # Keep serving the previous complete generation while new heights download.
            with retention_lease(self.cache.parent):
                manifest = sync_latest(self.cache, prepare=lambda snapshot: height_profile(
                    self.cache.parent.parent, snapshot, 'surface', preload=True))
            self.prune()
            print(f"GFS ready: run={manifest['run_time']} valid={manifest['valid_time']} layers={len(manifest.get('layers', {}))}", flush=True)
            with self.lock:
                self.last_error = None
            self.warm(manifest)
        except Exception as exc:
            print(f"GFS update failed; keeping cached data: {exc}", flush=True)
            with self.lock:
                self.last_error = str(exc)
        finally:
            with self.lock:
                self.updating = False

    def prune(self):
        try:
            result = prune_history(self.cache.parent.parent, apply=True)
            if result["paths"]:
                print(f"Expired forecast cache: removed {len(result['paths'])} paths, {result['bytes']} bytes", flush=True)
        except (OSError, ValueError, sqlite3.Error) as error:
            print(f"Forecast retention deferred: {error}", flush=True)

    def maintain_history(self):
        while not self.stop.wait(900):
            self.prune()

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
        if getattr(self, '_immutable_ok', False):
            policy = 'private, max-age=31536000, immutable'
        elif path in {"/api/earth/3d/terrain", "/api/earth/3d/buildings", "/api/earth/3d/photorealistic"}:
            policy = 'no-store'
        elif path.startswith('/api/earth/3d/terrain-tile/'):
            policy = 'private, max-age=3600' if getattr(self, '_terrain_tile_ok', False) else 'no-store'
        else:
            policy = 'no-cache'
        if path.endswith((".json", ".geojson")):
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Cache-Control", policy)
        super().end_headers()

    def json_response(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode("utf-8")
        self._immutable_ok = status == 200 and immutable_path(urlparse(self.path).path)
        compressed = len(body) > 1024 and self.accepts_gzip()
        if compressed:
            body = gzip.compress(body, compresslevel=3, mtime=0)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header('Vary', 'Accept-Encoding')
        if compressed:
            self.send_header('Content-Encoding', 'gzip')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def accepts_gzip(self):
        for item in self.headers.get("Accept-Encoding", "").lower().split(","):
            coding, *options = item.strip().split(";")
            if coding.strip() != "gzip":
                continue
            for option in options:
                name, _, value = option.partition("=")
                if name.strip() == "q":
                    try:
                        return 0 < float(value) <= 1
                    except ValueError:
                        return False
            return True
        return False

    def send_head(self):
        path = urlparse(self.path).path
        source = Path(self.translate_path(path))
        self._immutable_ok = immutable_path(path) and source.is_file()
        # Static geography and snapshot JSON use the same gzip delivery as API JSON.
        if source.suffix in {'.json', '.geojson'} and source.is_file() and self.accepts_gzip():
            stat = source.stat()
            if stat.st_size > 16 * 1024**2:
                return super().send_head()  # Stream unusually large files directly.
            key = (str(source), stat.st_ino, stat.st_mtime_ns, stat.st_size)
            etag = f'"{stat.st_ino:x}-{stat.st_mtime_ns:x}-{stat.st_size:x}-gz"'
            candidates = [tag.strip().removeprefix("W/") for tag in self.headers.get("If-None-Match", "").split(",")]
            if etag in candidates or "*" in candidates:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.end_headers()
                return None
            with _compressed_lock:
                body = _compressed_files.get(key)
            if body is None:
                body = gzip.compress(source.read_bytes(), compresslevel=3, mtime=0)
                with _compressed_lock:
                    _compressed_files[key] = body
                    while len(_compressed_files) > 24 or sum(map(len, _compressed_files.values())) > 32 * 1024**2:
                        _compressed_files.popitem(last=False)
            self.send_response(200)
            self.send_header("ETag", etag)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        return super().send_head()

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path.startswith(("/data/live/", "/data/earth3d-cache/")):
            with retention_lease(Path(self.directory) / "data"):
                return super().do_HEAD()
        return super().do_HEAD()

    def do_GET(self) -> None:
        self._immutable_ok = False
        path = urlparse(self.path).path
        managed = path.startswith(("/data/live/", "/data/earth3d-cache/",
                                   "/api/earth/3d/cloud-", "/api/earth/3d/height/",
                                   "/api/earth/3d/pressure/", "/api/earth/3d/playback-v1/", "/api/earth/3d/grid/"))
        timeline = path == "/api/earth/status" and parse_qs(urlparse(self.path).query).get("timeline") == ["1"]
        with retention_lease(Path(self.directory) / "data") if managed or timeline else nullcontext():
            if path.startswith("/api/earth/3d/"):
                self.map_data_response(path)
            elif path == "/api/earth/status":
                status = self.updates.status()
                if timeline:
                    now = datetime.now(UTC)
                    status["timeline"] = forecast_timeline(Path(self.directory) / "data/live", status["manifest"], now=now)
                    status["history"] = self.updates.hourly_playback(status["timeline"], status["manifest"], now)
                self.json_response(200, status)
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
            elif match := re.fullmatch(r"/api/earth/3d/cloud-observation/([^/]+)", path):
                from .earth_observations import cloud_observation
                self.json_response(200, cloud_observation(Path(self.directory), match[1]))
            elif match := re.fullmatch(r"/api/earth/3d/cloud-convection/([^/]+)", path):
                from .earth_convection import convection_profile
                self.json_response(200, convection_profile(Path(self.directory), match[1]))
            elif match := re.fullmatch(r"/api/earth/3d/cloud-cores/([^/]+)", path):
                from .earth_convection import core_profile
                self.json_response(200, core_profile(Path(self.directory), match[1]))
            elif match := re.fullmatch(r"/api/earth/3d/cloud-shape/([^/]+)(/field\.bin)?", path):
                from .earth_cloud_shape import cloud_shape_profile, cloud_shape_bytes
                if not match[2]:
                    self.json_response(200, cloud_shape_profile(Path(self.directory), match[1]))
                else:
                    compressed = self.accepts_gzip()
                    body = cloud_shape_bytes(Path(self.directory), match[1], compressed)
                    self._immutable_ok = True
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/octet-stream')
                    self.send_header('Vary', 'Accept-Encoding')
                    if compressed:
                        self.send_header('Content-Encoding', 'gzip')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    try:
                        self.wfile.write(body)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
            elif match := re.fullmatch(r"/api/earth/3d/cloud-point/([^/]+)", path):
                from .earth_convection import convective_point
                args = parse_qs(urlparse(self.path).query)
                self.json_response(200, convective_point(Path(self.directory), match[1], float(args.get('lon', ['nan'])[0]), float(args.get('lat', ['nan'])[0])))
            elif match := re.fullmatch(r"/api/earth/3d/cloud-volume/([^/]+)", path):
                from .earth_clouds import cloud_profile
                self.json_response(200, cloud_profile(Path(self.directory), match[1]))
            elif match := re.fullmatch(r"/api/earth/3d/playback-v1/([^/]+)/([^/]+)", path):
                from .earth_playback import playback_packet
                compressed = self.accepts_gzip()
                body = playback_packet(Path(self.directory), *match.groups(), compressed=compressed)
                self._immutable_ok = True
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Vary", "Accept-Encoding")
                if compressed:
                    self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            elif path == "/api/earth/3d/palette":
                self.json_response(200, {"unit": "K", "stops": TEMP_STOPS.tolist(), "colors": TEMP_COLORS.tolist()})
            elif match := re.fullmatch(r"/api/earth/3d/height/([^/]+)/([^/]+)", path):
                from .earth_heights import height_profile
                self.json_response(200, height_profile(Path(self.directory), *match.groups()))
            elif match := re.fullmatch(r"/api/earth/3d/pressure/([^/]+)", path):
                from .earth_pressure import pressure_profile
                self.json_response(200, pressure_profile(Path(self.directory), match[1]))
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
    parser.add_argument("command", choices=("serve", "sync", "prune"), nargs="?", default="serve")
    parser.add_argument("--viewer-root", type=Path, default=DEFAULT_VIEWER)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--refresh-seconds", type=int, default=1800, help="Automatic refresh interval; 0 disables periodic checks")
    parser.add_argument("--apply", action="store_true", help="Apply the 24-hour retention plan for the prune command")
    args = parser.parse_args()
    viewer = args.viewer_root.resolve()
    if not (viewer / "index.html").is_file():
        parser.error(f"Earth viewer not found: {viewer}")
    cache = viewer / "data" / "live"
    if args.command == "prune":
        print(json.dumps(prune_history(viewer, apply=args.apply), ensure_ascii=False, indent=2))
        return
    if args.command == "sync":
        with retention_lease(cache.parent):
            manifest = sync_latest(cache)
        prune_history(viewer, apply=True)
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return
    updates = Updates(cache, args.refresh_seconds)
    handler = partial(EarthRequestHandler, directory=str(viewer), updates=updates)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Weather Earth: http://{args.host}:{args.port}/", flush=True)
    updates.prune()
    threading.Thread(target=updates.maintain_history, name="gfs-retention", daemon=True).start()
    updates.warm(load_manifest(cache))
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
