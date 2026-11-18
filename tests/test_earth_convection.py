from datetime import timedelta
import pytest
from weather_geo_extractor import earth_data as data
from weather_geo_extractor.earth_clouds import cloud_ranges
from weather_geo_extractor.earth_convection import FIELDS,convection_profile
from test_earth_pressure import RUN,message


def test_convection_uses_instantaneous_products_not_the_stratiform_average():
    rows=[]
    for i,(name,spec) in enumerate(FIELDS.items()):
        rows.extend([f'{i*2+1}:{i*200}:d=2026110900:{spec.variable}:{spec.index_level}:0-3 hour ave fcst:',
                     f'{i*2+2}:{i*200+100}:d=2026110900:{spec.variable}:{spec.index_level}:3 hour fcst:'])
    rows.append('7:600:d=2026110900:TMP:surface:3 hour fcst:')
    selected,window=cloud_ranges('\n'.join(rows),3,fields=FIELDS,prefer_averaged=False)
    assert selected=={'cover':(100,199),'bottom':(300,399),'top':(500,599)}
    assert window==(3,3)


def test_convective_grib_has_the_correct_vertical_identity_and_units():
    ec=pytest.importorskip('eccodes')
    selection=data.Selection(RUN,RUN+timedelta(hours=3),3,'https://example.test',{})
    for name,value in [('cover',80),('bottom',85000),('top',18000)]:
        spec=FIELDS[name];h=ec.codes_new_from_message(message(value=value))
        try:
            for key,v in [('centre',7),('typeOfLevel',spec.level_type),('level',0),('parameterCategory',spec.category),('parameterNumber',spec.number)]:ec.codes_set(h,key,v)
            payload=ec.codes_get_message(h)
        finally:ec.codes_release(h)
        result=data.decode_field(payload,name,selection,90,spec=spec)
        assert result['header']['parameterUnit']==('%' if name=='cover' else 'Pa')
        assert result['header']['levelType']==spec.level_type
        assert result['data']==[value]*12


def test_convective_snapshot_rejects_path_traversal_without_network(tmp_path):
    with pytest.raises(ValueError,match='snapshot'):
        convection_profile(tmp_path,'../../private',reader=lambda *_:pytest.fail('network'))


def test_inferred_cores_require_joint_observation_and_deep_model_support(tmp_path,monkeypatch):
    import numpy as np
    from PIL import Image
    from weather_geo_extractor import earth_observations
    from weather_geo_extractor.earth_convection import convective_cores
    rgba=np.zeros((180,360,4),dtype=np.uint8)
    rgba[88:93,178:183]=[220,80,200,255]
    Image.fromarray(rgba).save(tmp_path/'observation.png')
    monkeypatch.setattr(earth_observations,'cloud_observation',lambda *_:{'texture_url':'/observation.png'})
    header={'nx':4,'ny':3,'dx':90,'dy':90}
    def field(value):return {'header':header,'data':[value]*12}
    cover=field(0);cover['data'][4]=80
    column={'cover':cover,'bottom':field(85000),'top':field(20000)}
    cores=convective_cores(tmp_path,'test',column)
    assert len(cores)==1
    assert 0<cores[0]['bottom']<cores[0]['top']<15000
    assert 1500<=cores[0]['radius']<=12000
    assert cores[0]['anvil_radius']>=cores[0]['radius']
    column['top']=field(85000)
    assert convective_cores(tmp_path,'test',column)==[]
    column['top']=field(20000)
    Image.fromarray(np.zeros_like(rgba)).save(tmp_path/'observation.png')
    assert convective_cores(tmp_path,'test',column)==[]


def test_core_delivery_omits_native_columns_and_keeps_exact_point_diagnostics(tmp_path,monkeypatch):
    import json
    from weather_geo_extractor import earth_convection as convection
    key='20261116T06Z-f009-0p5-v2'
    metadata={'run_time':'2026-11-16T06:00:00Z','valid_time':'2026-11-16T15:00:00Z'}
    path=tmp_path/'data/live'/key/'metadata.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(metadata))
    def field(value):return {'header':{'nx':4,'ny':3,'dx':90,'dy':90},'data':[value]*12}
    native={'schema':1,'snapshot':key,'source':'GFS',**metadata,'classification':'model','cores':[{'lon':0}],
            'column':{'cover':field(80),'bottom':field(85000),'top':field(20000)}}
    cache=tmp_path/'data/earth3d-cache/convection'/(key+'.json')
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps(native))
    reads=[]
    def read(*args, **kwargs):
        reads.append(True)
        return json.loads(cache.read_text())
    monkeypatch.setattr(convection,'convection_profile',read)
    core=convection.core_profile(tmp_path,key)
    assert 'column' not in core and core['cores']==native['cores']
    assert convection.core_profile(tmp_path,key)==core
    point=convection.convective_point(tmp_path,key,0,0)['point']
    assert point['cover']==80 and point['bottom']<point['top']
    count=len(reads)
    assert convection.convective_point(tmp_path,key,1,0)['point']==point
    assert len(reads)==count
    native['column']['cover']['data'][4]=0
    cache.write_text(json.dumps(native))
    assert convection.convective_point(tmp_path,key,0,0)['point'] is None
    with pytest.raises(ValueError):convection.convective_point(tmp_path,key,float('nan'),0)
