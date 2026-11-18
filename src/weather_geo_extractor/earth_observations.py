"""Georeferenced NOAA GMGSI observations, converted to a diagnostic cloud mask.

Counts use NOAA mode-A infrared calibration. Cloud detection is a 2 m air-temperature/IR
contrast proxy, not an operational cloud-mask or cloud-height retrieval.
"""
from datetime import datetime, timedelta, timezone
import io
import hashlib
import json
from pathlib import Path
import re
import tempfile
import threading
from weakref import WeakValueDictionary
from urllib.parse import urlencode
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from PIL import Image, features

from .earth_data import EarthDataError, atomic_json
from .earth_heights import SNAPSHOT_PATTERN
from .earth_layers import fetch_bytes

ORIGIN = 'https://noaa-gmgsi-pds.s3.amazonaws.com/'
OBSERVATION_SIZE = (4096, 2048)
_locks = WeakValueDictionary()
_source_locks = WeakValueDictionary()
_locks_guard = threading.Lock()
_decode_lock = threading.Lock()
UTC = timezone.utc


def mode_a_kelvin(counts):
    counts = np.asarray(counts, dtype=np.float32)
    return np.where(counts <= 176, 330 - counts / 2, 418 - counts)


def _smooth(value, low, high):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def observation_rgba(payload, surface, expected, width=4096, height=2048):
    import netCDF4
    with netCDF4.Dataset('gmgsi.nc', memory=payload) as dataset:
        variable = dataset.variables['data']
        if len(variable.shape) != 3 or variable.shape[0] != 1 or np.prod(variable.shape) > 20000000:
            raise EarthDataError('Unsupported observation dimensions')
        if '0-255' not in variable.long_name or dataset.summary != 'longwave infrared':
            raise EarthDataError('Unsupported observation calibration')
        observed = datetime.fromisoformat(dataset.time_coverage_start.replace('Z', '+00:00'))
        if abs((observed - expected).total_seconds()) > 2 * 3600:
            raise EarthDataError('Observation does not match the weather time window')
        counts = np.ma.filled(variable[0], np.nan).astype(np.float32)
        quality = np.ma.filled(dataset.variables['dqf'][0], -1)
        lat = np.asarray(dataset.variables['lat'][:, 0], dtype=np.float32)
        lon = (np.asarray(dataset.variables['lon'][0, :], dtype=np.float32) + 180) % 360 - 180
        order = np.argsort(lon)
        lon = lon[order]
        counts = counts[:, order]
        quality = quality[:, order]
        if not (np.all(np.diff(lat) < 0) and np.all(np.diff(lon) > 0)):
            raise EarthDataError('Unexpected observation orientation')
        valid = (quality == 0) & np.isfinite(counts) & (counts >= 0) & (counts <= 255)
        temperature = mode_a_kelvin(np.nan_to_num(counts))
        observation_time = observed.isoformat(timespec='seconds').replace('+00:00', 'Z')

    # Use the supplied coordinates, not a guessed equirectangular source: GMGSI is Mercator.
    target_lon = -180 + (np.arange(width, dtype=np.float32) + .5) * 360 / width
    target_lat = 90 - (np.arange(height, dtype=np.float32) + .5) * 180 / height
    x = np.interp(target_lon, lon, np.arange(len(lon))).astype(np.float32)
    y = np.interp(target_lat, lat[::-1], np.arange(len(lat))[::-1]).astype(np.float32)
    xx, yy = np.meshgrid(x, y)
    weight = cv2.remap(valid.astype(np.float32), xx, yy, cv2.INTER_LINEAR)
    tb = cv2.remap(temperature * valid, xx, yy, cv2.INTER_LINEAR) / np.maximum(weight, .001)
    coverage = (target_lat[:, None] <= lat[0]) & (target_lat[:, None] >= lat[-1])
    good = (weight > .99) & coverage

    h = surface['header']
    ground = np.asarray(surface['data'], dtype=np.float32).reshape(h['ny'], h['nx'])
    gx = (target_lon % 360) / h['dx']
    gy = (h['la1'] - target_lat) / h['dy']
    # One wrapped longitude column makes the anti-meridian interpolation continuous.
    ground = np.concatenate((ground, ground[:, :1]), axis=1)
    mx, my = np.meshgrid(gx.astype(np.float32), gy.astype(np.float32))
    ts = cv2.remap(ground, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    good &= np.isfinite(ts) & (ts >= 150) & (ts <= 350)
    contrast = ts - tb
    cloud = _smooth(contrast, 3, 13) * (.3 + .7 * _smooth(285 - tb, 0, 50))
    # A little cold-cloud texture remains visible; the mask never uses procedural noise.
    pixels = np.zeros((height, width, 4), dtype=np.uint8)
    pixels[:, :, 0] = np.round(np.nan_to_num(np.clip(cloud, 0, 1)) * 255).astype(np.uint8)
    pixels[:, :, 1] = np.round(np.clip((tb - 160) / 170, 0, 1) * 255).astype(np.uint8)
    pixels[:, :, 2] = np.round(np.clip(contrast / 50, 0, 1) * 255).astype(np.uint8)
    pixels[:, :, 3] = good.astype(np.uint8) * 255
    pixels[~good] = 0
    buffer = io.BytesIO(); Image.fromarray(pixels).save(buffer, format='PNG')
    return buffer.getvalue(), observation_time, float(np.mean(good))


def _render_mask(directory: Path, snapshot: str) -> str | None:
    """Publish only cloud strength and validity for WebGL; keep diagnostic channels in mask.png."""
    destination = directory / 'cloud-ra-v1.webp'
    if not destination.is_file():
        if not features.check('webp'):
            return None
        temp_name = None
        try:
            with Image.open(directory / 'mask.png') as source:
                render = Image.merge('LA', (source.getchannel('R'), source.getchannel('A')))
            with tempfile.NamedTemporaryFile(dir=directory, suffix='.tmp', delete=False) as stream:
                temp_name = stream.name
                render.save(stream, 'WEBP', lossless=True, exact=True, method=3)
            Path(temp_name).replace(destination)
        except (OSError, KeyError, ValueError):
            # Pillow builds without WebP support can still serve the scientific PNG.
            return None
        finally:
            if temp_name:
                Path(temp_name).unlink(missing_ok=True)
    return f'/data/earth3d-cache/cloud-observation/{snapshot}/{destination.name}'


def cloud_observation(viewer: Path, snapshot: str, *, reader=fetch_bytes):
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot):
        raise ValueError('Invalid cloud observation snapshot')
    root = viewer / 'data/live' / snapshot
    model = json.loads((root / 'metadata.json').read_text())
    if model['id'] != snapshot:
        raise EarthDataError('Observation snapshot identity mismatch')
    expected = datetime.fromisoformat(model['valid_time'].replace('Z', '+00:00'))
    directory = viewer / 'data/earth3d-cache/cloud-observation' / snapshot
    metadata = directory / 'metadata.json'
    with _locks_guard:
        lock = _locks.setdefault(str(directory), threading.Lock())
    with lock:
        if metadata.is_file() and (directory / 'mask.png').is_file():
            cached = json.loads(metadata.read_text())
            if cached.get('schema') != 1 or cached['snapshot'] != snapshot or cached['model_valid_time'] != model['valid_time']:
                raise EarthDataError('Observation cache identity mismatch')
            method = 'calibrated mode-A IR / GFS 2 m air-temperature contrast proxy'
            updated = dict(cached, mask_method=method)
            render_url = _render_mask(directory, snapshot)
            if render_url:
                updated['render_texture_url'] = render_url
            else:
                updated.pop('render_texture_url', None)
            if updated != cached:
                atomic_json(metadata, updated)
            return updated
        surface = json.loads((root / 'temp.json').read_text())[0]
        if (surface['header'].get('parameterUnit') != 'K'
                or surface['header']['refTime'] != model['run_time'] or surface['header']['forecastTime'] != model['forecast_hour']):
            raise EarthDataError('Surface temperature is from another forecast')
        ns = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}
        last = None
        candidates = []
        # One day listing finds the nearest available hour, avoiding serial empty-hour probes.
        now = datetime.now(UTC)
        dates = dict.fromkeys((expected + timedelta(hours=offset)).date() for offset in (0, -2, 2)
                              if expected + timedelta(hours=offset) <= now)
        for day in dates:
            prefix = f'GMGSI_LW/{day:%Y/%m/%d}/'
            try:
                listing = ET.fromstring(reader(ORIGIN + '?' + urlencode({'list-type': 2, 'prefix': prefix, 'max-keys': 1000})))
                for element in listing.findall('s:Contents/s:Key', ns):
                    key = element.text or ''
                    match = re.fullmatch(re.escape(prefix) + r'(\d{2})/GLOBCOMPLIR_[^/]+\.nc', key)
                    if not match:
                        continue
                    stamp = datetime(day.year, day.month, day.day, int(match[1]), tzinfo=UTC)
                    if stamp <= now and abs((stamp - expected).total_seconds()) <= 7200:
                        candidates.append((abs((stamp - expected).total_seconds()), stamp > expected, key))
            except (OSError, ValueError, ET.ParseError) as error:
                last = error
        for _, _, key in sorted(candidates):
            try:
                source_url = ORIGIN + key
                # A shared raw observation can serve several model snapshots without downloading again.
                raw = viewer/'data/earth3d-cache/cloud-source'/(hashlib.sha256(key.encode()).hexdigest()+'.nc')
                with _locks_guard:
                    source_lock = _source_locks.setdefault(str(raw), threading.Lock())
                with source_lock:
                    if raw.is_file():
                        payload = raw.read_bytes()
                    else:
                        payload = reader(source_url)
                        raw.parent.mkdir(parents=True, exist_ok=True)
                        temporary = raw.with_suffix('.tmp');temporary.write_bytes(payload);temporary.replace(raw)
                try:
                    with _decode_lock:  # The NetCDF C library is not reentrant across request threads.
                        png, observed, fraction = observation_rgba(payload, surface, expected, *OBSERVATION_SIZE)
                except (OSError, ValueError, KeyError, AttributeError, EarthDataError):
                    raw.unlink(missing_ok=True)  # A malformed provider response must be retryable.
                    raise
                directory.mkdir(parents=True, exist_ok=True)
                # A rebuilt source must not reuse its former derived texture.
                (directory / 'cloud-ra-v1.webp').unlink(missing_ok=True)
                temporary = directory / 'mask.tmp'; temporary.write_bytes(png); temporary.replace(directory / 'mask.png')
                result = {'schema': 1, 'snapshot': snapshot, 'source': 'NOAA GMGSI longwave infrared',
                    'source_url': source_url, 'observation_time': observed, 'model_valid_time': model['valid_time'],
                    'texture_url': f'/data/earth3d-cache/cloud-observation/{snapshot}/mask.png',
                    'width': OBSERVATION_SIZE[0], 'height': OBSERVATION_SIZE[1], 'valid_fraction': fraction,
                    'coverage': 'quality-screened satellite coverage; uncovered pixels are transparent',
                    'mask_method': 'calibrated mode-A IR / GFS 2 m air-temperature contrast proxy',
                    'calibration_reference': 'https://ospo.noaa.gov/operations/goes/calibration/Calibration-Document.pdf'}
                render_url = _render_mask(directory, snapshot)
                if render_url:
                    result['render_texture_url'] = render_url
                atomic_json(metadata, result)
                return result
            except (OSError, ValueError, KeyError, AttributeError, EarthDataError) as error:
                last = error
        raise EarthDataError('Matching cloud observation is unavailable') from last
