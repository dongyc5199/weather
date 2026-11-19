import hashlib
import json
from datetime import datetime, timezone

from weather_geo_extractor.earth_retention import prune_history, retention_lease

NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)


def generation(viewer, stamp, *, current=False):
    key = stamp.strftime("%Y%m%dT%HZ-f000-1p0")
    root = viewer / "data/live" / key
    root.mkdir(parents=True)
    meta = {
        "schema": 1,
        "id": key,
        "valid_time": stamp.isoformat(),
        "sizes": {},
        "files": {},
    }
    for kind in ("temp", "wind"):
        (root / (kind + ".json")).write_text("[]")
        meta["files"][kind] = f"data/live/{key}/{kind}.json"
        meta["sizes"][kind] = 2
    (root / "metadata.json").write_text(json.dumps(meta))
    if current:
        (root.parent / "manifest.json").write_text(json.dumps(meta))
    return key


def test_cutoff_current_fallback_unknown_files_and_busy_requests(tmp_path):
    from datetime import timedelta

    current = generation(tmp_path, NOW - timedelta(days=3), current=True)
    boundary = generation(tmp_path, NOW - timedelta(hours=24))
    expired = generation(tmp_path, NOW - timedelta(hours=25))
    mixed = generation(tmp_path, NOW - timedelta(hours=27))
    data = tmp_path / "data"
    (data / "live" / mixed / "my-notes.txt").touch()
    cache = data / "earth3d-cache/height" / expired
    cache.mkdir(parents=True)
    (cache / "orography.json").write_text("{}")
    with retention_lease(data):
        assert "deferred" in prune_history(tmp_path, apply=True, now=NOW)
    plan = prune_history(tmp_path, now=NOW)
    assert set(plan["paths"]) == {"live/" + expired, "earth3d-cache/height/" + expired}
    assert cache.is_dir()
    assert prune_history(tmp_path, apply=True, now=NOW)["bytes"] == plan["bytes"]
    assert not cache.exists() and not (data / "live" / expired).exists()
    for key in (current, boundary, mixed):
        assert (data / "live" / key).exists()
    assert not prune_history(tmp_path, apply=True, now=NOW)["paths"]


def test_no_valid_manifest_and_links_are_preserved(tmp_path):
    from datetime import timedelta

    expired = generation(tmp_path, NOW - timedelta(days=4))
    outside = tmp_path / "user-file"
    outside.write_text("keep")
    root = tmp_path / "data/live" / expired
    (root / "500hPa").symlink_to(outside)
    assert "deferred" in prune_history(tmp_path, apply=True, now=NOW)
    generation(tmp_path, NOW, current=True)
    assert "live/" + expired in prune_history(tmp_path, apply=True, now=NOW)["skipped"]
    assert outside.read_text() == "keep" and (root / "500hPa").is_symlink()


def test_active_dependencies_and_unrelated_cache_namespaces(tmp_path):
    import os
    from datetime import timedelta

    active = generation(tmp_path, NOW, current=True)
    root = tmp_path / "data/earth3d-cache"
    obs = root / "cloud-observation" / active
    obs.mkdir(parents=True)
    (obs / "metadata.json").write_text(
        '{"source_url":"https://example.test/shared.nc"}'
    )
    raw = root / "cloud-source"
    raw.mkdir()
    protected = raw / (hashlib.sha256(b"shared.nc").hexdigest() + ".nc")
    expired = generation(tmp_path, NOW - timedelta(days=4))
    old_obs = root / "cloud-observation" / expired
    old_obs.mkdir()
    (old_obs / "cloud-ra-v1.webp").write_bytes(b"derived mask")
    (old_obs / "metadata.json").write_text(
        '{"source_url":"https://example.test/expired.nc"}'
    )
    orphan = raw / (hashlib.sha256(b"expired.nc").hexdigest() + ".nc")
    for p in (protected, orphan):
        p.touch()
        os.utime(p, (1, 1))
    terrain = root / "terrain-tiles" / active
    terrain.mkdir(parents=True)
    prune_history(tmp_path, apply=True, now=NOW)
    assert protected.exists() and not orphan.exists() and terrain.exists()
    assert not old_obs.exists()


def test_playback_catalog_orders_complete_times_and_prefers_newer_run(tmp_path):
    from datetime import timedelta
    from weather_geo_extractor.earth_data import load_manifest
    from weather_geo_extractor.earth_retention import forecast_timeline

    live = tmp_path / "data/live"
    def frame(run, lead=0, active=False):
        valid = run + timedelta(hours=lead)
        key = generation(tmp_path, run, current=active)
        src = live / key
        meta = json.loads((src / "metadata.json").read_text())
        new_key = key.replace("f000", f"f{lead:03d}")
        if new_key != key:
            src.rename(live / new_key)
            meta["files"] = {k: v.replace(key, new_key) for k, v in meta["files"].items()}
        meta.update(id=new_key, run_time=run.isoformat(), valid_time=valid.isoformat(), forecast_hour=lead)
        (live / new_key / "metadata.json").write_text(json.dumps(meta))
        if active:
            (live / "manifest.json").write_text(json.dumps(meta))
        return new_key

    frame(NOW - timedelta(hours=25))
    frame(NOW - timedelta(hours=24))
    edge = frame(NOW - timedelta(hours=23))
    frame(NOW - timedelta(hours=9), 6)
    newer = frame(NOW - timedelta(hours=4), 1)
    broken = frame(NOW - timedelta(hours=2))
    (live / broken / "wind.json").unlink()
    current = frame(NOW, active=True)
    history = forecast_timeline(live, load_manifest(live), now=NOW)
    assert [entry["id"] for entry in history] == [edge, newer, current]
    assert [entry["id"] for entry in forecast_timeline(live, load_manifest(live), now=NOW+timedelta(days=2))] == [current]
    assert load_manifest(live, snapshot="../manifest.json") is None
