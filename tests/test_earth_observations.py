from datetime import datetime, timezone, timedelta
import io
import json

import numpy as np
import pytest
from PIL import Image
from weather_geo_extractor import earth_observations as observations
from weather_geo_extractor.earth_data import EarthDataError

TIME = datetime(2026, 11, 11, 14, tzinfo=timezone.utc)


def dataset(tmp_path, *, quality=None, stamp=TIME):
    nc = pytest.importorskip('netCDF4')
    path=tmp_path/'source.nc'
    with nc.Dataset(path,'w') as d:
        for name,length in [('time',1),('y',3),('x',4)]:d.createDimension(name,length)
        d.summary='longwave infrared';d.time_coverage_start=stamp.isoformat()
        v=d.createVariable('data','f4',('time','y','x'));v.long_name='0-255 Brightness Temperature'
        # First source column is +180 degrees, followed by the western hemisphere.
        # At a 300 K surface, count 240 = 178 K cloud, count 60 = 300 K clear.
        v[:]=np.array([[[240,60,60,60]]*3])
        d.createVariable('dqf','i1',('time','y','x'))[:]=0 if quality is None else quality
        d.createVariable('lat','f4',('y','x'))[:]=np.array([[60]*4,[0]*4,[-60]*4])
        d.createVariable('lon','f4',('y','x'))[:]=np.array([[179.999,-90,0,90]]*3)
    return path.read_bytes()


def surface(value=300):
    return {'header':{'nx':4,'ny':3,'dx':90,'dy':90,'la1':90,'lo1':0},'data':[value]*12}


def test_mode_a_calibration_is_continuous_and_respects_the_noaa_breakpoint():
    np.testing.assert_allclose(observations.mode_a_kelvin([0,100,176,177,255]),[330,280,242,241,163])


def test_observation_projection_places_the_dateline_cloud_in_the_eastern_edge(tmp_path):
    png,stamp,fraction=observations.observation_rgba(dataset(tmp_path),surface(),TIME,width=8,height=6)
    image=np.array(Image.open(io.BytesIO(png)))
    assert stamp=='2026-11-11T14:00:00Z' and .5<fraction<1
    assert image[2,-1,0]>image[2,4,0]  # Correct antimeridian, no 180-degree hemisphere swap.
    assert image[2,4,0]==0
    assert np.all(image[0,:,3]==0) and np.all(image[-1,:,3]==0)  # No invented polar observations.


def test_quality_screening_and_cold_ground_do_not_become_fake_clouds(tmp_path):
    png,_,_=observations.observation_rgba(dataset(tmp_path,quality=np.full((1,3,4),20)),surface(),TIME,8,6)
    assert not np.array(Image.open(io.BytesIO(png)))[:,:,3].any()
    # 240 counts =178 K. A matching surface temperature gives zero IR contrast.
    png,_,_=observations.observation_rgba(dataset(tmp_path),surface(178),TIME,8,6)
    assert not np.array(Image.open(io.BytesIO(png)))[:,:,0].any()


def test_observation_rejects_a_mismatched_time_before_publication(tmp_path):
    with pytest.raises(EarthDataError,match='time window'):
        observations.observation_rgba(dataset(tmp_path,stamp=TIME+timedelta(hours=3)),surface(),TIME,8,6)
    with pytest.raises(ValueError,match='snapshot'):
        observations.cloud_observation(tmp_path,'../../private',reader=lambda *_:pytest.fail('network'))


def test_published_observation_cache_is_time_bound_and_reused(tmp_path,monkeypatch):
    from urllib.parse import parse_qs,urlparse
    key='20261111T12Z-f002-90p0-v2'
    root=tmp_path/'data/live'/key;root.mkdir(parents=True)
    model={'id':key,'run_time':'2026-11-11T12:00:00Z','valid_time':'2026-11-11T14:00:00Z','forecast_hour':2}
    (root/'metadata.json').write_text(json.dumps(model))
    field=surface();field['header'].update(parameterUnit='K',refTime=model['run_time'],forecastTime=2)
    (root/'temp.json').write_text(json.dumps([field]))
    payload=dataset(tmp_path)
    monkeypatch.setattr(observations,'OBSERVATION_SIZE',(8,6))
    calls=[]
    def reader(url):
        calls.append(url)
        if url.endswith('.nc'):return payload
        prefix=parse_qs(urlparse(url).query)['prefix'][0]
        return ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                '<Contents><Key>'+prefix+'14/GLOBCOMPLIR_test.nc</Key></Contents></ListBucketResult>').encode()
    result=observations.cloud_observation(tmp_path,key,reader=reader)
    assert len(calls)==2 and result['observation_time']==model['valid_time']
    assert result['width']==8 and result['height']==6
    assert (tmp_path/result['texture_url'].lstrip('/')).is_file()
    assert observations.cloud_observation(tmp_path,key,reader=reader)==result and len(calls)==2
    meta=tmp_path/'data/earth3d-cache/cloud-observation'/key/'metadata.json'
    result['model_valid_time']='2026-11-11T15:00:00Z';meta.write_text(json.dumps(result))
    with pytest.raises(EarthDataError,match='cache identity'):
        observations.cloud_observation(tmp_path,key,reader=reader)
    assert len(calls)==2


def test_model_snapshots_share_raw_observation_without_redownloading(tmp_path,monkeypatch):
    from urllib.parse import parse_qs,urlparse
    monkeypatch.setattr(observations,'OBSERVATION_SIZE',(8,6))
    payload=dataset(tmp_path);calls=[]
    def reader(url):
        calls.append(url)
        if url.endswith('.nc'):return payload
        prefix=parse_qs(urlparse(url).query)['prefix'][0]
        assert prefix=='GMGSI_LW/2026/11/11/'
        return ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                '<Contents><Key>'+prefix+'14/GLOBCOMPLIR_test.nc</Key></Contents></ListBucketResult>').encode()
    for key,run,hour in [('20261111T12Z-f002-90p0-v2','2026-11-11T12:00:00Z',2),('20261111T10Z-f004-90p0-v2','2026-11-11T10:00:00Z',4)]:
        root=tmp_path/'data/live'/key;root.mkdir(parents=True)
        model={'id':key,'run_time':run,'valid_time':'2026-11-11T14:00:00Z','forecast_hour':hour}
        (root/'metadata.json').write_text(json.dumps(model))
        field=surface();field['header'].update(parameterUnit='K',refTime=run,forecastTime=hour)
        (root/'temp.json').write_text(json.dumps([field]))
        assert observations.cloud_observation(tmp_path,key,reader=reader)['observation_time']==model['valid_time']
    assert len(calls)==3
    assert sum(url.endswith('.nc') for url in calls)==1


def test_existing_observation_gets_exact_render_texture_without_refetch(tmp_path):
    from PIL import features
    if not features.check('webp'):
        pytest.skip('Pillow has no WebP codec')
    from urllib.parse import urlparse
    key='20261111T12Z-f002-90p0-v2'
    root=tmp_path/'data/live'/key; root.mkdir(parents=True)
    (root/'metadata.json').write_text(json.dumps({'id':key,'valid_time':TIME.isoformat()}))
    directory=tmp_path/'data/earth3d-cache/cloud-observation'/key;directory.mkdir(parents=True)
    pixels=np.zeros((2,256,4),dtype=np.uint8)
    pixels[:,:,0]=np.arange(256,dtype=np.uint8);pixels[:,:,1]=179;pixels[:,:,2]=45
    pixels[0,:,3]=255
    Image.fromarray(pixels).save(directory/'mask.png')
    old={'schema':1,'snapshot':key,'model_valid_time':TIME.isoformat(),
         'texture_url':f'/data/earth3d-cache/cloud-observation/{key}/mask.png'}
    (directory/'metadata.json').write_text(json.dumps(old))
    def read():
        return observations.cloud_observation(tmp_path,key,reader=lambda *_:pytest.fail('network'))
    info=read();assert info['texture_url']==old['texture_url']
    dest=tmp_path/urlparse(info['render_texture_url']).path.lstrip('/')
    with Image.open(dest) as im:
        packed=np.asarray(im.convert('RGBA'))
        np.testing.assert_array_equal(packed[:,:,[0,3]],pixels[:,:,[0,3]])
    stamp=dest.stat().st_mtime_ns
    assert read()==info and dest.stat().st_mtime_ns==stamp
    dest.unlink()
    assert read()==info and dest.is_file()
    np.testing.assert_array_equal(np.asarray(Image.open(directory/'mask.png')),pixels)
