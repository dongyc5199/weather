import math
import pytest

from weather_geo_extractor.grid import coordinate_axis, bilinear_sample


@pytest.mark.parametrize("step", [0, -1, math.inf, math.nan])
def test_invalid_resolution_fails_immediately(step):
    with pytest.raises(ValueError, match="resolution"):
        coordinate_axis(0, 1, step)


def test_missing_data_and_single_axis():
    assert bilinear_sample([1], [4, 2], [[8], [4]], 1, 3) == 6
    assert bilinear_sample([0, 1], [0, 1], [[9, None], []], 0, 0) == 9
    assert bilinear_sample([0, 1], [0, 1], [[9, None], []], .5, 0) is None
    assert bilinear_sample([2, 0], [3, 1], [[10, 2], [6, 0]], 1, 2) == 4.5
