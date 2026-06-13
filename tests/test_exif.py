from weather_geo_extractor.exif import dms_to_decimal, rational_to_float


def test_rational_to_float_from_tuple() -> None:
    assert rational_to_float((3, 2)) == 1.5


def test_dms_to_decimal_northern_eastern() -> None:
    value = dms_to_decimal([(39, 1), (54, 1), (1512, 100)], "N")
    assert round(value, 6) == 39.9042


def test_dms_to_decimal_western_is_negative() -> None:
    value = dms_to_decimal([(116, 1), (24, 1), (2664, 100)], "W")
    assert round(value, 6) == -116.4074

