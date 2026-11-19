import gzip
import json
import struct
import numpy as np
import pytest
from weather_geo_extractor import earth_playback as pb
from weather_geo_extractor.earth_data import EarthDataError


def test_compact_fields_use_original_nodes_and_keep_missing_and_timestamps():
    model = dict(
        nx=720, ny=361, resolution=0.5, run_time="2026-11-18T00:00:00Z", forecast_hour=6
    )
    h = dict(
        nx=720,
        ny=361,
        lo1=0,
        la1=90,
        dx=0.5,
        dy=0.5,
        refTime=model["run_time"],
        forecastTime=6,
    )
    a = np.arange(720 * 361, dtype="f4").reshape(361, 720)
    a[32, 40] = np.nan
    rec = {"header": h, "data": a.ravel()}
    packet = pb._records(model, [rec], {"snapshot": "s", "product": "500hPa"})
    (length,) = struct.unpack_from("<I", packet)
    meta = json.loads(packet[4 : 4 + length])
    assert (
        length % 4 == 0
        and meta["headers"][0]["nx"] == 180
        and meta["headers"][0]["ny"] == 91
    )
    np.testing.assert_array_equal(
        np.frombuffer(packet, "<f4", offset=4 + length).reshape(91, 180), a[::4, ::4]
    )
    with pytest.raises(EarthDataError):
        pb._sample(dict(rec, header=dict(h, forecastTime=7)), model)


def test_completed_packet_is_reused_and_requests_do_not_cross_snapshots(
    tmp_path, monkeypatch
):
    key = "20261118T00Z-f001-0p5-v2"
    root = tmp_path / "data/live" / key
    root.mkdir(parents=True)
    (root / "metadata.json").write_text(
        json.dumps(dict(id=key, valid_time="v", run_time="r"))
    )
    monkeypatch.setattr(pb, "_observation", lambda *args: b"mask-bytes")
    assert (
        gzip.decompress(pb.playback_packet(tmp_path, key, "observation"))
        == b"mask-bytes"
    )
    monkeypatch.setattr(
        pb, "_observation", lambda *args: pytest.fail("duplicate build")
    )
    assert pb.playback_packet(tmp_path, key, "observation", False) == b"mask-bytes"
    with pytest.raises(ValueError):
        pb.playback_packet(tmp_path, key, "../500hPa")
    with pytest.raises(ValueError):
        pb.playback_packet(tmp_path, "../live", "observation")
