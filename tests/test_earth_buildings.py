import json
from urllib.error import HTTPError
import pytest

from weather_geo_extractor import earth_buildings as buildings


def configured_viewer(tmp_path):
    viewer = tmp_path / 'viewer' / 'nullschool'
    viewer.mkdir(parents=True)
    (viewer.parent / 'earth.config.local.js').write_text('window.CONFIG={cesiumIonToken:"account-secret"};')
    return viewer


def test_building_endpoint_uses_existing_credential_but_returns_only_scoped_token(tmp_path, monkeypatch):
    viewer = configured_viewer(tmp_path)
    calls = []
    endpoint = {'type': '3DTILES', 'url': 'https://assets.example/osm/tileset.json?v=2', 'accessToken': 'asset-token',
                'attributions': [{'html': '© OpenStreetMap contributors'}, {'html': 'Upgrade for commercial use.', 'collapsible': False}]}
    def fetch(url, headers=None):
        calls.append(url)
        if '/endpoint?' in url:
            assert '/assets/96188/endpoint?access_token=account-secret' in url
            return json.dumps(endpoint).encode()
        assert headers['Authorization'] == 'Bearer asset-token'
        return b'{"asset":{"version":"1.0"},"root":{"children":[]}}'
    monkeypatch.setattr(buildings, 'fetch_bytes', fetch)
    result = buildings.buildings_config(viewer)
    assert result['available'] and result['assetId'] == 96188
    assert result['accessToken'] == 'asset-token'
    assert 'account-secret' not in json.dumps(result)
    assert 'Upgrade for commercial use.' in result['credits']
    assert buildings.buildings_config(viewer) == result
    assert len(calls) == 2
    assert list(viewer.rglob('*')) == []


def test_building_credential_errors_are_explicit_without_leaking_provider_url(tmp_path, monkeypatch):
    viewer = configured_viewer(tmp_path)
    def denied(url, *args): raise HTTPError(url, 403, 'forbidden', {}, None)
    monkeypatch.setattr(buildings, 'fetch_bytes', denied)
    result = buildings.buildings_config(viewer)
    assert result['available'] is False
    assert '403' in result['message']
    assert 'account-secret' not in json.dumps(result)


def test_building_asset_type_must_be_3d_tiles(tmp_path, monkeypatch):
    viewer = configured_viewer(tmp_path)
    monkeypatch.setattr(buildings, 'fetch_bytes', lambda *args: b'{"type":"TERRAIN"}')
    with pytest.raises(ValueError, match='3D Tiles'):
        buildings.buildings_config(viewer)


def test_missing_building_config_does_not_issue_network_requests(tmp_path, monkeypatch):
    monkeypatch.setattr(buildings, 'fetch_bytes', lambda *args: pytest.fail('unexpected network'))
    assert buildings.buildings_config(tmp_path / 'viewer' / 'nullschool')['available'] is False
