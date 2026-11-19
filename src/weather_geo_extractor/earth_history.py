"""Fill the rolling hourly GFS playback window without repointing the live map."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from .earth_data import UTC, find_latest, read_url, save_snapshot
from .earth_heights import height_profile
from .earth_retention import cached_hours, history_heights_ready, hourly_window, retention_lease


def backfill_history(viewer: Path, *, now=None, reader=read_url, stop=None, report=None, include_latest=True):
    """Reuse complete hours. Publish each successful hour independently; retry gaps later."""
    hours = hourly_window(now or datetime.now(UTC))
    if not include_latest:
        hours = hours[:-1]  # The normal live publisher owns the current hour.
    live = viewer / 'data/live'
    live.mkdir(parents=True, exist_ok=True)
    existing = {}
    with retention_lease(live.parent):
        for stamp, meta in cached_hours(live, hours[0], hours[-1]):
            previous = existing.get(stamp)
            if meta['schema'] == 2 and (previous is None or meta['id'] > previous['id']):
                existing[stamp] = meta
    def fill(hour):
        if stop and stop.is_set():
            return
        with retention_lease(live.parent):
            meta = existing.get(hour)
            if meta is None:
                # Analysis files at cycle boundaries omit the convective cloud
                # diagnostics used by the same playback frame. Use a forecast.
                source = find_latest(hour, reader=reader, min_lead=1)
                meta = save_snapshot(live, source, reader=reader)
            if not history_heights_ready(viewer, meta['id']):
                height_profile(viewer, meta['id'], '500hPa', reader=reader, preload=True)
        if report:
            report(hour, meta['id'])
    failures = {}
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix='gfs-hour') as pool:
        jobs = {pool.submit(fill, hour): hour for hour in reversed(hours)}
        for job in as_completed(jobs):
            try:
                job.result()
            except (OSError, ValueError, RuntimeError) as err:
                failures[jobs[job]] = str(err)
    return failures
