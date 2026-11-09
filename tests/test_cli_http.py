from functools import partial
from http.server import ThreadingHTTPServer
import json
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from weather_geo_extractor import cli


def test_serve_map_returns_json_for_success_and_errors(tmp_path, monkeypatch):
    image = tmp_path / "source.png"
    image.write_bytes(b"test fixture")
    monkeypatch.setattr(cli, "_download_url", lambda *_: image)
    monkeypatch.setattr(cli, "_build_detection_payload", lambda **_: {
        "type": "FeatureCollection", "features": [], "properties": {},
    })
    handler = partial(cli.MapViewerRequestHandler, directory=str(tmp_path))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    source = "https://image.nmc.cn/example.png"
    try:
        for path, body, status in [
            ("/unknown", b"{}", 404),
            ("/api/process-nmc-wind", b"{}", 400),
            ("/api/process-nmc-wind", json.dumps({"url": source}).encode(), 200),
        ]:
            request = Request(base + path, data=body, headers={"Content-Type": "application/json"})
            try:
                response = urlopen(request, timeout=5)
            except HTTPError as error:
                response = error
            with response:
                assert response.status == status
                assert response.headers.get_content_type() == "application/json"
                result = json.load(response)
                if status == 200:
                    assert result["properties"]["source_url"] == source
                    assert result["properties"]["local_image_url"].startswith("/source.png?v=")
                else:
                    assert result["error"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
