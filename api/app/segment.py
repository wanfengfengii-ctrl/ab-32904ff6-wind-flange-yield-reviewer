"""三段独立最小二乘分段算法（全程整数 / 有理数精确运算）。

输入点的 angle、torque 均为整数。将 n 个点切成三个连续区段
``[0, i)``、``[i, j)``、``[j, n)``，每段至少 8 个点；``i``、``j``
即第二、三段首点下标。

对每个候选 ``(i, j)``，分别对三段做最小二乘直线拟合，取三段残差
（残差平方和 SSE）总和最小者。

所有比较只用整数交叉乘积，不引入浮点：

* 对区段 ``[l, r)`` 记 n=r-l 及

  ``D = n*Σx² - (Σx)²``  （正比于 x 的离差平方和，严格递增 x 下 > 0）
  ``E = n*Σxy - (Σx)(Σy)``
  ``F = n*Σy² - (Σy)²``
  ``N = F*D - E²``

  斜率 ``b = E/D``，残差 ``SSE = N/(n*D)``。

* 三个分数之和的比较通过交叉乘积完成；按 ``i`` 升、``j`` 升枚举且
  仅在严格更优时更新，平局自然保留较小 ``i``、再较小 ``j``。
"""

from __future__ import annotations

from fractions import Fraction
from typing import Sequence, Tuple

MIN_SEGMENT_POINTS = 8


class PrefixSums:
    """五项前缀和，区段聚合 O(1)。"""

    __slots__ = ("sx", "sy", "sxx", "sxy", "syy")

    def __init__(self, points: Sequence["tuple[int, int]"]) -> None:
        n = len(points)
        self.sx = [0] * (n + 1)
        self.sy = [0] * (n + 1)
        self.sxx = [0] * (n + 1)
        self.sxy = [0] * (n + 1)
        self.syy = [0] * (n + 1)
        for k, (x, y) in enumerate(points):
            self.sx[k + 1] = self.sx[k] + x
            self.sy[k + 1] = self.sy[k] + y
            self.sxx[k + 1] = self.sxx[k] + x * x
            self.sxy[k + 1] = self.sxy[k] + x * y
            self.syy[k + 1] = self.syy[k] + y * y

    def block(self, l: int, r: int) -> Tuple[int, int, int, int, int, int]:
        """返回区段 [l, r) 的 (n, Σx, Σy, Σx², Σxy, Σy²)。"""
        return (
            r - l,
            self.sx[r] - self.sx[l],
            self.sy[r] - self.sy[l],
            self.sxx[r] - self.sxx[l],
            self.sxy[r] - self.sxy[l],
            self.syy[r] - self.syy[l],
        )


def _segment_terms(
    n: int, sx: int, sy: int, sxx: int, sxy: int, syy: int
) -> Tuple[int, int, int]:
    """返回 (D, E, N)，满足 slope=E/D、SSE=N/(n*D)。"""
    d = n * sxx - sx * sx
    e = n * sxy - sx * sy
    f = n * syy - sy * sy
    num = f * d - e * e
    return d, e, num


def best_partition(
    points: Sequence["tuple[int, int]"],
    min_points: int = MIN_SEGMENT_POINTS,
) -> Tuple[int, int]:
    """求三段独立最小二乘总残差最小的 (i, j)。

    平局先取较小 i、再取较小 j。要求 ``len(points) >= 3*min_points``。
    """
    n = len(points)
    if n < 3 * min_points:
        raise ValueError("not enough points for three segments")

    pref = PrefixSums(points)

    best_i = -1
    best_j = -1
    best_num = 0
    best_den = 1  # 始终为正

    m = min_points
    for i in range(m, n - 2 * m + 1):
        d1 = pref.block(0, i)
        D1, _, N1 = _segment_terms(*d1)
        den1 = i * D1
        for j in range(i + m, n - m + 1):
            d2 = pref.block(i, j)
            D2, _, N2 = _segment_terms(*d2)
            d3 = pref.block(j, n)
            D3, _, N3 = _segment_terms(*d3)

            n2 = j - i
            n3 = n - j
            den2 = n2 * D2
            den3 = n3 * D3

            # 总残差 = N1/den1 + N2/den2 + N3/den3，通分只做整数乘加。
            den = den1 * den2 * den3
            num = (
                N1 * den2 * den3
                + N2 * den1 * den3
                + N3 * den1 * den2
            )

            if best_i < 0 or num * best_den < best_num * den:
                best_i, best_j = i, j
                best_num, best_den = num, den

    return best_i, best_j


def fit_segment(
    points: Sequence["tuple[int, int]"], l: int, r: int,
    pref: PrefixSums | None = None,
) -> dict:
    """对 [l, r) 做精确最小二乘，返回斜率/截距 Fraction 及端点拟合值。"""
    if pref is None:
        pref = PrefixSums(points)
    n, sx, sy, sxx, sxy, _ = pref.block(l, r)
    d = n * sxx - sx * sx
    e = n * sxy - sx * sy
    slope = Fraction(e, d)
    intercept = Fraction(sy, n) - slope * Fraction(sx, n)
    x0 = points[l][0]
    x1 = points[r - 1][0]
    return {
        "start": l,
        "end": r,
        "slope": slope,
        "intercept": intercept,
        "fit_first": (x0, intercept + slope * x0),
        "fit_last": (x1, intercept + slope * x1),
    }


def analyze(points: Sequence["tuple[int, int]"]) -> dict:
    """分段并拟合三段，返回 (i, j) 与精确 Fraction 结果。"""
    i, j = best_partition(points)
    n = len(points)
    pref = PrefixSums(points)
    seg1 = fit_segment(points, 0, i, pref)
    seg2 = fit_segment(points, i, j, pref)
    seg3 = fit_segment(points, j, n, pref)

    sse1, sse2, sse3 = _sse(pref, 0, i), _sse(pref, i, j), _sse(pref, j, n)
    return {
        "i": i,
        "j": j,
        "segments": (seg1, seg2, seg3),
        "residuals": (sse1, sse2, sse3),
        "total_residual": sse1 + sse2 + sse3,
    }


def _sse(pref: PrefixSums, l: int, r: int) -> Fraction:
    n, sx, sy, sxx, sxy, syy = pref.block(l, r)
    d = n * sxx - sx * sx
    e = n * sxy - sx * sy
    f = n * syy - sy * sy
    return Fraction(f * d - e * e, n * d)
