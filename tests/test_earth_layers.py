from pathlib import Path
import io
import json
import numpy as np
from PIL import Image
import pytest

from weather_geo_extractor import earth_layers as layers


def test_gcj_inverse_matches_known_beijing_coordinate():
    assert layers.gcj_to_wgs(116.41024449916938, 39.91640428150164) == pytest.approx([116.404,39.915],abs=1e-6)
    assert layers.gcj_to_wgs(-0.1276,51.5072) == [-0.1276,51.5072]


def test_cloud_time_is_taken_from_provider_capabilities():
    xml=b'''<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents><Layer>
      <ows:Identifier>Himawari_AHI_Band13_Clean_Infrared</ows:Identifier>
      <Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-01-01T03:40:00Z</Default></Dimension>
    </Layer></Contents></Capabilities>'''
    data=layers.parse_cloud_metadata(xml)
    assert data['observation_time']=='2026-01-01T03:40:00Z'
    assert data['coverage']=='东亚与西太平洋'
    assert data['layer']==layers.CLOUD_LAYER


def test_cloud_observation_survives_restart_and_provider_timeout(tmp_path, monkeypatch):
    xml = b'''<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents><Layer>
      <ows:Identifier>Himawari_AHI_Band13_Clean_Infrared</ows:Identifier>
      <Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-01-01T03:40:00Z</Default></Dimension>
    </Layer></Contents></Capabilities>'''
    path = tmp_path / 'cloud-metadata.json'
    monkeypatch.setattr(layers, 'fetch_bytes', lambda *args: xml)
    fresh = layers.cloud_metadata(path)
    assert fresh['stale'] is False
    layers._cache.pop('cloud:' + str(path))

    def unavailable(*args):
        raise TimeoutError('provider timeout')

    monkeypatch.setattr(layers, 'fetch_bytes', unavailable)
    retained = layers.cloud_metadata(path)
    assert retained['stale'] is True
    assert retained['observation_time'] == fresh['observation_time']
    assert retained['retrieved_at'] == fresh['retrieved_at']
    with pytest.raises(TimeoutError):
        layers.cloud_metadata(tmp_path / 'missing.json')


def test_terrain_endpoint_does_not_return_persistent_token(tmp_path,monkeypatch):
    viewer=tmp_path/'viewer'/'nullschool';viewer.mkdir(parents=True)
    (viewer.parent/'earth.config.local.js').write_text('window.CONFIG={cesiumIonToken:"persistent-test-token"};')
    calls=[]
    def fetch(url):
        calls.append(url)
        assert url.startswith('https://api.cesium.com/v1/assets/1/endpoint?')
        return json.dumps({'type':'TERRAIN','url':'https://assets.ion.cesium.com/1/',
                           'accessToken':'temporary-test-token','attributions':[{'html':'Terrain &amp; imagery'}]}).encode()
    monkeypatch.setattr(layers,'fetch_bytes',fetch)
    result=layers.terrain_config(viewer)
    assert result['available'] is True
    assert result['accessToken']=='temporary-test-token'
    assert 'persistent-test-token' not in json.dumps(result)
    assert result['credits']==['Terrain & imagery']
    assert layers.terrain_config(viewer)==result
    assert len(calls)==1


def test_terrain_directory_survives_restart_without_persisting_credentials(tmp_path, monkeypatch):
    info = {'available': True, 'url': 'https://terrain.example/' + tmp_path.name + '/', 'accessToken': 'temporary-secret'}
    monkeypatch.setattr(layers, 'terrain_config', lambda _: info)
    directory = {'format': 'quantized-mesh-1.0', 'tiles': ['{z}/{x}/{y}.terrain'], 'maxzoom': 15}
    calls = []
    def fetch(url, headers):
        calls.append(url)
        assert headers['Authorization'] == 'Bearer temporary-secret'
        assert url.endswith('/layer.json')
        return json.dumps(directory).encode()
    monkeypatch.setattr(layers, 'fetch_bytes', fetch)
    assert layers.terrain_bootstrap(tmp_path)['layer'] == directory
    files = list(tmp_path.rglob('*.json'))
    assert len(files) == 1
    assert 'temporary-secret' not in files[0].read_text()
    assert 'accessToken' not in files[0].read_text()
    for key in list(layers._cache):
        if key.startswith('terrain-layer:'):
            layers._cache.pop(key)
    info['accessToken'] = 'new-temporary-secret'
    result = layers.terrain_bootstrap(tmp_path)
    assert result['layer'] == directory
    assert result['accessToken'] == 'new-temporary-secret'
    assert len(calls) == 1


def test_terrain_directory_with_embedded_token_is_not_written_to_disk(tmp_path, monkeypatch):
    info = {'available': True, 'url': 'https://terrain.example/' + tmp_path.name + '/', 'accessToken': 'provider-secret'}
    monkeypatch.setattr(layers, 'terrain_config', lambda _: info)
    monkeypatch.setattr(layers, 'fetch_bytes', lambda *args: b'{"tiles":["tile?access_token=provider-secret"]}')
    assert 'layer' in layers.terrain_bootstrap(tmp_path)
    assert list(tmp_path.rglob('*.json')) == []


def test_terrain_directory_failure_still_allows_direct_provider_access(tmp_path, monkeypatch):
    info = {'available': True, 'url': 'https://terrain.example/' + tmp_path.name + '/', 'accessToken': 'provider-secret'}
    monkeypatch.setattr(layers, 'terrain_config', lambda _: info)
    def failed(*args): raise TimeoutError()
    monkeypatch.setattr(layers, 'fetch_bytes', failed)
    assert layers.terrain_bootstrap(tmp_path) == info


def test_terrain_tile_cache_reuses_bytes_and_keeps_tokens_out_of_cache(tmp_path, monkeypatch):
    import struct
    source = 'a' * 64
    info = {'available': True, 'url': 'https://terrain.example/asset/', 'accessToken': 'temporary-secret',
            'terrain_cache_key': source, 'layer': {'tiles': ['{z}/{x}/{y}.terrain?v={version}'], 'extensions': ['metadata']}}
    monkeypatch.setattr(layers, 'terrain_bootstrap', lambda _: info)
    payload = b'\0' * 88 + struct.pack('<I', 4) + b'\0' * 28
    calls = []
    def fetch(url, headers):
        calls.append(url)
        assert url == 'https://terrain.example/asset/2/3/1.terrain?v=1'
        assert headers['Authorization'] == 'Bearer temporary-secret'
        assert headers['Accept'].endswith('extensions=metadata')
        return payload
    monkeypatch.setattr(layers, 'fetch_bytes', fetch)
    assert layers.terrain_tile(tmp_path, source, 2, 3, 1) == payload
    assert layers.terrain_tile(tmp_path, source, 2, 3, 1) == payload
    assert len(calls) == 1
    files = list(tmp_path.rglob('*.terrain'))
    assert len(files) == 1 and files[0].read_bytes() == payload
    with pytest.raises(ValueError): layers.terrain_tile(tmp_path, source, 0, 2, 0)
    with pytest.raises(ValueError): layers.terrain_tile(tmp_path, '../secret', 0, 0, 0)
    with pytest.raises(ValueError): layers.terrain_tile(tmp_path, 'b' * 64, 0, 0, 0)


def test_terrain_cache_evicts_old_derived_tiles_only(tmp_path):
    import os
    old = tmp_path / 'old.terrain'; old.write_bytes(b'0123456789')
    new = tmp_path / 'new.terrain'; new.write_bytes(b'abcdefghij')
    unrelated = tmp_path / 'notes.txt'; unrelated.write_text('keep')
    os.utime(old, (1, 1)); os.utime(new, (2, 2))
    layers.prune_terrain_cache(tmp_path, maximum_bytes=10)
    assert not old.exists()
    assert new.read_bytes() == b'abcdefghij'
    assert unrelated.read_text() == 'keep'


def make_grid(tmp_path,kind,values):
    snapshot='20260101T00Z-f000-90p0-v2'
    path=tmp_path/'data'/'live'/snapshot
    path.mkdir(parents=True,exist_ok=True)
    header={'nx':4,'ny':3,'lo1':0,'la1':90,'dx':90,'dy':90}
    records=[{'header':header,'data':list(array)} for array in values]
    (path/(kind+'.json')).write_text(json.dumps(records))
    return snapshot


def test_temperature_tiles_are_north_up_and_cache_as_valid_png(tmp_path):
    snapshot=make_grid(tmp_path,'temp',[[250]*4+[275]*4+[300]*4])
    payload=layers.weather_tile(tmp_path,snapshot,'surface','temp',0,0,0)
    image=np.asarray(Image.open(io.BytesIO(payload)))
    assert image.shape==(256,256,4)
    assert image[:,:,3].min()==255
    north=250+(25/90)*(90/256/2)
    expected=[int(np.interp(north,layers.TEMP_STOPS,layers.TEMP_COLORS[:,c])) for c in range(3)]
    np.testing.assert_allclose(image[0,128,:3],expected,atol=1)
    assert not np.array_equal(image[0,128,:3],image[-1,128,:3])
    assert layers.weather_tile(tmp_path,snapshot,'surface','temp',0,0,0)==payload


def test_wind_tile_uses_vector_magnitude(tmp_path):
    snapshot=make_grid(tmp_path,'wind',[[3]*12,[4]*12])
    image=np.asarray(Image.open(io.BytesIO(layers.weather_tile(tmp_path,snapshot,'surface','wind',0,1,0))))
    np.testing.assert_allclose(image[100,100,:3],[38,124,180],atol=1)


@pytest.mark.parametrize('snapshot,layer,z,x,y',[
    ('../../private','surface',0,0,0),
    ('20260101T00Z-f000-90p0-v2','secret',0,0,0),
    ('20260101T00Z-f000-90p0-v2','surface',0,2,0),
    ('20260101T00Z-f000-90p0-v2','surface',9,0,0),
])
def test_invalid_tile_paths_rejected_before_file_access(tmp_path,snapshot,layer,z,x,y):
    with pytest.raises(ValueError):layers.weather_tile(tmp_path,snapshot,layer,'temp',z,x,y)
