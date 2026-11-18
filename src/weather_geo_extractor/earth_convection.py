"""GFS instantaneous convective cloud columns, separate from averaged cloud bands."""
from datetime import datetime
from functools import lru_cache
import numpy as np
import json
import math
from pathlib import Path
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from .earth_data import FieldSpec, EarthDataError, Selection, ORIGINS, read_url, decode_field, atomic_json
from .earth_clouds import cloud_ranges
from .earth_heights import SNAPSHOT_PATTERN

FIELDS = {
    'cover': FieldSpec('TCDC','convective cloud layer',6,1,'convectiveCloudLayer',0,'convective'),
    'bottom': FieldSpec('PRES','convective cloud bottom level',3,0,'convectiveCloudBottom',0,'convective'),
    'top': FieldSpec('PRES','convective cloud top level',3,0,'convectiveCloudTop',0,'convective'),
}
_LOCK=threading.Lock()


def convection_profile(viewer: Path,snapshot: str,*,reader=read_url, include_cores=True):
    if not re.fullmatch(SNAPSHOT_PATTERN,snapshot):raise ValueError('Invalid convective snapshot')
    root=viewer/'data/live'/snapshot
    meta=json.loads((root/'metadata.json').read_text())
    if meta['id']!=snapshot:raise EarthDataError('Convective snapshot mismatch')
    run=datetime.fromisoformat(meta['run_time'].replace('Z','+00:00'))
    valid=datetime.fromisoformat(meta['valid_time'].replace('Z','+00:00'))
    hour=int((valid-run).total_seconds()/3600)
    cache=viewer/'data/earth3d-cache/convection'/(snapshot+'.json')
    def validate(result):
        if result.get('snapshot')!=snapshot or result.get('valid_time')!=meta['valid_time'] or result.get('run_time')!=meta['run_time']:
            raise EarthDataError('Convective cache time mismatch')
        for name,spec in FIELDS.items():
            record=result['column'][name];h=record['header']
            if (h.get('parameterUnit')!=('%' if name=='cover' else 'Pa') or h.get('levelType')!=spec.level_type
                or h.get('parameterCategory')!=spec.category or h.get('parameterNumber')!=spec.number
                or h.get('refTime')!=meta['run_time'] or h.get('forecastTime')!=hour
                or h['dx']!=.25 or h['dy']!=.25 or h['nx']!=1440 or h['ny']!=721
                or h['lo1']!=0 or h['la1']!=90 or len(record['data'])!=h['nx']*h['ny']):
                raise EarthDataError('Convective field identity mismatch')
        return result
    with _LOCK:
        if cache.is_file():
            result=validate(json.loads(cache.read_text()))
            if include_cores and 'cores' not in result:
                result['cores']=convective_cores(viewer,snapshot,result['column'])
                atomic_json(cache,result)
            return result
        key=f'gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{hour:03d}'
        last=None
        for origin in ORIGINS:
            url=origin+'/'+key
            try:
                ranges,window=cloud_ranges(reader(url+'.idx').decode(),hour,fields=FIELDS,prefer_averaged=False)
                if window!=(hour,hour):raise EarthDataError('Convective fields must be instantaneous')
                selection=Selection(run,valid,hour,url,ranges)
                def load(name):return name,decode_field(reader(url,byte_range=ranges[name]),name,selection,.25,spec=FIELDS[name])
                with ThreadPoolExecutor(max_workers=3) as pool:records=dict(pool.map(load,FIELDS))
                result=validate({'schema':1,'snapshot':snapshot,'source':'NOAA GFS convective cloud diagnostics',
                    'run_time':meta['run_time'],'valid_time':meta['valid_time'],'forecast_window_hours':list(window),
                    'column':{'name':'convective',**records},'classification':'model convective column; not a supercell identification'})
                if include_cores:
                    result['cores']=convective_cores(viewer,snapshot,result['column'])
                atomic_json(cache,result)
                return result
            except (OSError,ValueError,EarthDataError) as error:last=error
        raise EarthDataError('Matching convective cloud data is unavailable') from last


def convective_cores(viewer,snapshot,column):
    """Infer compact display cores; these are not observed rotating updrafts."""
    import cv2
    import numpy as np
    from PIL import Image
    from .earth_observations import cloud_observation
    observation=cloud_observation(viewer,snapshot)
    with Image.open(viewer/observation['texture_url'].lstrip('/')) as image:
        rgba=np.array(image)
    h=column['cover']['header'];nx,ny=h['nx'],h['ny']
    cover=np.asarray(column['cover']['data'],dtype=np.float32).reshape(ny,nx)/100
    bottom=np.asarray(column['bottom']['data'],dtype=np.float32).reshape(ny,nx)
    top=np.asarray(column['top']['data'],dtype=np.float32).reshape(ny,nx)
    base=44330*(1-np.power(bottom/101325,.190263));ceiling=44330*(1-np.power(top/101325,.190263))
    valid=np.isfinite(base)&np.isfinite(ceiling)&(ceiling-base>3000)&(cover>.05)
    score=np.where(valid,cover,0).astype(np.float32)
    maxima=(score>=cv2.dilate(score,np.ones((3,3),np.uint8))-.00001)&valid
    count,labels,stats,centers=cv2.connectedComponentsWithStats(maxima.astype(np.uint8),connectivity=8)
    edges=cv2.distanceTransform(((rgba[:,:,0]>80)&(rgba[:,:,3]>0)).astype(np.uint8),cv2.DIST_L2,3)
    result=[];height,width=rgba.shape[:2]
    for label in range(1,count):
        x,y=np.round(centers[label]).astype(int);x%=nx;y=max(0,min(ny-1,y))
        if not valid[y,x]:
            yy,xx=np.where(labels==label);j=int(np.argmax(score[yy,xx]));y,x=int(yy[j]),int(xx[j])
        lat=90-y*h['dy'];lon=(x*h['dx']+180)%360-180
        ix=int((lon+180)/360*width);iy=int((90-lat)/180*height)
        choices=[]
        for dy in [-1,0,1]:
            for dx in [-1,0,1]:
                px=(ix+dx)%width;py=max(0,min(height-1,iy+dy));value=rgba[py,px]
                if value[3]>0 and value[0]>100:choices.append((int(value[1]),-int(value[0]),px,py))
        if not choices:continue
        _,_,px,py=min(choices)
        latitude=90-(py+.5)/height*180;longitude=(px+.5)/width*360-180
        cell_area=(111195*h['dx'])**2*max(.1,float(np.cos(np.radians(latitude))))
        radius=float(np.clip(np.sqrt(cover[y,x]*cell_area/np.pi),1500,12000))
        depth=float(ceiling[y,x]-base[y,x]);observed_radius=float(edges[py,px])*40030000/width
        anvil=max(radius*1.5,min(40000,depth*3,observed_radius))
        result.append({'lon':longitude,'lat':latitude,'bottom':float(base[y,x]),'top':float(ceiling[y,x]),
                       'radius':radius,'anvil_radius':anvil,'cover':float(cover[y,x]),
                       'method':'model diagnostic maximum / observed local cold top; inferred display core'})
    return result


def core_profile(viewer, snapshot):
    """Send the geometry in use, not three million native field values."""
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot):
        raise ValueError('Invalid convective snapshot')
    cache = viewer/'data/earth3d-cache/cloud-cores'/(snapshot+'.json')
    if cache.is_file():
        result = json.loads(cache.read_text())
        metadata = json.loads((viewer/'data/live'/snapshot/'metadata.json').read_text())
        if (result.get('snapshot') != snapshot or result.get('run_time') != metadata['run_time']
                or result.get('valid_time') != metadata['valid_time']):
            raise EarthDataError('Convective core time mismatch')
        return result
    profile = convection_profile(viewer, snapshot)
    result = {key: profile[key] for key in ('schema', 'snapshot', 'source', 'run_time', 'valid_time', 'classification', 'cores')}
    result['point_url'] = '/api/earth/3d/cloud-point/' + snapshot
    atomic_json(cache, result)
    return result


@lru_cache(maxsize=1)
def _point_arrays(viewer, snapshot, revision):
    # Immutable arrays for repeated clicks. File revisions also distinguish cache repairs.
    column = convection_profile(viewer, snapshot, include_cores=False)['column']
    return column['cover']['header'], tuple(np.asarray(column[name]['data'], dtype=np.float64)
                                          for name in ('cover', 'bottom', 'top'))


def convective_point(viewer, snapshot, lon, lat):
    if not math.isfinite(lon) or not math.isfinite(lat) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError('Invalid cloud coordinates')
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot):
        raise ValueError('Invalid convective snapshot')
    cache = viewer/'data/earth3d-cache/convection'/(snapshot+'.json')
    if not cache.is_file():
        convection_profile(viewer, snapshot, include_cores=False)
    # Read the native diagnostics only, since display fields can include inferred anvils.
    revision = tuple((stat.st_ino, stat.st_mtime_ns, stat.st_size) for stat in
                     (cache.stat(), (viewer/'data/live'/snapshot/'metadata.json').stat()))
    h, arrays = _point_arrays(viewer, snapshot, revision)
    x = int(math.floor((lon % 360)/h['dx']+.5)) % h['nx']
    y = max(0, min(h['ny']-1, int(math.floor((90-lat)/h['dy']+.5))))
    index = y*h['nx']+x
    cover, bottom, top = (float(field[index]) for field in arrays)
    point = None
    if all(value is not None and math.isfinite(value) for value in (cover, bottom, top)) and cover > .1 and 0 < top < bottom < 120000:
        altitude = lambda pressure: max(0, 44330*(1-(pressure/101325)**.190263))
        point = {'bottom': altitude(bottom), 'top': altitude(top), 'cover': cover}
    return {'snapshot': snapshot, 'point': point}
