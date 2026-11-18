"""GPU-ready geographic cloud columns; bounds only accelerate sampling, never shape it."""
import gzip
import json
import math
from pathlib import Path
import re
import threading

import cv2
import numpy as np

from .earth_data import EarthDataError, atomic_json
from .earth_heights import SNAPSHOT_PATTERN
from .earth_convection import convection_profile

_LOCK = threading.Lock()
HEIGHT_RANGE = 25000
SHAPE_VERSION = 3


def extend_observed_anvils(valid, bottom, top, cover, observed, header):
    """Continue upper cloud within the same observed patch, never invent a full updraft."""
    cloudy = (observed[:, :, 0] > 51) & (observed[:, :, 3] > 250)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(cloudy.astype(np.uint8), connectivity=8)
    weight = valid.astype(np.float32)
    bottom, top, cover = bottom.copy(), top.copy(), cover.copy()
    for component in range(1, count):
        x, y, width, height, _ = stats[component]
        area = (slice(y, y+height), slice(x, x+width))
        mask = labels[area] == component
        source = valid[area] & mask
        if not source.any() or not (mask & ~valid[area]).any():
            continue
        _, nearest = cv2.distanceTransformWithLabels((~source).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        sy, sx = np.nonzero(source)
        source_y = np.zeros(nearest.max()+1, dtype=np.int32)
        source_x = np.zeros_like(source_y)
        source_y[nearest[sy, sx]] = sy+y
        source_x[nearest[sy, sx]] = sx+x
        ny, nx = source_y[nearest], source_x[nearest]
        yy, xx = np.mgrid[y:y+height, x:x+width]
        distance = np.hypot((xx-nx)*header['dx']*111320*np.cos(np.radians(header['la1']-yy*header['dy'])), (yy-ny)*header['dy']*111320)
        delta = np.abs(observed[area][:,:,1].astype(np.float32)-observed[ny,nx,1].astype(np.float32))*170/255
        thermal = np.clip((18-delta)/10, 0, 1)
        confidence = .45*thermal*np.exp(-distance/150000)
        fill = mask & ~valid[area] & (confidence > .015)
        source_top, source_base = top[ny,nx], bottom[ny,nx]
        # Missing columns receive a thin inferred upper continuation, not the source's deep base.
        base = np.maximum(source_base, source_top-np.clip((source_top-source_base)*.18,300,1500))
        bottom[area][fill] = base[fill]
        top[area][fill] = source_top[fill]
        cover[area][fill] = cover[ny,nx][fill]
        weight[area][fill] = confidence[fill]
    return weight, bottom, top, cover


def shape_field(column, observed=None):
    """Retain the native grid and its missing values, with half-float GPU precision."""
    header = column['cover']['header']
    nx, ny = header['nx'], header['ny']
    cover = np.asarray(column['cover']['data'], dtype=np.float32).reshape(ny, nx)
    pressure = [np.asarray(column[name]['data'], dtype=np.float32).reshape(ny, nx) for name in ('bottom', 'top')]
    for record in (column['bottom'], column['top']):
        if any(record['header'][key] != header[key] for key in ('nx', 'ny', 'dx', 'dy', 'lo1', 'la1', 'refTime', 'forecastTime')):
            raise EarthDataError('Cloud shape fields have different grids or times')
    with np.errstate(invalid='ignore', divide='ignore'):
        bottom, top = [44330 * (1 - np.power(value / 101325, .190263)) for value in pressure]
    valid = (np.isfinite(cover) & (cover > .1) & (cover <= 100) &
             np.isfinite(bottom) & np.isfinite(top) & (top - bottom > 1) &
             (pressure[0] > 0) & (pressure[1] > 0) & (top <= HEIGHT_RANGE))
    bottom = np.maximum(bottom, 0)
    valid &= top > bottom  # The rendered shell starts at zero after clipping its base.
    weight = valid.astype(np.float32)
    if observed is not None:
        weight, bottom, top, cover = extend_observed_anvils(valid, bottom, top, cover, observed, header)
        valid = weight > .015
    pixels = np.zeros((ny, nx, 4), dtype='<f2')
    pixels[:, :, 0] = np.where(valid, cover / 100 * weight, 0)
    pixels[:, :, 1] = np.where(valid, bottom / HEIGHT_RANGE * weight, 0)
    pixels[:, :, 2] = np.where(valid, top / HEIGHT_RANGE * weight, 0)
    pixels[:, :, 3] = weight

    # One-degree blocks are conservative acceleration regions, not circular cloud caps.
    # Include a one-cell halo in vertical bounds for normalized bilinear interpolation.
    minimum = cv2.erode(np.pad(np.where(valid, bottom, HEIGHT_RANGE).astype(np.float32), ((0, 0), (1, 1)), mode='wrap'), np.ones((3, 3), np.uint8))[:, 1:-1]
    maximum = cv2.dilate(np.pad(np.where(valid, top, 0).astype(np.float32), ((0, 0), (1, 1)), mode='wrap'), np.ones((3, 3), np.uint8))[:, 1:-1]
    block = max(1, round(1 / header['dx']))
    regions = []
    for y in range(0, ny, block):
        for x in range(0, nx, block):
            rows, cols = min(block, ny-y), min(block, nx-x)
            area = (slice(y, y+rows), slice(x, x+cols))
            if not valid[area].any():
                continue
            lon = (header['lo1']+(x+(cols-1)/2)*header['dx']+180) % 360-180
            lat = header['la1']-(y+(rows-1)/2)*header['dy']
            east = (cols+1)/2*header['dx']*111320*max(.01, math.cos(math.radians(max(0, abs(lat)-(rows+1)/2*header['dy']))))
            north = (rows+1)/2*header['dy']*111320
            regions.append([lon, lat, float(minimum[area].min()), float(maximum[area].max()), math.hypot(east, north)+500])
    return pixels.tobytes(), regions


def cloud_shape_profile(viewer: Path, snapshot: str):
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot):
        raise ValueError('Invalid cloud shape snapshot')
    model = json.loads((viewer/'data/live'/snapshot/'metadata.json').read_text())
    if model['id'] != snapshot:
        raise EarthDataError('Cloud shape snapshot mismatch')
    directory = viewer/'data/earth3d-cache/cloud-shape-v1'/snapshot
    metadata = directory/'metadata.json'
    def cached():
        if not metadata.is_file():
            return None
        result = json.loads(metadata.read_text())
        if result.get('shape_version') != SHAPE_VERSION:
            return None
        if any(region[3] <= region[2] for region in result['regions']):
            return None  # Rebuild older regions whose tops fell below the displayed base.
        if (result.get('schema') != 1 or result.get('snapshot') != snapshot or
                result.get('run_time') != model['run_time'] or result.get('valid_time') != model['valid_time']):
            raise EarthDataError('Cloud shape cache time mismatch')
        if not (directory/'field.bin').is_file() or (directory/'field.bin').stat().st_size != result['byte_length']:
            return None
        return result if (directory/'field.bin.gz').is_file() else None
    ready = cached()
    if ready:
        return ready
    with _LOCK:
        ready = cached()
        if ready:
            return ready
        from .earth_observations import cloud_observation
        from PIL import Image
        source = convection_profile(viewer, snapshot, include_cores=False)
        observation = cloud_observation(viewer, snapshot)
        with Image.open(viewer/observation['texture_url'].lstrip('/')) as image:
            rgba = np.asarray(image)
        h = source['column']['cover']['header']
        longitude = h['lo1']+np.arange(h['nx'],dtype=np.float32)*h['dx']
        latitude = h['la1']-np.arange(h['ny'],dtype=np.float32)*h['dy']
        mx, my = np.meshgrid(((longitude+180)%360)/360*rgba.shape[1]-.5, np.clip((90-latitude)/180*rgba.shape[0]-.5,0,rgba.shape[0]-1))
        observed = cv2.remap(rgba,mx.astype(np.float32),my.astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_WRAP)
        body, regions = shape_field(source['column'], observed)
        result = {
            'schema': 1, 'shape_version': SHAPE_VERSION, 'snapshot': snapshot, 'source': source['source'],
            'run_time': source['run_time'], 'valid_time': source['valid_time'],
            'grid': source['column']['cover']['header'],
            'encoding': 'rgba16f-le', 'height_range_m': HEIGHT_RANGE, 'byte_length': len(body),
            'field_url': '/api/earth/3d/cloud-shape/'+snapshot+'/field.bin',
            'observation_time': observation['observation_time'],
            'point_url': '/api/earth/3d/cloud-point/'+snapshot,
            'regions': regions,
            'shape_method': 'geographic GFS columns / observed connected upper continuation; inferred outside valid model columns',
        }
        directory.mkdir(parents=True, exist_ok=True)
        for name, payload in (('field.bin', body), ('field.bin.gz', gzip.compress(body, compresslevel=3, mtime=0))):
            pending = directory/(name+'.tmp'); pending.write_bytes(payload); pending.replace(directory/name)
        atomic_json(metadata, result)
        return result


def cloud_shape_bytes(viewer, snapshot, compressed=False):
    cloud_shape_profile(viewer, snapshot)
    return (viewer/'data/earth3d-cache/cloud-shape-v1'/snapshot/('field.bin.gz' if compressed else 'field.bin')).read_bytes()
