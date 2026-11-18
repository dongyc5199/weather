"""UTC daily precipitation contracts and chronological probability calibration."""

from bisect import bisect_left
from datetime import date, datetime, time, timedelta, timezone
import math

UTC = timezone.utc
DAY = timedelta(days=1)
THRESHOLD_MM = 25.0


def instant(value):
    stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("precipitation timestamps require a UTC offset")
    return stamp.astimezone(UTC)


def daily_window(source):
    start, end = source.get("period_start"), source.get("period_end")
    label = source.get("valid_time") or source.get("time")
    hours = source.get("duration_hours")
    if hours is not None and float(hours) != 24:
        raise ValueError("heavy rain requires a complete 24-hour interval")
    if start is not None or end is not None:
        if start is None or end is None:
            raise ValueError("supply both period_start and period_end")
        start, end = instant(start), instant(end)
    elif label is None or label == "":
        return None
    elif len(str(label)) == 10:
        start = datetime.combine(date.fromisoformat(label), time.min, UTC)
        end = start + DAY
    elif hours is not None:
        end = instant(label)
        start = end - DAY
    else:
        raise ValueError(
            "a timestamp requires explicit daily bounds or duration_hours=24"
        )
    if end - start != DAY:
        raise ValueError("precipitation intervals must span exactly 24 hours")
    for key in ("time", "valid_time"):
        value = source.get(key)
        if value:
            matches = (
                start == datetime.combine(date.fromisoformat(value), time.min, UTC)
                if len(str(value)) == 10
                else instant(value) == end
            )
            if not matches:
                raise ValueError(
                    "precipitation time disagrees with its accumulation window"
                )
    return start, end


def daily_scale(source):
    unit = str(source.get("unit") or source.get("units") or "mm/day").lower().strip()
    unit = unit.replace(" ", "").replace("^", "").replace("**", "").replace("−", "-")
    factors = {
        "mm/day": 1,
        "mmd-1": 1,
        "mm/d": 1,
        "mmday-1": 1,
        "mm": 1,
        "kg/m2": 1,
        "kgm-2": 1,
        "m": 1000,
        "m/day": 1000,
        "mm/h": 24,
        "mm/hr": 24,
        "mmh-1": 24,
        "mm/s": 86400,
        "kg/m2/s": 86400,
        "kgm-2s-1": 86400,
        "m/s": 86400000,
    }
    if unit not in factors:
        raise ValueError(f"unsupported precipitation unit {unit!r}")
    statistic = source.get("statistic")
    amount = unit in {"mm", "m", "kg/m2", "kgm-2"}
    if statistic is not None and str(statistic).lower() not in (
        {"sum", "accumulation", "total"} if amount else {"mean", "average"}
    ):
        raise ValueError("precipitation statistic must match daily total or mean rate")
    return factors[unit]


def millimetres(value, scale):
    if value is None:
        return None
    amount = float(value) * scale
    if amount < 0 or not math.isfinite(amount):
        raise ValueError(
            "supply finite nonnegative precipitation or null for missing data"
        )
    return amount


def _fit_curve(rows, climate):
    # Pool adjacent out-of-order event frequencies. Ten prior days per distinct
    # score shrink rare groups towards training climatology.
    groups = {}
    for _, score, event in rows:
        count, hits = groups.get(score, (0, 0))
        groups[score] = count + 1, hits + event
    blocks = []
    for score, (count, hits) in sorted(groups.items()):
        blocks.append(([score], count + 10, hits + 10 * climate))
        while len(blocks) >= 2:
            keys, n, k = blocks[-2]
            keys2, m, j = blocks[-1]
            if k / n <= j / m:
                break
            blocks[-2:] = [(keys + keys2, n + m, k + j)]
    return [[score, hits / count] for keys, count, hits in blocks for score in keys]


def calibrated_value(curve, score):
    i = bisect_left([x for x, _ in curve], score)
    if i == 0:
        return curve[0][1]
    if i == len(curve):
        return curve[-1][1]
    x, y = curve[i - 1]
    x2, y2 = curve[i]
    return y + (score - x) * (y2 - y) / (x2 - x)


def fit_and_verify(rows, split, contract):
    """One matched site and one complete member roster, one independent truth per day."""
    ordered = sorted(rows)
    if any(b[0] - a[0] < DAY for a, b in zip(ordered, ordered[1:])):
        raise ValueError("overlapping or duplicate verification intervals")
    train = [row for row in ordered if row[0] + DAY <= split]
    test = [row for row in ordered if row[0] >= split]
    for part in (train, test):
        hits = sum(event for _, _, event in part)
        if len(part) < 90 or min(hits, len(part) - hits) < 5:
            raise ValueError(
                "each period requires 90 matched days, five events and five non-events"
            )
    climate = sum(row[2] for row in train) / len(train)
    curve = _fit_curve(train, climate)
    scores = {"raw": 0.0, "calibrated": 0.0, "climatology": 0.0}
    bins = [{"count": 0, "events": 0, "sum_probability": 0.0} for _ in range(10)]
    for _, raw, event in test:
        probability = calibrated_value(curve, raw)
        for name, value in (
            ("raw", raw),
            ("calibrated", probability),
            ("climatology", climate),
        ):
            scores[name] += (value - event) ** 2
        bucket = bins[min(9, int(probability * 10))]
        bucket["count"] += 1
        bucket["events"] += event
        bucket["sum_probability"] += probability
    brier = {name: total / len(test) for name, total in scores.items()}
    return {
        "schema": 1,
        "contract": contract,
        "threshold_mm_24h": THRESHOLD_MM,
        "train_days": len(train),
        "train_events": sum(row[2] for row in train),
        "holdout_days": len(test),
        "holdout_events": sum(row[2] for row in test),
        "train_start": train[0][0].isoformat(),
        "train_end": (train[-1][0] + DAY).isoformat(),
        "holdout_start": test[0][0].isoformat(),
        "holdout_end": (test[-1][0] + DAY).isoformat(),
        "training_climatology": climate,
        "curve": curve,
        "brier": brier,
        "skill_vs_climatology": 1 - brier["calibrated"] / brier["climatology"],
        "accepted": brier["calibrated"] < min(brier["raw"], brier["climatology"]),
        "reliability": [
            {
                "bin": i,
                "count": b["count"],
                "events": b["events"],
                "mean_probability": b["sum_probability"] / b["count"]
                if b["count"]
                else None,
                "observed_frequency": b["events"] / b["count"] if b["count"] else None,
            }
            for i, b in enumerate(bins)
        ],
    }


def validate_model(model):
    if (
        model.get("schema") != 1
        or model.get("threshold_mm_24h") != THRESHOLD_MM
        or not isinstance(model.get("accepted"), bool)
        or not isinstance(model.get("contract"), dict)
    ):
        raise ValueError("invalid precipitation calibration profile")
    curve = model.get("curve")
    if not curve or any(
        len(row) != 2 or not all(math.isfinite(v) and 0 <= v <= 1 for v in row)
        for row in curve
    ):
        raise ValueError("invalid calibration curve")
    if any(x >= z or y > w for (x, y), (z, w) in zip(curve, curve[1:])):
        raise ValueError("calibration curve must be ordered")
    start, train_end, holdout_start, end = (
        instant(model[k])
        for k in ("train_start", "train_end", "holdout_start", "holdout_end")
    )
    if not start < train_end <= holdout_start < end:
        raise ValueError("overlapping calibration or holdout periods")
    scores = model.get("brier", {})
    if any(
        not isinstance(scores.get(k), (int, float)) or not 0 <= scores[k] <= 1
        for k in ("raw", "calibrated", "climatology")
    ):
        raise ValueError("invalid holdout scores")
    if model["accepted"] and not scores["calibrated"] < min(
        scores["raw"], scores["climatology"]
    ):
        raise ValueError("calibration does not pass its holdout skill gate")
    for prefix in ("train", "holdout"):
        n, hits = model.get(prefix + "_days", 0), model.get(prefix + "_events", 0)
        if n < 90 or min(hits, n - hits) < 5:
            raise ValueError("insufficient calibration or holdout coverage")
    return end
