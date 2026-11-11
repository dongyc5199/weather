from datetime import datetime, timedelta, timezone
import json

import numpy as np
import pytest

from weather_geo_extractor import earth_data as data
from weather_geo_extractor.earth_pressure import pressure_profile

RUN = datetime(2026, 11, 9, 0, tzinfo=timezone.utc)


def message(value=101200, forecast=3, surface_type=101, missing=False):
    ec = pytest.importorskip("eccodes")
    handle = ec.codes_grib_new_from_samples("regular_ll_sfc_grib2")
    try:
        for key, val in {
            "Ni": 8, "Nj": 5, "latitudeOfFirstGridPointInDegrees": 90,
            "latitudeOfLastGridPointInDegrees": -90, "longitudeOfFirstGridPointInDegrees": 0,
            "longitudeOfLastGridPointInDegrees": 315, "iDirectionIncrementInDegrees": 45,
            "jDirectionIncrementInDegrees": 45, "discipline": 0, "parameterCategory": 3,
            "parameterNumber": 1, "typeOfFirstFixedSurface": surface_type,
            "scaledValueOfFirstFixedSurface": 0, "dataDate": 20261109, "dataTime": 0,
            "forecastTime": forecast,
        }.items():
            ec.codes_set(handle, key, val)
        values = np.full(40, float(value))
        if missing:
            ec.codes_set(handle, "bitmapPresent", 1)
            ec.codes_set(handle, "missingValue", 9999)
            values[0] = 9999
        ec.codes_set_values(handle, values)
        return ec.codes_get_message(handle)
    finally:
        ec.codes_release(handle)


def test_real_prmsl_grib_preserves_mean_sea_level_and_pa_units():
    selection = data.Selection(RUN, RUN + timedelta(hours=3), 3, "https://example.test/gfs", {})
    result = data.decode_field(message(missing=True), "pressure", selection, 90, spec=data.SEA_LEVEL_PRESSURE)
    assert result["header"]["parameterUnit"] == "Pa"
    assert result["header"]["surface1Type"] == 101
    assert result["header"]["layer"] == "mean_sea_level"
    assert result["data"][0] is None
    assert result["data"][1:] == [101200] * 11
    with pytest.raises(data.EarthDataError, match="vertical level"):
        data.decode_field(message(surface_type=1), "pressure", selection, 90, spec=data.SEA_LEVEL_PRESSURE)
    with pytest.raises(data.EarthDataError, match="run/valid time"):
        data.decode_field(message(forecast=4), "pressure", selection, 90, spec=data.SEA_LEVEL_PRESSURE)


def snapshot(viewer):
    key = "20261109T00Z-f003-90p0-v2"
    source = viewer / "data/live" / key
    source.mkdir(parents=True)
    (source / "metadata.json").write_text(json.dumps({"id": key, "run_time": data.iso_time(RUN),
        "valid_time": data.iso_time(RUN + timedelta(hours=3)), "resolution": 90}))
    (source / "wind.json").write_text(json.dumps([{"header": {"nx": 4, "ny": 3, "dx": 90,
        "dy": 90, "lo1": 0, "la1": 90, "refTime": data.iso_time(RUN), "forecastTime": 3}}]))
    return key


def test_pressure_download_is_snapshot_aligned_and_reuses_validated_cache(tmp_path):
    key = snapshot(tmp_path)
    payload = message()
    index = "1:0:d=2026110900:PRMSL:mean sea level:3 hour fcst:\n2:100:d=2026110900:CLWMR:1 hybrid level:3 hour fcst:\n"
    calls = []
    def reader(url, *, byte_range=None):
        calls.append((url, byte_range))
        assert url.startswith(data.ORIGINS[0] + "/gfs.20261109/00/atmos/gfs.t00z.pgrb2.0p25.f003")
        return index.encode() if byte_range is None else payload
    result = pressure_profile(tmp_path, key, reader=reader)
    assert result["reference"] == "mean sea level"
    assert result["pressure"]["data"] == [101200] * 12
    assert len(calls) == 2 and calls[1][1] == (0, 99)
    assert pressure_profile(tmp_path, key, reader=reader) == result
    assert len(calls) == 2
    path = tmp_path / "data/earth3d-cache/pressure" / key / "mean-sea-level.json"
    stale = json.loads(path.read_text())
    stale["header"]["forecastTime"] = 4
    path.write_text(json.dumps(stale))
    with pytest.raises(data.EarthDataError, match="does not match"):
        pressure_profile(tmp_path, key, reader=reader)


def test_missing_prmsl_is_not_substituted_with_surface_pressure(tmp_path):
    key = snapshot(tmp_path)
    def reader(url, *, byte_range=None):
        assert byte_range is None
        return b"1:0:d=2026110900:PRES:surface:3 hour fcst:\n2:100:d=2026110900:TMP:surface:3 hour fcst:\n"
    with pytest.raises(data.EarthDataError, match="mean sea-level pressure"):
        pressure_profile(tmp_path, key, reader=reader)
    assert not (tmp_path / "data/earth3d-cache/pressure" / key / "mean-sea-level.json").exists()


def test_pressure_snapshot_rejects_path_traversal(tmp_path):
    with pytest.raises(ValueError, match="snapshot"):
        pressure_profile(tmp_path, "../../private", reader=lambda *_: pytest.fail("unexpected network"))
