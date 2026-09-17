"""请求校验：收集全部错误并以 UTF-8 JSON Pointer (RFC 6901) 定位。"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, List, Tuple

from .segment import MIN_SEGMENT_POINTS

MIN_POINTS = 24
MAX_POINTS = 600
MAX_DECIMAL_PLACES = 6

_DECIMAL_RE = re.compile(r"^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$")
_ALLOWED_CURVE_KEYS = {"name", "points"}
_ALLOWED_POINT_KEYS = {"angle", "torque"}
_ALLOWED_THRESHOLD_KEYS = {"slope_min", "slope_max", "yield_ratio_max"}
_ALLOWED_ROOT_KEYS = {"curve", "threshold"}


class ValidationError(Exception):
    def __init__(self, errors: List[dict]) -> None:
        self.errors = errors
        super().__init__("validation failed")


def _escape(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def ptr(*parts: "int | str") -> str:
    return "".join("/" + _escape(str(p)) for p in parts)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _decimal_value(raw: Any, path: str, errors: List[dict]) -> Decimal | None:
    if not isinstance(raw, str):
        errors.append({"loc": path, "message": "必须是十进制字符串"})
        return None
    text = raw.strip()
    if not _DECIMAL_RE.match(text):
        errors.append(
            {"loc": path, "message": "必须是至多六位小数的十进制字符串"}
        )
        return None
    try:
        return Decimal(text)
    except InvalidOperation:  # pragma: no cover - 正则已拦截
        errors.append({"loc": path, "message": "非法十进制数"})
        return None


def _unknown_keys(obj: dict, allowed: set, path: str, errors: List[dict]) -> None:
    # path 为 JSON Pointer 前缀（根为 ""）。
    for key in obj:
        if key not in allowed:
            errors.append({"loc": f"{path}/{_escape(key)}",
                           "message": "未知字段"})


def validate_payload(body: Any) -> Tuple[List[Tuple[int, int]], dict]:
    """返回 (points, threshold)；失败时抛出含全部错误的 ValidationError。"""
    errors: List[dict] = []

    if not isinstance(body, dict):
        raise ValidationError(
            [{"loc": "", "message": "请求体必须是 JSON 对象"}]
        )
    _unknown_keys(body, _ALLOWED_ROOT_KEYS, "", errors)

    points: List[Tuple[int, int]] = []

    curve = body.get("curve")
    if "curve" not in body:
        errors.append({"loc": "/curve", "message": "字段缺失"})
    elif not isinstance(curve, dict):
        errors.append({"loc": "/curve", "message": "必须是对象"})
    else:
        _unknown_keys(curve, _ALLOWED_CURVE_KEYS, "/curve", errors)
        raw_points = curve.get("points")
        if "points" not in curve:
            errors.append({"loc": "/curve/points", "message": "字段缺失"})
        elif not isinstance(raw_points, list):
            errors.append({"loc": "/curve/points", "message": "必须是数组"})
        else:
            count = len(raw_points)
            if not MIN_POINTS <= count <= MAX_POINTS:
                errors.append({
                    "loc": "/curve/points",
                    "message": (
                        f"点数必须在 {MIN_POINTS} 到 {MAX_POINTS} 之间"
                        f"（当前 {count}）"
                    ),
                })
            prev_angle: int | None = None
            for idx, point in enumerate(raw_points):
                base = ptr("curve", "points", idx)
                if not isinstance(point, dict):
                    errors.append({"loc": base, "message": "必须是对象"})
                    continue
                _unknown_keys(point, _ALLOWED_POINT_KEYS, base, errors)
                angle = point.get("angle")
                if "angle" not in point:
                    errors.append({"loc": base + "/angle",
                                   "message": "字段缺失"})
                elif not _is_int(angle):
                    errors.append({"loc": base + "/angle",
                                   "message": "必须是整数（毫度）"})
                torque = point.get("torque")
                if "torque" not in point:
                    errors.append({"loc": base + "/torque",
                                   "message": "字段缺失"})
                elif not _is_int(torque) or torque < 0:
                    errors.append({"loc": base + "/torque",
                                   "message": "必须是非负整数（毫牛米）"})
                if _is_int(angle):
                    if prev_angle is not None and angle <= prev_angle:
                        errors.append({
                            "loc": base + "/angle",
                            "message": "angle 必须严格递增",
                        })
                    prev_angle = angle
                if _is_int(angle) and _is_int(torque) and torque >= 0:
                    points.append((angle, torque))

    threshold_in = body.get("threshold")
    decimals: dict[str, Decimal] = {}
    if "threshold" not in body:
        errors.append({"loc": "/threshold", "message": "字段缺失"})
    elif not isinstance(threshold_in, dict):
        errors.append({"loc": "/threshold", "message": "必须是对象"})
    else:
        _unknown_keys(threshold_in, _ALLOWED_THRESHOLD_KEYS,
                      "/threshold", errors)
        for key in _ALLOWED_THRESHOLD_KEYS:
            if key not in threshold_in:
                errors.append({"loc": ptr("threshold", key),
                               "message": "字段缺失"})
            else:
                value = _decimal_value(
                    threshold_in[key], ptr("threshold", key), errors
                )
                if value is not None:
                    decimals[key] = value
        if "slope_min" in decimals and decimals["slope_min"] <= 0:
            errors.append({
                "loc": "/threshold/slope_min",
                "message": "斜率区间下界必须为正",
            })
        if {"slope_min", "slope_max"} <= decimals.keys():
            if decimals["slope_max"] < decimals["slope_min"]:
                errors.append({
                    "loc": "/threshold/slope_max",
                    "message": "斜率区间上界不得小于下界",
                })
        if "yield_ratio_max" in decimals:
            ymax = decimals["yield_ratio_max"]
            if not 0 <= ymax <= 1:
                errors.append({
                    "loc": "/threshold/yield_ratio_max",
                    "message": "屈服比上限必须在 [0, 1] 内",
                })

    if errors:
        raise ValidationError(errors)

    # 点数不足 24 时不可能切出三段各 8 点，提前给出明确错误。
    if len(points) < 3 * MIN_SEGMENT_POINTS:  # pragma: no cover - 被前置范围拦截
        raise ValidationError([{
            "loc": "/curve/points",
            "message": "合法点数不足以切成各至少 8 点的三个连续区段",
        }])

    return points, {
        "slope_min": decimals["slope_min"],
        "slope_max": decimals["slope_max"],
        "yield_ratio_max": decimals["yield_ratio_max"],
        "raw": threshold_in,
    }
