"""API 层测试：200 判定、422 全量错误、JSON Pointer 定位。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app, round6_away
from fractions import Fraction

client = TestClient(app)


def make_points(n=24):
    pts = []
    for k in range(n):
        if k < 8:
            y = 2 * k * 10 + 5
        elif k < 16:
            y = 5 * k * 10 + 5
        else:
            y = 1 * k * 10 + 5
        pts.append({"angle": k * 10, "torque": y})
    return pts


def payload(threshold=None, **overrides):
    body = {
        "curve": {"name": "T-01", "points": make_points()},
        "threshold": threshold or {
            "slope_min": "0.1",
            "slope_max": "10",
            "yield_ratio_max": "0.5",
        },
    }
    body.update(overrides)
    return body


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_valid_accepted():
    r = client.post("/api/analyze", json=payload())
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["i"] == 8 and data["j"] == 16
    assert data["accepted"] is True
    assert data["slopes"] == ["2", "5", "1"]
    assert data["total_residual"] == "0"
    assert data["yield_ratio"] == "0.2"
    assert data["checks"]["b1_lt_b2"] is True
    # 三段拟合线端点
    assert data["segments"][0]["fit"][0] == {"x": 0, "y": "5"}
    assert data["segments"][1]["fit"][0]["x"] == 80


def test_b2_zero_rejected():
    # 第二段水平：b2=0
    pts = make_points()
    for p in pts[8:16]:
        p["torque"] = 500
    r = client.post("/api/analyze", json=payload(
        threshold={"slope_min": "0.000001", "slope_max": "10",
                   "yield_ratio_max": "1"}
    ) | {"curve": {"points": pts}})
    assert r.status_code == 200
    assert r.json()["accepted"] is False
    assert r.json()["checks"]["b2_nonzero"] is False


def test_yield_ratio_exceeds_rejected():
    pts = make_points()
    # 第三段斜率 4，比值 0.8 > 0.5
    for k in range(16, 24):
        pts[k]["torque"] = 4 * k * 10 + 5
    r = client.post("/api/analyze", json=payload() | {"curve": {"points": pts}})
    assert r.status_code == 200
    data = r.json()
    assert data["accepted"] is False
    assert data["checks"]["yield_ratio_ok"] is False


def test_closed_interval_boundary_accepted():
    # b2=5 正好落在闭区间边界
    body = payload(threshold={"slope_min": "5", "slope_max": "5",
                              "yield_ratio_max": "0.2"})
    r = client.post("/api/analyze", json=body)
    assert r.status_code == 200
    assert r.json()["accepted"] is True


def test_slope_out_of_range_rejected():
    body = payload(threshold={"slope_min": "6", "slope_max": "10",
                              "yield_ratio_max": "0.5"})
    r = client.post("/api/analyze", json=body)
    assert r.json()["accepted"] is False
    assert r.json()["checks"]["slope_in_range"] is False


def test_b1_not_below_b2_rejected():
    pts = make_points()
    for k in range(8):
        pts[k]["torque"] = 9 * k * 10
    r = client.post("/api/analyze", json=payload() | {"curve": {"points": pts}})
    assert r.json()["accepted"] is False
    assert r.json()["checks"]["b1_lt_b2"] is False


def test_422_collects_all_errors_with_json_pointer():
    bad = {
        "curve": {
            "name": "x",
            "bogus": 1,
            "points": [
                {"angle": 10, "torque": 5},
                {"angle": 10, "torque": -3},   # 非递增 + 负扭矩
                {"angle": "50", "torque": 7},  # 非整数
                {"torque": 9},                 # 缺 angle
            ],
        },
        "threshold": {
            "slope_min": "0",      # 必须为正
            "slope_max": "0.1.2",  # 非十进制
            "yield_ratio_max": "1.5",  # 超出 [0,1]
            "extra": "no",
        },
        "top_extra": True,
    }
    r = client.post("/api/analyze", json=bad)
    assert r.status_code == 422
    errors = r.json()["errors"]
    locs = {e["loc"] for e in errors}
    assert "/curve/bogus" in locs
    assert "/top_extra" in locs
    assert "/curve/points" in locs                      # 点数范围
    assert "/curve/points/1/angle" in locs
    assert "/curve/points/1/torque" in locs
    assert "/curve/points/2/angle" in locs
    assert "/curve/points/3/angle" in locs
    assert "/threshold/slope_max" in locs
    assert "/threshold/yield_ratio_max" in locs
    assert "/threshold/slope_min" in locs
    assert "/threshold/extra" in locs
    # 每个错误都有可读消息，且定位均为 JSON Pointer
    assert all(e["loc"] == "" or e["loc"].startswith("/") for e in errors)
    assert all(e["message"] for e in errors)
    # 同一字段的多个错误都被收集（非快速失败）
    assert len(errors) >= 10


def test_422_missing_sections():
    r = client.post("/api/analyze", json={})
    assert r.status_code == 422
    locs = {e["loc"] for e in r.json()["errors"]}
    assert "/curve" in locs and "/threshold" in locs


def test_422_malformed_json():
    r = client.post("/api/analyze",
                    content=b"{not json",
                    headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_422_threshold_not_string():
    body = payload()
    body["threshold"]["slope_min"] = 0.1
    r = client.post("/api/analyze", json=body)
    assert r.status_code == 422
    assert any(e["loc"] == "/threshold/slope_min" for e in r.json()["errors"])


def test_422_seven_decimal_places():
    body = payload(threshold={"slope_min": "0.1234567", "slope_max": "1",
                              "yield_ratio_max": "0.5"})
    r = client.post("/api/analyze", json=body)
    assert r.status_code == 422


def test_422_bool_rejected_as_int():
    pts = make_points()
    pts[0]["torque"] = True
    r = client.post("/api/analyze", json=payload() | {"curve": {"points": pts}})
    assert r.status_code == 422


def test_round_half_away_from_zero():
    assert round6_away(Fraction(1, 2_000_000)) == "0.000001"  # 0.0000005 进位
    assert round6_away(Fraction(-1, 2_000_000)) == "-0.000001"
    assert round6_away(Fraction(1, 8)) == "0.125"
    assert round6_away(Fraction(2, 3)) == "0.666667"
    assert round6_away(Fraction(-2, 3)) == "-0.666667"


def test_600_points_accepted_shape():
    pts = [{"angle": k * 3, "torque": (2 * k if k < 200 else 5 * k if k < 400 else k) * 3}
           for k in range(600)]
    body = payload(threshold={"slope_min": "1", "slope_max": "9",
                              "yield_ratio_max": "0.5"})
    body["curve"] = {"points": pts}
    r = client.post("/api/analyze", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["i"] == 200 and data["j"] == 400
    assert data["slopes"] == ["2", "5", "1"]
