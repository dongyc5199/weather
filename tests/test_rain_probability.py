import json
from pathlib import Path
import pytest

from weather_geo_extractor.precipitation import (
    precipitation_ensemble_adapter as ensemble,
)
from weather_geo_extractor.rain_probability import daily_window
from weather_geo_extractor.rain_verification import verify_history

SITE = Path(__file__).parents[1] / "examples/rain-verification"
DAY = "2024-06-01"


def member(name, value=25, unit="mm/day", **fields):
    return {
        "dataset": name,
        "time": DAY,
        "unit": unit,
        "lons": [90],
        "lats": [19.9997],
        "values": [[value]],
        **fields,
    }


def props(sources, **options):
    return ensemble(sources, apply_bias_correction=False, **options)["features"][0][
        "properties"
    ]


def test_daily_mean_flux_and_accumulation_align_at_the_threshold():
    inputs = [member("a", 0.025, "m"), member("b", 25 / 86400, "kg m^-2 s^-1")]
    assert props(inputs)["ensemble_mean"] == 25
    assert props(inputs)["member_exceedance_fraction"] == 1
    assert daily_window(inputs[0]) == daily_window(
        {"valid_time": "2024-06-02T08:00:00+08:00", "duration_hours": 24}
    )
    with pytest.raises(ValueError, match="same 24 hours"):
        props([inputs[0], member("b", time="2024-06-02")])
    with pytest.raises(ValueError, match="24-hour"):
        props([inputs[0], member("b", duration_hours=6)])
    with pytest.raises(ValueError, match="unit"):
        props([inputs[0], member("b", unit="inches/year")])
    with pytest.raises(ValueError, match="statistic"):
        props([inputs[0], member("b", statistic="instantaneous")])
    with pytest.raises(ValueError):
        daily_window({"time": "2024-06-02T00:00:00", "duration_hours": 24})


def test_reference_cannot_leak_into_event_probability():
    m = [member("ncep_r1", 5), member("ncep_r2", 4)]
    result = ensemble(m, reference=member("gauge", 60))
    f = result["features"][0]["properties"]
    assert f["ensemble_mean"] == 60 and f["member_exceedance_fraction"] == 0
    with pytest.raises(ValueError, match="same 24 hours"):
        ensemble(m, reference=member("gauge", 60, time="2024-06-02"))


def test_history_reproduces_holdout_and_gates_application_by_date_site_and_roster():
    profile = verify_history(SITE / "site.json", "2022-01-01")
    assert profile == json.loads((SITE / "calibration.json").read_text())
    assert profile["train_days"] == 731 and profile["holdout_days"] == 365
    assert profile["holdout_events"] == 31 and profile["accepted"]
    inputs = [member("ncep_r1", 30), member("ncep_r2", 30)]
    f = props(inputs, calibration=profile)
    assert 0 < f["prob_heavy_rain"] < 1 and f["probability_status"] == "calibrated"
    for source in inputs:
        source["time"] = "2022-06-01"
    assert "prob_heavy_rain" not in props(inputs, calibration=profile)
    for source in inputs:
        source.update(time=DAY, lons=[100])
    assert (
        props(inputs, calibration=profile)["probability_status"]
        == "outside_calibration_domain"
    )
    inputs[1]["values"] = [[None]]
    assert (
        props(inputs, calibration=profile)["probability_status"] == "incomplete_members"
    )


def test_no_extrapolation_beyond_member_coverage():
    inputs = [member("a", 40), member("b", 0, lons=[120])]
    f = props(inputs)
    assert f["source_count"] == 1 and f["ensemble_mean"] == 40
    assert "prob_heavy_rain" not in f
    with pytest.raises(ValueError, match="distinct"):
        props([inputs[0], inputs[0]])


def test_actual_forecast_profile_is_bound_to_member_lead():
    model = verify_history(SITE / "forecast-site.json", "2025-01-01")
    assert model == json.loads((SITE / "forecast-calibration.json").read_text())
    assert model["accepted"] and model["missing_days_in_input"] == 20
    sources = [member(name, time="2026-01-01", lons=[90.125], lats=[20.125], forecast_offset_hours=48)
               for name in ("gfs_global", "icon_global")]
    assert props(sources, calibration=model)["probability_status"] == "calibrated"
    sources[0]["forecast_offset_hours"] = 24
    assert props(sources, calibration=model)["probability_status"] == "outside_calibration_domain"
