"""FastAPI 入口：曲线分段拟合复核。"""

from __future__ import annotations

import json
from fractions import Fraction

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .segment import analyze
from .validation import ValidationError, validate_payload

app = FastAPI(title="法兰螺栓扳手曲线复核台", version="1.0.0")


def round6_away(value: Fraction) -> str:
    """四舍五入远离零至六位小数（仅用于显示），去掉无意义尾零。"""
    scaled = value * 1_000_000
    num, den = scaled.numerator, scaled.denominator
    if num >= 0:
        rounded = (num + den // 2) // den  # half up
    else:
        rounded = -((-num + den // 2) // den)  # half away from zero
    if rounded == 0:
        return "0"
    sign = "-" if rounded < 0 else ""
    rounded = abs(rounded)
    whole, frac = divmod(rounded, 1_000_000)
    text = f"{sign}{whole}.{frac:06d}".rstrip("0").rstrip(".")
    return text


def _fit_point(point: tuple[int, Fraction]) -> dict:
    x, y = point
    return {"x": x, "y": round6_away(y)}


def _segment_payload(seg: dict) -> dict:
    return {
        "start": seg["start"],
        "end": seg["end"],
        "slope": round6_away(seg["slope"]),
        "intercept": round6_away(seg["intercept"]),
        "residual": None,  # 由 analyze 结果填充
        "fit": [_fit_point(seg["fit_first"]), _fit_point(seg["fit_last"])],
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze_curve(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse(
            status_code=422,
            content={"errors": [
                {"loc": "", "message": "请求体不是合法的 UTF-8 JSON"}
            ]},
        )

    try:
        points, threshold = validate_payload(body)
    except ValidationError as exc:
        return JSONResponse(status_code=422, content={"errors": exc.errors})

    result = analyze(points)
    i, j = result["i"], result["j"]
    seg1, seg2, seg3 = result["segments"]
    sse1, sse2, sse3 = result["residuals"]
    total = result["total_residual"]

    b1, b2, b3 = seg1["slope"], seg2["slope"], seg3["slope"]

    slope_min = Fraction(threshold["slope_min"])
    slope_max = Fraction(threshold["slope_max"])
    ymax = Fraction(threshold["yield_ratio_max"])

    b2_nonzero = b2 != 0
    peak1 = b1 < b2
    peak3 = b3 < b2
    slope_in_range = slope_min <= b2 <= slope_max
    if b2_nonzero:
        ratio = b3 / b2
        yield_ok = 0 <= ratio <= ymax
    else:
        ratio = None
        yield_ok = False

    accepted = bool(
        b2_nonzero and peak1 and peak3 and slope_in_range and yield_ok
    )

    payload_segments = [_segment_payload(seg1), _segment_payload(seg2),
                        _segment_payload(seg3)]
    payload_segments[0]["residual"] = round6_away(sse1)
    payload_segments[1]["residual"] = round6_away(sse2)
    payload_segments[2]["residual"] = round6_away(sse3)

    return JSONResponse({
        "i": i,
        "j": j,
        "segments": payload_segments,
        "slopes": [round6_away(b1), round6_away(b2), round6_away(b3)],
        "total_residual": round6_away(total),
        "yield_ratio": round6_away(ratio) if ratio is not None else None,
        "accepted": accepted,
        "checks": {
            "b2_nonzero": b2_nonzero,
            "b1_lt_b2": peak1,
            "b3_lt_b2": peak3,
            "slope_in_range": slope_in_range,
            "yield_ratio_ok": yield_ok,
        },
        "threshold": threshold["raw"],
    })
