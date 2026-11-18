"""Fit a local heavy-rain calibration from dated model/observation matchups."""

import csv
from datetime import date, datetime, time
import json
from pathlib import Path

from . import rain_probability as rain
from .precipitation import precipitation_ensemble_adapter


def verify_history(spec_path, holdout_start, *, apply_bias_correction=False):
    spec_path = Path(spec_path)
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    lon, lat = map(float, spec["location"])
    if not (-180 <= lon <= 360 and -90 <= lat <= 90):
        raise ValueError("invalid verification site")
    observation = spec["observation"]
    definitions = spec["members"]
    if not observation.get("dataset") or not observation.get("source_url"):
        raise ValueError("verification requires an identified observation source")
    if observation["dataset"] in {member["dataset"] for member in definitions}:
        raise ValueError(
            "the verification observation must be separate from the members"
        )
    if not all(d.get("unit") for d in [*definitions, observation]):
        raise ValueError("historical verification requires explicit units")
    split = datetime.combine(date.fromisoformat(holdout_start), time.min, rain.UTC)
    rows, missing, seen = [], 0, set()
    contract = None

    def record(definition, row):
        text = row[definition["value_column"]].strip()
        return {
            **({"forecast_offset_hours": definition["forecast_offset_hours"]}
               if "forecast_offset_hours" in definition else {}),
            "dataset": definition["dataset"],
            "time": row[definition["date_column"]],
            "unit": definition["unit"],
            "lons": [lon],
            "lats": [lat],
            "values": [[None if text in {"", "NA", "NaN"} else float(text)]],
        }

    with (spec_path.parent / spec["csv"]).open(encoding="utf-8", newline="") as data:
        for row in csv.DictReader(data):
            members = [record(d, row) for d in definitions]
            truth = record(observation, row)
            window = rain.daily_window(truth)
            if not window or any(
                rain.daily_window(member) != window for member in members
            ):
                raise ValueError(
                    "historical observation and members cover different intervals"
                )
            if window[0] in seen:
                raise ValueError("duplicate verification day")
            seen.add(window[0])
            observed = rain.millimetres(truth["values"][0][0], rain.daily_scale(truth))
            if observed is None or any(
                member["values"][0][0] is None for member in members
            ):
                missing += 1
                continue
            # Use the operational conversion, interpolation, weights and threshold.
            result = precipitation_ensemble_adapter(
                members, apply_bias_correction=apply_bias_correction
            )
            feature = result["features"][0]["properties"]
            rows.append(
                (
                    window[0],
                    feature["member_exceedance_fraction"],
                    int(observed >= rain.THRESHOLD_MM),
                )
            )
            contract = {
                "members": result["metadata"]["member_contract"],
                "location": [lon, lat],
                "utc_start": window[0].time().isoformat(),
            }
    if contract is None:
        raise ValueError("no matched days")
    model = rain.fit_and_verify(rows, split, contract)
    model.update(
        {
            "missing_days_in_input": missing,
            "observation": observation,
            "member_sources": definitions,
            "bias_correction": apply_bias_correction,
        }
    )
    return model
