import gzip
import json
import numpy as np
import pytest
from weather_geo_extractor import earth_cloud_shape as shape
from weather_geo_extractor.earth_data import EarthDataError

SNAPSHOT='20261116T12Z-f003-0p5-v2'

def column():
    h={'nx':4,'ny':3,'dx':90,'dy':90,'lo1':0,'la1':90,'refTime':'2026-11-16T12:00:00Z','forecastTime':3}
    def field(values):return {'header':dict(h),'data':values}
    values=[0]*12
    for i in [4,8,9]:values[i]=80
    return {'cover':field(values),'bottom':field([90000]*12),'top':field([25000]*12)}


def test_geographic_shape_retains_an_asymmetric_footprint_and_missing_values():
    source=column();body,regions=shape.shape_field(source)
    pixels=np.frombuffer(body,dtype='<f2').reshape(3,4,4)
    assert np.flatnonzero(pixels[:,:,3]).tolist()==[4,8,9]
    assert regions
    bottom=44330*(1-(90000/101325)**.190263)
    top=44330*(1-(25000/101325)**.190263)
    assert abs(float(pixels[1,0,1])*25000-bottom)<2
    assert abs(float(pixels[1,0,2])*25000-top)<8
    source['bottom']['data'][4]=None
    source['top']['data'][8]=100000
    changed,_=shape.shape_field(source)
    assert np.flatnonzero(np.frombuffer(changed,dtype='<f2').reshape(3,4,4)[:,:,3]).tolist()==[9]
    source['top']['header']['forecastTime']=4
    with pytest.raises(EarthDataError,match='different grids or times'):shape.shape_field(source)


def test_shape_binary_cache_is_reused_and_bound_to_the_model_time(tmp_path,monkeypatch):
    model={'id':SNAPSHOT,'run_time':'2026-11-16T12:00:00Z','valid_time':'2026-11-16T15:00:00Z'}
    root=tmp_path/'data/live'/SNAPSHOT;root.mkdir(parents=True);(root/'metadata.json').write_text(json.dumps(model))
    calls=[]
    def provider(*_, **kwargs):calls.append(True);return {**model,'source':'GFS','column':column()}
    monkeypatch.setattr(shape,'convection_profile',provider)
    from weather_geo_extractor import earth_observations
    from PIL import Image
    Image.fromarray(np.zeros((4,8,4),dtype=np.uint8)).save(tmp_path/'mask.png')
    monkeypatch.setattr(earth_observations,'cloud_observation',lambda *_:{'texture_url':'/mask.png','observation_time':model['valid_time']})
    profile=shape.cloud_shape_profile(tmp_path,SNAPSHOT)
    raw=shape.cloud_shape_bytes(tmp_path,SNAPSHOT)
    assert len(raw)==profile['byte_length']==4*3*8
    assert gzip.decompress(shape.cloud_shape_bytes(tmp_path,SNAPSHOT,True))==raw
    assert shape.cloud_shape_profile(tmp_path,SNAPSHOT)==profile and len(calls)==1
    model['valid_time']='2026-11-16T16:00:00Z';(root/'metadata.json').write_text(json.dumps(model))
    with pytest.raises(EarthDataError,match='time mismatch'):shape.cloud_shape_profile(tmp_path,SNAPSHOT)


def test_shape_rejects_path_traversal_before_reading_sources(tmp_path):
    with pytest.raises(ValueError,match='snapshot'):shape.cloud_shape_profile(tmp_path,'../../private')


def test_upper_cloud_continuation_follows_the_observed_patch_without_filling_its_hole():
    n=8;valid=np.zeros((n,n),dtype=bool);valid[2,2]=True
    base=np.full((n,n),np.nan,dtype=np.float32);top=base.copy();cover=np.zeros((n,n),dtype=np.float32)
    base[2,2]=2000;top[2,2]=12000;cover[2,2]=80
    observed=np.zeros((n,n,4),dtype=np.uint8)
    observed[1:7,1:3]=[255,100,255,255];observed[5:7,1:7]=[255,100,255,255]
    header={'dx':.25,'dy':.25,'la1':1}
    weight,bottom,ceiling,amount=shape.extend_observed_anvils(valid,base,top,cover,observed,header)
    assert weight[2,2]==1 and bottom[2,2]==2000 and ceiling[2,2]==12000
    assert 0<weight[6,6]<1 and ceiling[6,6]==12000
    assert bottom[6,6]>=10500 and amount[6,6]==80
    assert weight[2,6]==0 and np.isnan(ceiling[2,6])


def test_below_display_datum_does_not_publish_inverted_cloud_bounds():
    source = column()
    source["cover"]["data"] = [80] * 12
    source["bottom"]["data"] = [104000] * 12
    source["top"]["data"] = [102000] * 12
    field, regions = shape.shape_field(source)
    assert not regions
    assert not np.frombuffer(field, dtype="<f2").any()
