"""Rolling retention for Earth forecasts and their generated derivatives."""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
from urllib.parse import urlsplit

from .earth_data import HEIGHT_FIELDS, LAYER_KEYS, load_manifest
from .earth_heights import SNAPSHOT_PATTERN

WINDOW = timedelta(hours=24)
DIRECTORIES = (
    "live",
    "height",
    "pressure",
    "cloud-observation",
    "cloud-shape-v1",
    "playback-v1",
    "weather",
)
JSON_CACHES = ("cloud-cores", "convection", "cloud-volume")
LEVEL = "(?:" + "|".join(map(re.escape, LAYER_KEYS)) + ")"
UTC = timezone.utc


@contextmanager
def retention_lease(data: Path, *, exclusive=False):
    """A reader lease spans the request or publication, including its filesystem writes."""
    data.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(
        data / ".retention.sqlite", timeout=0 if exclusive else 60
    )
    try:
        try:
            connection.execute("BEGIN EXCLUSIVE" if exclusive else "BEGIN")
            connection.execute("SELECT count(*) FROM sqlite_master").fetchone()
        except sqlite3.OperationalError as error:
            if not exclusive or "locked" not in str(error).lower():
                raise
            yield False
        else:
            yield True
    finally:
        connection.close()


def _valid_time(snapshot):
    if not re.fullmatch(SNAPSHOT_PATTERN, snapshot):
        return None
    run, hour, *_ = snapshot.split("-")
    try:
        return datetime.strptime(run, "%Y%m%dT%HZ").replace(tzinfo=UTC) + timedelta(
            hours=int(hour[1:])
        )
    except ValueError:
        return None


def hourly_window(now):
    if now.tzinfo is None:
        raise ValueError("A timezone-aware clock is required")
    end = now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    return [end - timedelta(hours=offset) for offset in range(23, -1, -1)]


def history_heights_ready(viewer, snapshot):
    directory = viewer / "data/earth3d-cache/height" / snapshot
    return all((directory / (name + ".json")).is_file() for name in HEIGHT_FIELDS)


def cached_hours(live, start, end):
    """Yield validated immutable generations in an inclusive UTC interval."""
    for directory in live.iterdir():
        stamp = _valid_time(directory.name)
        if stamp is None or not start <= stamp <= end or not directory.is_dir():
            continue
        item = load_manifest(live, snapshot=directory.name)
        if not item:
            continue
        try:
            run = datetime.fromisoformat(item["run_time"].replace("Z", "+00:00"))
            valid = datetime.fromisoformat(item["valid_time"].replace("Z", "+00:00"))
            if valid != stamp or run + timedelta(hours=item["forecast_hour"]) != stamp:
                continue
        except (KeyError, ValueError, TypeError, AttributeError, OverflowError):
            continue
        yield stamp, item


def forecast_timeline(live: Path, current: dict | None, *, now=None) -> list[dict]:
    """One complete snapshot per valid hour, ordered oldest first."""
    if not current:
        return []
    latest = _valid_time(current["id"])
    if latest is None:
        return []
    hours = hourly_window(now or datetime.now(UTC))
    frames = {latest: current}  # Preserve an older live fallback during a provider outage.
    for stamp, item in cached_hours(live, hours[0], min(latest, hours[-1])):
        if stamp == latest or (item.get("schema") == 2 and not history_heights_ready(live.parent.parent, item["id"])):
            continue
        previous = frames.get(stamp)
        if previous is None or (item["schema"], item["id"]) > (previous["schema"], previous["id"]):
            frames[stamp] = item
    fields = ("id", "valid_time", "run_time", "forecast_hour", "resolution", "nx", "ny", "layers", "files")
    return [{key: item[key] for key in fields if key in item} for _, item in sorted(frames.items())]


def _known(kind, rel, directory):
    if rel.name == ".DS_Store" and not directory:
        return True
    name = rel.as_posix()
    if kind == "live":
        return (
            name in LAYER_KEYS[1:]
            if directory
            else bool(
                re.fullmatch(rf"(?:{LEVEL}/)?(?:wind|temp)\.json|metadata\.json", name)
            )
        )
    if kind == "weather":
        return bool(
            re.fullmatch(
                rf"{LEVEL}(/(temp|wind)(/\d+)?)?"
                if directory
                else rf"{LEVEL}/(temp|wind)/\d+/\d+-\d+\.png",
                name,
            )
        )
    if directory:
        return False
    files = {
        "height": {key + ".json" for key in HEIGHT_FIELDS},
        "pressure": {"mean-sea-level.json"},
        "playback-v1": {name + ".gz" for name in (*LAYER_KEYS, "observation", "volume", "pressure")},
        "cloud-observation": {"metadata.json", "mask.png", "cloud-ra-v1.webp"},
        "cloud-shape-v1": {"metadata.json", "field.bin", "field.bin.gz"},
    }
    return name in files[kind]


def _directory_bytes(path, kind):
    """Refuse the whole directory if it contains an unexpected file, link or subdirectory."""
    total = 0
    for entry in path.rglob("*"):
        if entry.is_symlink() or not _known(
            kind, entry.relative_to(path), entry.is_dir()
        ):
            return None
        if entry.is_file():
            total += entry.stat().st_size
        elif not entry.is_dir():
            return None
    return total


def prune_history(viewer: Path, *, apply=False, now=None):
    data = viewer / "data"
    live, derived = data / "live", data / "earth3d-cache"
    cutoff = (now or datetime.now(UTC)) - WINDOW
    report = {
        "cutoff": cutoff.isoformat(),
        "applied": apply,
        "paths": [],
        "bytes": 0,
        "skipped": [],
    }
    if (
        data.is_symlink()
        or live.is_symlink()
        or derived.is_symlink()
        or not live.is_dir()
    ):
        return {**report, "deferred": "unavailable cache root"}
    with retention_lease(data, exclusive=True) as acquired:
        if not acquired:
            return {**report, "deferred": "active request or publication"}
        manifest = load_manifest(live)
        if manifest is None:
            return {**report, "deferred": "no validated active manifest"}
        active = manifest["id"]
        report["active"] = active

        def remove(path, size):
            if apply:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            report["paths"].append(str(path.relative_to(data)))
            report["bytes"] += size

        # Raw NetCDFs may be shared by multiple runs, including the protected fallback.
        protected_raw = set()
        expired_raw = set()
        protected_ids = {active}
        raw_safe = True
        for kind in (*DIRECTORIES, *JSON_CACHES):
            root = live if kind == "live" else derived / kind
            if not root.is_dir() or root.is_symlink():
                if kind == "cloud-observation" and root.is_symlink():
                    raw_safe = False
                continue
            for path in sorted(root.iterdir()):
                key = (
                    path.stem
                    if kind in JSON_CACHES and path.suffix == ".json"
                    else path.name
                )
                stamp = _valid_time(key)
                if stamp is None:
                    continue
                if key in protected_ids or stamp >= cutoff:
                    if kind == "cloud-observation":
                        try:
                            meta = json.loads((path / "metadata.json").read_text())
                            source = urlsplit(meta["source_url"]).path.lstrip("/")
                            protected_raw.add(
                                hashlib.sha256(source.encode()).hexdigest() + ".nc"
                            )
                        except (OSError, KeyError, ValueError):
                            raw_safe = False
                    continue
                size = None
                if not path.is_symlink():
                    if (
                        kind in JSON_CACHES
                        and path.name == key + ".json"
                        and path.is_file()
                    ):
                        size = path.stat().st_size
                    elif kind in DIRECTORIES and path.is_dir():
                        if kind == "live":
                            try:
                                meta = json.loads((path / "metadata.json").read_text())
                                valid = datetime.fromisoformat(
                                    meta["valid_time"].replace("Z", "+00:00")
                                )
                                if meta["id"] != key or valid != stamp:
                                    raise ValueError("mismatched generation")
                            except (OSError, KeyError, ValueError):
                                protected_ids.add(key)
                                report["skipped"].append(str(path.relative_to(data)))
                                continue
                        size = _directory_bytes(path, kind)
                if size is None:
                    if kind == "live":
                        protected_ids.add(key)
                    report["skipped"].append(str(path.relative_to(data)))
                else:
                    if (
                        kind == "cloud-observation"
                        and (path / "metadata.json").is_file()
                    ):
                        try:
                            source = urlsplit(
                                json.loads((path / "metadata.json").read_text())[
                                    "source_url"
                                ]
                            ).path.lstrip("/")
                            expired_raw.add(
                                hashlib.sha256(source.encode()).hexdigest() + ".nc"
                            )
                        except (ValueError, KeyError, TypeError):
                            pass
                    remove(path, size)
        raw_root = derived / "cloud-source"
        if raw_safe and raw_root.is_dir() and not raw_root.is_symlink():
            for path in sorted(raw_root.glob("*.nc")):
                if (
                    not re.fullmatch(r"[0-9a-f]{64}\.nc", path.name)
                    or path.is_symlink()
                    or not path.is_file()
                ):
                    continue
                stat = path.stat()
                if (
                    path.name not in protected_raw
                    and stat.st_mtime < cutoff.timestamp()
                ):
                    if path.name not in expired_raw:
                        # A hash-like filename alone does not establish ownership.
                        try:
                            import netCDF4

                            with netCDF4.Dataset(path) as nc:
                                if (
                                    nc.summary != "longwave infrared"
                                    or not {"data", "dqf", "lat", "lon"}
                                    <= nc.variables.keys()
                                ):
                                    continue
                        except (ImportError, OSError, AttributeError):
                            report["skipped"].append(str(path.relative_to(data)))
                            continue
                    remove(path, stat.st_size)
    return report
