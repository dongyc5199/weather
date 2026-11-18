"""Shared operations on sorted rectangular grid axes."""

import math
from bisect import bisect_left
from operator import neg


def coordinate_axis(start: float, stop: float, step: float) -> list[float]:
    if not all(map(math.isfinite, (start, stop, step))) or step <= 0:
        raise ValueError("grid bounds must be finite and resolution must be positive")
    values = []
    current = start
    while current <= stop + step * 0.001:
        values.append(round(current, 6))
        following = current + step
        if following == current:
            raise ValueError("resolution is too small for the grid coordinates")
        current = following
    return values


def _bracket(axis: list[float], value: float) -> tuple[int, int]:
    if len(axis) == 1:
        return 0, 0
    if axis[0] <= axis[-1]:
        upper = bisect_left(axis, value)
    else:
        upper = bisect_left(axis, -value, key=neg)
    upper = min(max(upper, 1), len(axis) - 1)
    return upper - 1, upper


def bilinear_sample(xs, ys, grid, x, y):
    """Interpolate a sorted grid, clamping at its outer nodes on either axis."""
    if not xs or not ys or not math.isfinite(x) or not math.isfinite(y):
        return None
    x0, x1 = _bracket(xs, x)
    y0, y1 = _bracket(ys, y)
    tx = (
        min(1.0, max(0.0, (x - xs[x0]) / (xs[x1] - xs[x0])))
        if xs[x1] != xs[x0]
        else 0.0
    )
    ty = (
        min(1.0, max(0.0, (y - ys[y0]) / (ys[y1] - ys[y0])))
        if ys[y1] != ys[y0]
        else 0.0
    )
    total = 0.0
    for row, wy in ((y0, 1 - ty), (y1, ty)):
        for col, wx in ((x0, 1 - tx), (x1, tx)):
            weight = wx * wy
            if weight:
                if row >= len(grid) or col >= len(grid[row]):
                    return None
                value = grid[row][col]
                if value is None:
                    return None
                total += weight * float(value)
    return total
