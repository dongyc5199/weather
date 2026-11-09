from datetime import datetime, timedelta, timezone
import json

import numpy as np
import pytest

from weather_geo_extractor import earth_data as data
from weather_geo_extractor.earth_heights import height_profile

RUN = datetime(2026, 11, 7, 18, tzinfo=timezone.utc)


def height_message(spec, value, forecast=4):
    ec = pytest.importorskip('eccodes')
    handle = ec.codes_grib_new_from_samples('regular_ll_sfc_grib2')
    try:
        for key, val in {
            'Ni': 8, 'Nj': 5,
            'latitudeOfFirstGridPointInDegrees': 90, 'latitudeOfLastGridPointInDegrees': -90,
            'longitudeOfFirstGridPointInDegrees': 0, 'longitudeOfLastGridPointInDegrees': 315,
            'iDirectionIncrementInDegrees': 45, 'jDirectionIncrementInDegrees': 45,
            'discipline': 0, 'parameterCategory': spec.category, 'parameterNumber': spec.number,
            'typeOfFirstFixedSurface': 1 if spec.level_type == 'surface' else 100,
            'scaledValueOfFirstFixedSurface': spec.level * 100,
            'dataDate': 20261107, 'dataTime': 1800, 'forecastTime': forecast,
        }.items():
            ec.codes_set(handle, key, val)
        ec.codes_set_values(handle, np.full(40, value))
        return ec.codes_get_message(handle)
    finally:
        ec.codes_release(handle)


@pytest.mark.parametrize('name,value', [('orography', 1500), ('surface_pressure', 80000), ('500hPa-height', 5600)])
def test_real_height_and_pressure_grib_preserves_units_and_level(name, value):
    spec = data.HEIGHT_FIELDS[name]
    selection = data.Selection(RUN, RUN + timedelta(hours=4), 4, 'https://example.test/gfs', {})
    result = data.decode_field(height_message(spec, value), name, selection, 90, spec=spec)
    assert result['header']['parameterUnit'] == ('Pa' if name == 'surface_pressure' else 'gpm')
    assert result['header']['layer'] == spec.layer
    assert result['data'] == [value] * 12
    with pytest.raises(data.EarthDataError, match='run/valid time'):
        data.decode_field(height_message(spec, value, forecast=5), name, selection, 90, spec=spec)


def test_height_profile_is_cached_and_locked_to_the_existing_wind_snapshot(tmp_path):
    snapshot = '20261107T18Z-f004-90p0-v2'
    source = tmp_path / 'data/live' / snapshot
    (source / '500hPa').mkdir(parents=True)
    metadata = {'id': snapshot, 'run_time': data.iso_time(RUN), 'valid_time': data.iso_time(RUN + timedelta(hours=4)), 'resolution': 90}
    (source / 'metadata.json').write_text(json.dumps(metadata))
    (source / '500hPa/wind.json').write_text(json.dumps([{'header': {
        'nx': 4, 'ny': 3, 'lo1': 0, 'la1': 90, 'dx': 90, 'dy': 90,
        'refTime': metadata['run_time'], 'forecastTime': 4,
    }}]))
    names = ['orography', 'surface_pressure', '500hPa-height']
    values = [1500, 80000, 5600]
    messages = [height_message(data.HEIGHT_FIELDS[n], v) for n, v in zip(names, values)]
    index = '\n'.join(f'{i+1}:{i*100}:d=2026110718:{data.HEIGHT_FIELDS[n].variable}:{data.HEIGHT_FIELDS[n].index_level}:4 hour fcst:' for i, n in enumerate(names)) + '\n4:300:d=2026110718:TMP:surface:4 hour fcst:\n'
    requests = []

    def reader(url, *, byte_range=None):
        requests.append((url, byte_range))
        assert url.startswith(data.ORIGINS[0] + '/gfs.20261107/18/atmos/gfs.t18z.pgrb2.0p25.f004')
        return index.encode() if byte_range is None else messages[byte_range[0] // 100]

    profile = height_profile(tmp_path, snapshot, '500hPa', reader=reader)
    assert profile['height']['data'][0] == 5600
    assert profile['surface_pressure']['data'][0] == 80000
    assert len(requests) == 4
    assert height_profile(tmp_path, snapshot, '500hPa', reader=reader) == profile
    assert len(requests) == 4


@pytest.mark.parametrize('snapshot,layer', [('../../private', '500hPa'), ('20261107T18Z-f004-90p0-v2', '../private')])
def test_height_profile_rejects_invalid_paths(tmp_path, snapshot, layer):
    with pytest.raises(ValueError):
        height_profile(tmp_path, snapshot, layer)
