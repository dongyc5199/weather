"""Snapshot-bound three-layer GFS cloud volumes; never infer height from image grey."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import re
import threading
from pathlib import Path

from .earth_data import EarthDataError, FieldSpec, ORIGINS, Selection, atomic_json, decode_field, read_url
from .earth_heights import SNAPSHOT_PATTERN

BANDS = (('low', 'low', 'LCDC', 3), ('middle', 'middle', 'MCDC', 4), ('high', 'high', 'HCDC', 5))
FIELDS = {}
for band, label, variable, number in BANDS:
    FIELDS[band + '_cover'] = FieldSpec(variable, label + ' cloud layer', 6, number, band + 'CloudLayer', 0, band)
    for edge in ('bottom', 'top'):
        FIELDS[band + '_' + edge] = FieldSpec('PRES', label + ' cloud ' + edge + ' level', 3, 0,
                                             band + 'Cloud' + edge.title(), 0, band)
_LOCK = threading.Lock()


def cloud_ranges(text, forecast, *, fields=None, prefer_averaged=True):
    fields = FIELDS if fields is None else fields
    rows = [line.split(':') for line in text.splitlines() if line.strip()]
    selected = {}
    windows = set()
    for name, spec in fields.items():
        matches = [(i, row) for i, row in enumerate(rows[:-1]) if row[3:5] == [spec.variable, spec.index_level]]
        # Coverage and vertical boundaries must describe the same averaging period.
        averaged = [(i, row) for i, row in matches if re.fullmatch(r'\d+-' + str(forecast) + r' hour ave fcst', row[5])]
        instantaneous = [(i, row) for i, row in matches if row[5] in (f'{forecast} hour fcst', 'anl')]
        matches = (averaged or instantaneous) if prefer_averaged else instantaneous
        if len(matches) != 1:
            raise EarthDataError('Missing or ambiguous GFS cloud field: ' + name)
        i, row = matches[0]
        start = int(row[5].split('-')[0]) if 'ave' in row[5] else forecast
        windows.add((start, forecast))
        selected[name] = (int(row[1]), int(rows[i + 1][1]) - 1)
    if len(windows) != 1:
        raise EarthDataError('Cloud fields have incompatible time windows')
    return selected, windows.pop()


def cloud_profile(viewer: Path, snapshot: str, *, reader=read_url):
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot):
        raise ValueError('Invalid cloud snapshot')
    source = viewer / 'data/live' / snapshot
    metadata = json.loads((source / 'metadata.json').read_text())
    if metadata['id'] != snapshot:
        raise EarthDataError('Cloud snapshot identity mismatch')
    cache = viewer / 'data/earth3d-cache/cloud-volume' / (snapshot + '.json')
    resolution = max(1, metadata['resolution'])
    run = datetime.fromisoformat(metadata['run_time'].replace('Z', '+00:00'))
    valid = datetime.fromisoformat(metadata['valid_time'].replace('Z', '+00:00'))
    forecast = int((valid - run).total_seconds() / 3600)

    def validate(result):
        if (result.get('snapshot') != snapshot or result.get('valid_time') != metadata['valid_time']
                or result.get('run_time') != metadata['run_time'] or len(result.get('bands', [])) != 3):
            raise EarthDataError('Cloud cache does not match snapshot')
        if [band.get('name') for band in result['bands']] != [name for name, *_ in BANDS]:
            raise EarthDataError('Cloud band identity mismatch')
        for band in result['bands']:
            for key in ('cover', 'bottom', 'top'):
                r = band[key]; h = r['header']
                spec = FIELDS[band['name'] + '_' + key]
                if (h.get('parameterUnit') != ('%' if key == 'cover' else 'Pa')
                        or h.get('parameterCategory') != spec.category or h.get('parameterNumber') != spec.number
                        or h.get('levelType') != spec.level_type):
                    raise EarthDataError('Cloud field identity mismatch')
                if (h['refTime'] != metadata['run_time'] or h['forecastTime'] != forecast
                        or h['dx'] != resolution or h['dy'] != resolution or h['lo1'] != 0 or h['la1'] != 90
                        or h['nx'] * resolution != 360 or (h['ny'] - 1) * resolution != 180
                        or len(r['data']) != h['nx'] * h['ny']):
                    raise EarthDataError('Cloud field grid or time mismatch')
        return result

    with _LOCK:
        if cache.is_file():
            return validate(json.loads(cache.read_text()))
        key = f'gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{forecast:03d}'
        last = None
        for origin in ORIGINS:
            url = origin + '/' + key
            try:
                index = reader(url + '.idx').decode()
                ranges, window = cloud_ranges(index, forecast)
                selection = Selection(run, valid, forecast, url, ranges)
                def download(name):
                    return name, decode_field(reader(url, byte_range=ranges[name]), name, selection,
                                              resolution, spec=FIELDS[name])
                with ThreadPoolExecutor(max_workers=3) as pool:
                    records = dict(pool.map(download, FIELDS))
                result = validate({'schema': 1, 'snapshot': snapshot, 'source': 'NOAA GFS',
                    'run_time': metadata['run_time'], 'valid_time': metadata['valid_time'],
                    'forecast_window_hours': list(window), 'height_reference': 'standard-atmosphere pressure altitude, approximate',
                    'bands': [{'name': name, **{kind: records[name + '_' + kind] for kind in ('cover', 'bottom', 'top')}}
                              for name, *_ in BANDS]})
                atomic_json(cache, result)
                return result
            except (OSError, ValueError, EarthDataError) as exc:
                last = exc
        raise EarthDataError('Matching GFS cloud volume is unavailable') from last
