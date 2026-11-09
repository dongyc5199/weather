import json
from urllib.error import HTTPError

import pytest

from weather_geo_extractor import earth_photorealistic as photo


def configured_viewer(tmp_path):
    viewer = tmp_path / "viewer" / "nullschool"
    viewer.mkdir(parents=True)
    (viewer.parent / "earth.config.local.js").write_text('window.CONFIG={cesiumIonToken:"account-secret"};')
    return viewer


def endpoint(url="https://tile.googleapis.com/v1/3dtiles/root.json?key=provider-key"):
    return {"type": "3DTILES", "externalType": "3DTILES", "options": {"url": url},
            "attributions": [{"html": "Google Maps"}, {"html": "Upgrade for commercial use."}]}


def test_photorealistic_resolves_visualization_endpoint_without_exporting_account_token(tmp_path, monkeypatch):
    viewer = configured_viewer(tmp_path)
    calls = []
    def fetch(url):
        calls.append(url)
        assert "/assets/2275207/endpoint?access_token=account-secret" in url
        return json.dumps(endpoint()).encode()
    monkeypatch.setattr(photo, "fetch_bytes", fetch)
    info = photo.photorealistic_config(viewer)
    assert info["available"] and info["provider"] == "Google Maps"
    assert "account-secret" not in json.dumps(info)
    assert info["attributions"][-1]["html"] == "Upgrade for commercial use."
    assert photo.photorealistic_config(viewer) == info
    assert len(calls) == 1
    photo.photorealistic_config(viewer, refresh=True)
    assert len(calls) == 2
    assert list(viewer.rglob("*")) == []


@pytest.mark.parametrize("url", [
    "http://tile.googleapis.com/v1/3dtiles/root.json?key=x",
    "https://tile.googleapis.com.evil.test/v1/3dtiles/root.json?key=x",
    "https://user:pass@tile.googleapis.com/v1/3dtiles/root.json?key=x",
    "https://tile.googleapis.com/v1/3dtiles/root.json",
    "https://tile.googleapis.com/other?key=x",
])
def test_only_the_google_tiles_endpoint_is_returned(tmp_path, monkeypatch, url):
    viewer = configured_viewer(tmp_path)
    monkeypatch.setattr(photo, "fetch_bytes", lambda _: json.dumps(endpoint(url)).encode())
    with pytest.raises(ValueError, match="Invalid Google"):
        photo.photorealistic_config(viewer)


def test_missing_or_denied_photo_access_is_explicit(tmp_path, monkeypatch):
    monkeypatch.setattr(photo, "fetch_bytes", lambda _: pytest.fail("unexpected download"))
    assert not photo.photorealistic_config(tmp_path / "unconfigured")["available"]
    viewer = configured_viewer(tmp_path)
    def denied(url):
        raise HTTPError(url, 403, "denied", {}, None)
    monkeypatch.setattr(photo, "fetch_bytes", denied)
    info = photo.photorealistic_config(viewer)
    assert not info["available"] and "403" in info["message"]
    assert "account-secret" not in json.dumps(info)
