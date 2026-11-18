from datetime import timedelta
import json
import pytest
from weather_geo_extractor import earth_clouds as clouds
from weather_geo_extractor import earth_data as data
from test_earth_pressure import RUN, message, snapshot


def index():
    rows=[]
    for i, spec in enumerate(clouds.FIELDS.values()):
        rows.append(f'{i+1}:{i*100}:d=2026110900:{spec.variable}:{spec.index_level}:0-3 hour ave fcst:')
    # A second instantaneous product exists; the average must be chosen deliberately.
    rows.append('10:900:d=2026110900:LCDC:low cloud layer:3 hour fcst:')
    rows.append('11:1000:d=2026110900:TMP:surface:3 hour fcst:')
    return '\n'.join(rows)


def test_cloud_index_selects_consistent_window_not_duplicate_instantaneous():
    ranges, window=clouds.cloud_ranges(index(),3)
    assert ranges['low_cover']==(0,99)
    assert len(ranges)==9 and window==(0,3)
    with pytest.raises(data.EarthDataError,match='incompatible'):
        clouds.cloud_ranges(index().replace('PRES:low cloud bottom level:0-3 hour ave fcst',
                                           'PRES:low cloud bottom level:3 hour fcst'),3)
    with pytest.raises(data.EarthDataError,match='Missing'):
        clouds.cloud_ranges(index().replace('HCDC:','NOPE:'),3)


def test_real_cloud_grib_decoder_checks_units_identity_and_percent_bounds():
    ec=pytest.importorskip('eccodes')
    def payload(value,category=6,number=3):
        h=ec.codes_new_from_message(message(value=value,surface_type=214))
        try:
            ec.codes_set(h,'centre',7);ec.codes_set(h,'typeOfLevel','lowCloudLayer');ec.codes_set(h,'level',0);
            ec.codes_set(h,'parameterCategory',category);ec.codes_set(h,'parameterNumber',number)
            return ec.codes_get_message(h)
        finally:ec.codes_release(h)
    selection=data.Selection(RUN,RUN+timedelta(hours=3),3,'https://example.test',{})
    r=data.decode_field(payload(80),'low_cover',selection,90,spec=clouds.FIELDS['low_cover'])
    assert r['header']['parameterUnit']=='%' and r['data']==[80]*12
    with pytest.raises(data.EarthDataError,match='percent'):
        data.decode_field(payload(101),'low_cover',selection,90,spec=clouds.FIELDS['low_cover'])


def test_cloud_cache_is_snapshot_bound_and_no_network_for_valid_cache(tmp_path,monkeypatch):
    key=snapshot(tmp_path);calls=[]
    def decode(payload,name,selection,resolution,*,spec):
        return {'header':{'nx':4,'ny':3,'dx':90,'dy':90,'lo1':0,'la1':90,
                          'refTime':data.iso_time(RUN),'forecastTime':3,'parameterUnit':'%' if name.endswith('cover') else 'Pa',
                          'parameterCategory':spec.category,'parameterNumber':spec.number,'levelType':spec.level_type},'data':[50]*12}
    monkeypatch.setattr(clouds,'decode_field',decode)
    def reader(url,*,byte_range=None):
        calls.append(byte_range);return index().encode() if byte_range is None else b'GRIB'
    result=clouds.cloud_profile(tmp_path,key,reader=reader)
    assert len(calls)==10 and len(result['bands'])==3
    assert clouds.cloud_profile(tmp_path,key,reader=reader)==result and len(calls)==10
    path=tmp_path/'data/earth3d-cache/cloud-volume'/f'{key}.json'
    result['bands'][0]['top']['header']['forecastTime']=6;path.write_text(json.dumps(result))
    with pytest.raises(data.EarthDataError,match='mismatch'):clouds.cloud_profile(tmp_path,key,reader=reader)
    with pytest.raises(ValueError):clouds.cloud_profile(tmp_path,'../../secret',reader=reader)
