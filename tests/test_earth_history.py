from datetime import datetime, timedelta, timezone
from threading import Event
import pytest

from weather_geo_extractor import earth_history as history
from weather_geo_extractor import earth_server
from weather_geo_extractor.earth_data import iso_time
from weather_geo_extractor.earth_retention import hourly_window

UTC = timezone.utc
NOW = datetime(2026, 11, 19, 0, 35, tzinfo=UTC)


def test_hourly_window_rolls_at_the_next_utc_hour():
    hours = hourly_window(NOW.astimezone(timezone(timedelta(hours=8))))
    assert len(hours) == len(set(hours)) == 24
    assert hours[0] == datetime(2026, 11, 18, 1, tzinfo=UTC)
    assert hours[-1] == NOW.replace(minute=0)
    assert all(y - x == timedelta(hours=1) for x,y in zip(hours,hours[1:]))
    assert hourly_window(NOW+timedelta(hours=1))[:-1] == hours[1:]
    with pytest.raises(ValueError):
        hourly_window(NOW.replace(tzinfo=None))


def test_backfill_preserves_cached_hours_and_retries_only_incomplete_ones(tmp_path, monkeypatch):
    hours=hourly_window(NOW)
    cache={h:{'id':iso_time(h),'schema':2} for h in hours if h not in hours[2:4]}
    ready={m['id'] for m in cache.values()}-{iso_time(hours[1])}
    fetched=[];prepared=[];fail=[hours[2]]
    monkeypatch.setattr(history,'cached_hours',lambda live,start,end: list(cache.items()))
    monkeypatch.setattr(history,'history_heights_ready',lambda viewer,id:id in ready)
    def fetch(h,reader,min_lead):
        assert min_lead==1
        fetched.append(h)
        if h in fail: raise OSError('temporarily unavailable')
        return h
    def save(live,h,reader):
        cache[h]={'id':iso_time(h),'schema':2}
        return cache[h]
    def heights(viewer,id,layer,reader,preload):
        assert preload and layer=='500hPa'
        prepared.append(id);ready.add(id)
    monkeypatch.setattr(history,'find_latest',fetch)
    monkeypatch.setattr(history,'save_snapshot',save)
    monkeypatch.setattr(history,'height_profile',heights)
    assert history.backfill_history(tmp_path,now=NOW,include_latest=False)=={hours[2]:'temporarily unavailable'}
    assert set(fetched)==set(hours[2:4]) and set(prepared)=={iso_time(hours[1]),iso_time(hours[3])}
    fail.clear();fetched.clear();prepared.clear()
    assert not history.backfill_history(tmp_path,now=NOW,include_latest=False)
    assert fetched==[hours[2]] and prepared==[iso_time(hours[2])]


def test_polling_status_starts_one_history_job(tmp_path,monkeypatch):
    u=earth_server.Updates(tmp_path/'data/live',0)
    started,release=Event(),Event()
    def fill(*args,**kw):
        assert not kw['include_latest']
        started.set();release.wait(3);return {}
    monkeypatch.setattr(earth_server,'backfill_history',fill)
    hours=hourly_window(NOW)
    frames=[{'valid_time':iso_time(h),'layers':{'500hPa':{}}} for h in hours]
    assert u.hourly_playback(frames,frames[-1],NOW)=={'ready':24,'total':24,'loading':False,'error':None}
    try:
        status=u.hourly_playback(frames[1:],frames[-1],NOW)
        assert status['ready']==23 and status['loading'] and started.wait(1)
        assert u.hourly_playback(frames[1:],frames[-1],NOW)==status
    finally:
        release.set()


def test_missing_live_hour_is_refreshed_without_duplicate_refresh_or_history_download(tmp_path, monkeypatch):
    updates = earth_server.Updates(tmp_path/'data/live', refresh_seconds=0)
    frames = [{'valid_time': iso_time(h), 'layers': {'500hPa': {}}} for h in hourly_window(NOW)[:-1]]
    calls = []
    monkeypatch.setattr(updates, 'refresh', lambda: calls.append('latest'))
    monkeypatch.setattr(updates, '_fill_history', lambda _: pytest.fail('all historical hours already exist'))
    assert updates.hourly_playback(frames, frames[-1], NOW)['loading']
    updates.hourly_playback(frames, frames[-1], NOW)
    assert calls == ['latest']
