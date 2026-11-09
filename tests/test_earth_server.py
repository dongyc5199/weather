from contextlib import contextmanager
from functools import partial
from http.server import ThreadingHTTPServer
import json
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from weather_geo_extractor import earth_server as server


@contextmanager
def local_server(tmp_path):
    (tmp_path / "index.html").write_text("Earth viewer")
    updates = server.Updates(tmp_path / "data" / "live", refresh_seconds=0)
    # Tests exercise HTTP dispatch without starting real external data downloads.
    calls = []
    updates.refresh = lambda: calls.append("refresh") or True
    handler = partial(server.EarthRequestHandler, directory=str(tmp_path), updates=updates)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}", calls
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join()


def test_static_page_status_and_same_origin_refresh(tmp_path):
    with local_server(tmp_path) as (url, calls):
        with urlopen(url) as response:
            assert response.read() == b"Earth viewer"
            assert response.headers["Cache-Control"] == "no-cache"
        with urlopen(url + "/api/earth/status") as response:
            status = json.load(response)
            assert status["manifest"] is None
            assert status["updating"] is False
        request = Request(url + "/api/earth/refresh", method="POST", headers={"Origin": url})
        with urlopen(request) as response:
            assert response.status == 202
        assert calls == ["refresh"]


def test_cross_origin_refresh_cannot_start_download(tmp_path):
    with local_server(tmp_path) as (url, calls):
        request = Request(url + "/api/earth/refresh", method="POST", headers={"Origin": "https://unrelated.example"})
        with pytest.raises(HTTPError) as exc:
            urlopen(request)
        assert exc.value.code == 403
        assert calls == []


def test_building_metadata_is_not_http_cached(tmp_path, monkeypatch):
    from weather_geo_extractor import earth_buildings
    requests = []
    def buildings(viewer, *, refresh=False):
        requests.append(refresh)
        return {'available': True, 'accessToken': 'asset-scoped-test', 'root': {'root': {'children': []}}}
    monkeypatch.setattr(earth_buildings, 'buildings_config', buildings)
    with local_server(tmp_path) as (url, _):
        with urlopen(url + '/api/earth/3d/buildings?refresh=1') as response:
            assert response.headers['Cache-Control'] == 'no-store'
            assert json.load(response)['available'] is True
    assert requests == [True]


def test_failed_worker_keeps_cache_and_releases_refresh_lock(tmp_path, monkeypatch):
    old = tmp_path / "manifest.json"
    old.write_text('{"previous":"snapshot"}')
    updates = server.Updates(tmp_path, 0)
    updates.updating = True

    def failed(*_args):
        raise OSError("source unavailable")

    monkeypatch.setattr(server, "sync_latest", failed)
    updates._run()
    assert updates.status()["last_error"] == "source unavailable"
    assert updates.status()["updating"] is False
    assert old.read_text() == '{"previous":"snapshot"}'


def test_photorealistic_metadata_is_not_http_cached(tmp_path, monkeypatch):
    from weather_geo_extractor import earth_photorealistic
    requests = []
    def config(viewer, *, refresh=False):
        requests.append(refresh)
        return {"available": True, "provider": "Google Maps"}
    monkeypatch.setattr(earth_photorealistic, "photorealistic_config", config)
    with local_server(tmp_path) as (url, _):
        with urlopen(url + "/api/earth/3d/photorealistic?refresh=1") as response:
            assert response.headers["Cache-Control"] == "no-store"
            assert json.load(response)["available"]
    assert requests == [True]
