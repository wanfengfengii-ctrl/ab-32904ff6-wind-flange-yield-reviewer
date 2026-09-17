"""算法层测试：精确枚举、平局规则、随机暴力交叉验证。"""

from fractions import Fraction

import pytest

from app.segment import (
    MIN_SEGMENT_POINTS,
    PrefixSums,
    analyze,
    best_partition,
)


def brute_force(points):
    """独立的 Fraction 暴力实现，用于交叉验证。"""
    n = len(points)
    pref = PrefixSums(points)

    def sse(l, r):
        m, sx, sy, sxx, sxy, syy = pref.block(l, r)
        d = m * sxx - sx * sx
        e = m * sxy - sx * sy
        f = m * syy - sy * sy
        return Fraction(f * d - e * e, m * d)

    best = None
    best_val = None
    m = MIN_SEGMENT_POINTS
    for i in range(m, n - 2 * m + 1):
        for j in range(i + m, n - m + 1):
            val = sse(0, i) + sse(i, j) + sse(j, n)
            if best_val is None or val < best_val:
                best_val = val
                best = (i, j)
    return best


def piecewise(n_per=8, b1=2, b2=5, b3=1, step=10):
    """三段严格线性整数数据，真实分界 (8, 16)。"""
    points = []
    slopes = (b1, b2, b3)
    for k in range(3 * n_per):
        seg = min(k // n_per, 2)
        points.append((k * step, slopes[seg] * k * step))
    return points


def test_exact_linear_finds_true_boundaries():
    points = piecewise()
    assert best_partition(points) == (8, 16)
    result = analyze(points)
    assert result["i"] == 8 and result["j"] == 16
    assert result["total_residual"] == 0
    s1, s2, s3 = result["segments"]
    assert (s1["slope"], s2["slope"], s3["slope"]) == (2, 5, 1)
    assert s1["intercept"] == 0


def test_constant_data_everything_ties_prefers_smallest_i_j():
    points = [(k * 7, 100) for k in range(24)]
    assert best_partition(points) == (8, 16)


def test_tie_prefers_smaller_j_then_smaller_i():
    # y 只取决于下标：构造对平移不敏感的对称数据，使多处分界残差相同。
    n = 32
    points = [(k, k * k) for k in range(n)]
    assert best_partition(points) == brute_force(points)


def test_random_small_brute_force(rng_factory):
    rng = rng_factory(20260917)
    for trial in range(40):
        n = rng.randint(24, 46)
        # 随机游走 + 斜率漂移，整数坐标
        x = 0
        y = rng.randint(0, 20)
        points = []
        slope = rng.randint(-2, 6)
        for k in range(n):
            x += rng.randint(1, 9)
            if k % 9 == 0:
                slope = rng.randint(-3, 9)
            y = max(0, y + slope + rng.randint(-2, 2))
            points.append((x, y))
        got = best_partition(points)
        expected = brute_force(points)
        assert got == expected, f"trial {trial}: {got} != {expected}"


def test_minimum_24_points_only_one_partition():
    points = piecewise()
    assert len(points) == 24
    assert best_partition(points) == (8, 16)


def test_600_points_runs_and_matches_bruteforce(rng_factory):
    rng = rng_factory(7)
    n = 600
    x, y, slope = 0, 0, 3
    points = []
    for k in range(n):
        x += rng.randint(1, 5)
        if k % 120 == 0:
            slope = rng.randint(0, 8)
        y = max(0, y + slope + rng.randint(-1, 1))
        points.append((x, y))
    assert best_partition(points) == brute_force(points)


def test_negative_angles_allowed():
    points = [(k - 50, 3 * (k - 50) + 100) for k in range(30)]
    i, j = best_partition(points)
    assert 8 <= i < j <= 22
    assert analyze(points)["total_residual"] == 0


def test_too_few_points_raises():
    with pytest.raises(ValueError):
        best_partition([(k, k) for k in range(23)])
