from datetime import datetime, timedelta, timezone
from pathlib import Path
import json

import numpy as np
import pytest

from weather_geo_extractor import earth_data as data

RUN = datetime(2026, 11, 7, 6, tzinfo=timezone.utc)
NOW = RUN + timedelta(hours=5, minutes=30)


def index_for(run=RUN):
    stamp = run.strftime("%Y%m%d%H")
    rows = [f"1:0:d={stamp}:TMP:surface:5 hour fcst:"]
    for i, key in enumerate(index_keys(), 1):
        spec = data.FIELDS[key]
        rows.append(f"{i+1}:{i*100}:d={stamp}:{spec.variable}:{spec.index_level}:5 hour fcst:")
    rows.append(f"26:2500:d={stamp}:UGRD:100 m above ground:5 hour fcst:")
    return "\n".join(rows) + "\n"


def index_keys():
    return ["temp", "u", "v", *(key for key in data.FIELDS if key not in {"temp", "u", "v"})]


def test_index_selects_exact_height_and_message_boundaries():
    ranges = data.parse_index(index_for(), RUN)
    assert len(ranges) == 24
    assert {key: ranges[key] for key in ("temp", "u", "v")} == {"temp": (100, 199), "u": (200, 299), "v": (300, 399)}
    assert ranges["1000hPa-u"] == (400, 499)
    assert ranges["10hPa-temp"] == (2400, 2499)


@pytest.mark.parametrize("index", [
    index_for().replace("VGRD:10 m", "VGRD:100 m"),
    index_for().replace("3:200", "3:100"),
    index_for().replace("TMP:70 mb", "TMP:75 mb"),
    index_for().replace("TMP:1000 mb", "TMP:100 mb"),
    index_for(RUN - timedelta(hours=6)),
])
def test_index_rejects_missing_misordered_or_wrong_run(index):
    with pytest.raises(data.EarthDataError):
        data.parse_index(index, RUN)


def test_latest_uses_previous_published_run_but_keeps_current_valid_hour():
    older = RUN - timedelta(hours=6)
    attempted = []

    def reader(url):
        attempted.append(url)
        if "/06/" in url:
            raise OSError("not yet published")
        return index_for(older).encode()

    result = data.find_latest(NOW, reader=reader)
    assert result.run == older
    assert result.valid == NOW.replace(minute=0)
    assert result.forecast_hour == 11
    assert result.url.endswith("gfs.t00z.pgrb2.0p25.f011")
    assert len(attempted) == 3


def test_cycle_fallback_crosses_utc_date_boundary():
    now = datetime(2026, 11, 7, 1, 20, tzinfo=timezone.utc)
    older = datetime(2026, 11, 6, 18, tzinfo=timezone.utc)

    def reader(url):
        if "20261107" in url:
            raise OSError("not published")
        return index_for(older).encode()

    result = data.find_latest(now, reader=reader)
    assert result.run == older
    assert result.forecast_hour == 7
    assert result.valid == now.replace(minute=0)


def message(field, missing_index=None, **overrides):
    ec = pytest.importorskip("eccodes")
    handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
    spec = data.FIELDS[field]
    is_pressure = spec.level_type == "isobaricInhPa"
    settings = {
        "Ni": 8, "Nj": 5,
        "latitudeOfFirstGridPointInDegrees": 90, "latitudeOfLastGridPointInDegrees": -90,
        "longitudeOfFirstGridPointInDegrees": 0, "longitudeOfLastGridPointInDegrees": 315,
        "iDirectionIncrementInDegrees": 45, "jDirectionIncrementInDegrees": 45,
        "discipline": 0, "parameterCategory": spec.category, "parameterNumber": spec.number,
        "typeOfFirstFixedSurface": 100 if is_pressure else 103,
        "scaledValueOfFirstFixedSurface": spec.level * 100 if is_pressure else spec.level,
        "dataDate": 20261107, "dataTime": 600, "forecastTime": 5,
    }
    settings.update(overrides)
    try:
        for key, value in settings.items():
            ec.codes_set(handle, key, value)
        values = np.arange(40, dtype=float) + (273.15 if spec.variable == "TMP" else -20)
        if is_pressure:
            values += -(1000 - spec.level) / 25 if spec.variable == "TMP" else spec.level / 100
        if missing_index is not None:
            ec.codes_set(handle, "bitmapPresent", 1)
            values[missing_index] = ec.codes_get(handle, "missingValue")
        ec.codes_set_values(handle, values)
        return ec.codes_get_message(handle)
    finally:
        ec.codes_release(handle)


def selection():
    return data.Selection(RUN, RUN + timedelta(hours=5), 5, "https://example.test/gfs", {})


def test_real_grib_decoder_preserves_uv_kelvin_orientation_and_time():
    records = {name: data.decode_field(message(name), name, selection(), 90) for name in data.FIELDS}
    data.validate_fields(records)
    assert records["u"]["header"]["nx"] == 4
    assert records["u"]["header"]["ny"] == 3
    assert records["u"]["header"]["refTime"] == "2026-11-07T06:00:00Z"
    assert records["u"]["header"]["forecastTime"] == 5
    assert records["u"]["header"]["surface1Value"] == 10
    assert records["temp"]["header"]["surface1Value"] == 2
    assert records["temp"]["header"]["parameterUnit"] == "K"
    expected = np.arange(40).reshape(5, 8)[::2, ::2].ravel()
    np.testing.assert_allclose(records["u"]["data"], expected - 20, atol=0.001)
    np.testing.assert_allclose(records["temp"]["data"], expected + 273.15, atol=0.001)


@pytest.mark.parametrize("overrides", [
    {"scaledValueOfFirstFixedSurface": 100},
    {"forecastTime": 6},
    {"jScansPositively": 1},
    {"uvRelativeToGrid": 1},
])
def test_decoder_rejects_wrong_height_time_or_vector_orientation(overrides):
    with pytest.raises(data.EarthDataError):
        data.decode_field(message("u", **overrides), "u", selection(), 90)


def test_atomic_snapshot_and_cache_reuse(tmp_path):
    samples = {key: message(key) for key in data.FIELDS}
    requests = []

    def reader(url, *, byte_range=None):
        requests.append(byte_range)
        if byte_range is None:
            return index_for().encode()
        return samples[index_keys()[byte_range[0] // 100 - 1]]

    result = data.sync_latest(tmp_path, now=NOW, resolution=90, reader=reader)
    assert result == data.load_manifest(tmp_path)
    assert len(requests) == 25
    assert result["schema"] == 2
    assert result["id"].endswith("-v2")
    assert result["pressure_levels_hpa"] == [1000, 850, 700, 500, 250, 70, 10]
    assert len(result["layers"]) == 8
    assert len(result["files"]) == 16
    assert result["valid_time"] == "2026-11-07T11:00:00Z"
    assert len(json.loads((tmp_path / result["id"] / "wind.json").read_text())) == 2
    assert len(json.loads((tmp_path / result["id"] / "temp.json").read_text())) == 1
    data.sync_latest(tmp_path, now=NOW, resolution=90, reader=reader)
    assert len(requests) == 26  # check the index, then reuse all complete layers
    for pressure in (1000, 850, 700, 500, 250, 70, 10):
        record = json.loads((tmp_path / result["id"] / f"{pressure}hPa/temp.json").read_text())[0]
        assert record["header"]["pressureLevelHpa"] == pressure
        assert record["header"]["surface1Value"] == pressure * 100


def test_failed_update_does_not_replace_last_good_manifest(tmp_path):
    marker = b'{"previous":"good snapshot"}'
    (tmp_path / "manifest.json").write_bytes(marker)

    def reader(url, *, byte_range=None):
        if byte_range is None:
            return index_for().encode()
        raise OSError("disconnected mid-download")

    with pytest.raises(OSError):
        data.sync_latest(tmp_path, now=NOW, reader=reader)
    assert (tmp_path / "manifest.json").read_bytes() == marker
    assert list(tmp_path.iterdir()) == [tmp_path / "manifest.json"]


def test_mixed_grid_snapshot_is_rejected():
    records = {name: data.decode_field(message(name), name, selection(), 90) for name in data.FIELDS}
    records["temp"]["header"]["forecastTime"] = 6
    with pytest.raises(data.EarthDataError, match="do not match"):
        data.validate_fields(records)


@pytest.mark.parametrize("pressure", [1000, 850, 700, 500, 250, 70, 10])
def test_pressure_grib_uses_hpa_for_selection_and_pa_for_fixed_surface(pressure):
    key = f"{pressure}hPa-temp"
    record = data.decode_field(message(key), key, selection(), 90)
    assert record["header"]["surface1Type"] == 100
    assert record["header"]["surface1Value"] == pressure * 100
    assert record["header"]["pressureLevelHpa"] == pressure
    assert record["header"]["layer"] == f"{pressure}hPa"
    assert record["data"][0] == pytest.approx(273.15 - (1000 - pressure) / 25, abs=0.001)


def test_wrong_pressure_level_cannot_be_used_as_requested_layer():
    with pytest.raises(data.EarthDataError, match="vertical level"):
        data.decode_field(message("500hPa-u", scaledValueOfFirstFixedSurface=85000), "500hPa-u", selection(), 90)


def test_pressure_missing_values_remain_null_not_zero():
    record = data.decode_field(message("1000hPa-u", missing_index=0), "1000hPa-u", selection(), 90)
    assert record["data"][0] is None
    assert record["data"][1] is not None
    assert record["header"]["missingPoints"] == 1


def test_surface_missing_values_still_rejected():
    with pytest.raises(data.EarthDataError, match="Missing"):
        data.decode_field(message("u", missing_index=0), "u", selection(), 90)


def test_legacy_surface_cache_is_readable_but_does_not_satisfy_full_profile(tmp_path):
    old_id = "20261107T06Z-f005-90p0"
    old = tmp_path / old_id
    old.mkdir()
    for kind in ("wind", "temp"):
        (old / f"{kind}.json").write_text("[]")
    legacy = {"schema": 1, "id": old_id, "files": {kind: f"data/live/{old_id}/{kind}.json" for kind in ("wind", "temp")},
              "sizes": {"wind": 2, "temp": 2}}
    (tmp_path / "manifest.json").write_text(json.dumps(legacy))
    assert data.load_manifest(tmp_path) == legacy
    samples = {key: message(key) for key in data.FIELDS}

    def reader(url, *, byte_range=None):
        return index_for().encode() if byte_range is None else samples[index_keys()[byte_range[0] // 100 - 1]]

    upgraded = data.sync_latest(tmp_path, now=NOW, resolution=90, reader=reader)
    assert upgraded["schema"] == 2
    assert len(upgraded["layers"]) == 8
    assert (old / "wind.json").read_text() == "[]"
    (tmp_path / upgraded["id"] / "70hPa" / "temp.json").unlink()
    assert data.load_manifest(tmp_path) is None


def test_range_download_refuses_full_grib_response(monkeypatch):
    class Response:
        status = 200
        headers = {}
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def read(self, *_args): raise AssertionError("must not download the full 500 MB object")

    monkeypatch.setattr(data.urllib.request, "urlopen", lambda *_args, **_kwargs: Response())
    with pytest.raises(data.EarthDataError, match="honor"):
        data.read_url("https://example.test/grib", byte_range=(100, 199))
