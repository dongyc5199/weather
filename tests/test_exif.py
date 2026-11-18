from weather_geo_extractor.exif import dms_to_decimal, rational_to_float


def test_rational_to_float_from_tuple() -> None:
    assert rational_to_float((3, 2)) == 1.5


def test_dms_to_decimal_northern_eastern() -> None:
    value = dms_to_decimal([(39, 1), (54, 1), (1512, 100)], "N")
    assert round(value, 6) == 39.9042


def test_dms_to_decimal_western_is_negative() -> None:
    value = dms_to_decimal([(116, 1), (24, 1), (2664, 100)], "W")
    assert round(value, 6) == -116.4074



def test_byte_encoded_hemisphere_and_altitude(tmp_path, monkeypatch):
    from PIL import Image
    from weather_geo_extractor import exif

    path = tmp_path / "photo.jpg"
    Image.new("RGB", (4, 4)).save(path)
    monkeypatch.setattr(exif, "_read_gps_ifd", lambda _: {
        "GPSLatitude": (10, 0, 0), "GPSLongitude": (20, 0, 0),
        "GPSLatitudeRef": b"S", "GPSLongitudeRef": b"W",
        "GPSAltitude": (3, 2), "GPSAltitudeRef": bytes([1]),
    })
    result = exif.extract_gps(path)
    assert (result.latitude, result.longitude, result.altitude_m) == (-10, -20, -1.5)
