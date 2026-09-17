# 海上风机塔筒法兰 · 螺栓扳手曲线复核台

复紧法兰螺栓时，扳手扭矩-角度曲线混有**空转、弹性拉伸、屈服**三段。
本系统把每条曲线切成三个连续区段，对三段分别做独立最小二乘直线拟合，
取三段残差（SSE）总和最小的分界点 `(i, j)`，再按阈值判定该螺栓是否放行，
避免“固定角度判读”放过已经早屈服的螺栓。

- 后端：Python 3.12 · FastAPI（全程整数 / 有理数精确运算，无浮点参与判定）
- 前端：TypeScript · React 19 · Vite · 纯 SVG 叠绘（原始曲线 / 分界 / 三段拟合线）
- 编排：Docker Compose（常驻服务仅 `web`、`api`，另有 `verify` 一次性验收）
- 测试：pytest（算法 + API）、Vitest（前端单元/组件）、Playwright（端到端联调）

---

## 1. 数据字段（上传 JSON）

上传一个 UTF-8 编码的 JSON 文件，结构如下（完整示例见
[`examples/sample.json`](examples/sample.json)）：

```json
{
  "curve": {
    "name": "示例螺栓 T-01",
    "points": [
      { "angle": 0, "torque": 5 },
      { "angle": 10, "torque": 25 }
    ]
  },
  "threshold": {
    "slope_min": "0.1",
    "slope_max": "10",
    "yield_ratio_max": "0.5"
  }
}
```

### `curve.points[]`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `angle` | 整数 | **严格递增**；单位毫度（m°），可为负 |
| `torque` | 整数 | **非负**；单位毫牛·米（mN·m） |

- 每条曲线 **24～600 个点**（端点含），保证三段各至少 8 点。
- 布尔值 `true/false` 不被接受为整数。

### `curve.name`

可选字符串，仅用于展示。

### `threshold`（三个字段必填）

均为**至多 6 位小数的十进制字符串**（如 `"0.1"`、`"10"`、`"0.500000"`）：

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| `slope_min` | 第二段斜率闭区间下界 | **正数**，`slope_min ≤ slope_max` |
| `slope_max` | 第二段斜率闭区间上界 | 正数 |
| `yield_ratio_max` | 屈服比 `b3/b2` 上限 | `[0, 1]` |

阈值刻意使用字符串而非 JSON 数字，避免二进制浮点造成的边界误差；
后端用 `Decimal → Fraction` 精确解析。

---

## 2. 分段与判定算法

### 2.1 分段

把点列切成三个连续区段：

- 第一段 `[0, i)`：空转
- 第二段 `[i, j)`：弹性拉伸
- 第三段 `[j, n)`：屈服

`i`、`j` 即**第二、第三段首点的下标**，且三段各至少 8 个点：

```
8 ≤ i ≤ n − 16,  i + 8 ≤ j ≤ n − 8
```

### 2.2 目标：三段独立最小二乘总残差最小

对每个候选 `(i, j)`，分别对三段拟合直线 `y = a + b·x`，
三段残差平方和相加，取总残差最小的 `(i, j)`。

区段 `[l, r)`（记 `m = r−l`、五个前缀和 `Σx, Σy, Σx², Σxy, Σy²`）：

```
D = m·Σx² − (Σx)²          # angle 严格递增 ⇒ D > 0
E = m·Σxy − (Σx)(Σy)
F = m·Σy² − (Σy)²
N = F·D − E²               # Cauchy-Schwarz ⇒ N ≥ 0

斜率 b = E / D
SSE  = N / (m·D)
```

候选间的总残差比较只做**整数交叉乘积**（三分母均为正）：

```
num/den = N1/(m1·D1) + N2/(m2·D2) + N3/(m3·D3)
取 num·best_den < best_num·den 时更新
```

枚举顺序为 `i` 升序、`j` 升序，且仅在**严格更小**时更新，因此
**平局自动取较小的 `i`，再取较小的 `j`**。斜率与阈值的比较使用
`fractions.Fraction`（其比较即交叉相乘），全程不存在浮点判定。

### 2.3 显示规则（仅展示层）

- 三段斜率、各段残差、总残差、屈服比：**四舍五入远离零至 6 位小数**
  （负数的绝对值按 half-up 进位），并以字符串原样返回前端，
  前端不做任何二次取舍，保证页面与 API 显示一致。

### 2.4 放行判定

设三段拟合斜率为 `b1, b2, b3`，**仅当以下条件全部成立才放行**：

1. `b2 ≠ 0`（`b2 = 0` 直接拒绝）；
2. `b1 < b2`（空转斜率低于弹性段）；
3. `b3 < b2`（屈服段斜率回落）；
4. `slope_min ≤ b2 ≤ slope_max`（**闭区间**，含边界）；
5. `0 ≤ b3/b2 ≤ yield_ratio_max`。

响应同时给出每个条件的布尔值 `checks`，便于复核被拒原因。

---

## 3. HTTP API

服务 `api` 监听容器内 `8000` 端口。

### `POST /api/analyze`

请求体即第 1 节的 JSON。成功返回 `200`：

```json
{
  "i": 8,
  "j": 16,
  "segments": [
    { "start": 0, "end": 8, "slope": "2", "intercept": "5",
      "residual": "0",
      "fit": [ { "x": 0, "y": "5" }, { "x": 70, "y": "145" } ] }
  ],
  "slopes": ["2", "5", "1"],
  "total_residual": "0",
  "yield_ratio": "0.2",
  "accepted": true,
  "checks": {
    "b2_nonzero": true,
    "b1_lt_b2": true,
    "b3_lt_b2": true,
    "slope_in_range": true,
    "yield_ratio_ok": true
  },
  "threshold": { "slope_min": "0.1", "slope_max": "10", "yield_ratio_max": "0.5" }
}
```

- `segments[k].fit` 是该段拟合直线在区段首末点的两个端点，前端用它直接画拟合线。
- 即使 `accepted=false`，只要输入合法仍返回 `200` 与完整拟合结果。

### `GET /health`

返回 `{"status":"ok"}`，供容器健康检查使用。

### 非法输入 → `422`

响应一次性列出**全部**错误（非快速失败），`loc` 为
[RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) 风格的 UTF-8
JSON Pointer（`~`、`/` 按规则转义），例如：

```json
{
  "errors": [
    { "loc": "/curve/points/3/angle", "message": "angle 必须严格递增" },
    { "loc": "/curve/points/5/torque", "message": "必须是非负整数（毫牛米）" },
    { "loc": "/threshold/slope_min", "message": "斜率区间下界必须为正" },
    { "loc": "/curve/points", "message": "点数必须在 24 到 600 之间（当前 20）" }
  ]
}
```

前端收到 422 时只叠绘原始曲线，**不画任何拟合线与分界**。

---

## 4. 本地运行（Docker Compose）

常驻服务只有两个：`web`（nginx 托管静态产物并反代 API）与 `api`（uvicorn）。

```bash
docker compose up --build
```

- 浏览器打开 <http://localhost:8080>
- API 直接访问 <http://localhost:8000/health>

宿主端口可用环境变量覆盖（也可复制 `.env.example` 为 `.env`）：

```bash
WEB_PORT=9090 API_PORT=9000 docker compose up --build
```

### 一次性验收

`verify` 属于独立 profile，不会随 `up` 启动；它启动 Chromium 跑
Playwright 端到端用例，**结束后退出，退出码即验收结论**：

```bash
docker compose build
docker compose run --rm verify     # 全部通过则退出码 0
```

---

## 5. 开发与测试（不用容器）

### 后端

```bash
cd api
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest                      # 23 项：精确算法 / 暴力交叉验证 / API 200/422
uvicorn app.main:app --reload --port 8000
```

算法测试内含两套独立实现互验：生产实现（整数交叉乘积）与
`Fraction` 暴力枚举（40 组随机小数据 + 600 点大数据）。

### 前端

```bash
cd web
npm install
npm run dev                 # 开发服务器（自动代理 /api → VITE_API_TARGET）
npm run test:unit           # Vitest：API 客户端、载荷解析、App 组件
npm run build               # 类型检查 + 生产构建
npx playwright install chromium
E2E_BASE_URL=http://localhost:8080 npm run test:e2e
```

开发模式下如 API 不在默认位置：

```bash
VITE_API_TARGET=http://127.0.0.1:8000 npm run dev
```

---

## 6. 目录结构

```
.
├── api/
│   ├── app/
│   │   ├── main.py          # FastAPI：/api/analyze、422、舍入、放行判定
│   │   ├── segment.py       # 前缀和 + 整数/有理数三段最小二乘
│   │   └── validation.py    # 全量错误收集 + JSON Pointer
│   ├── tests/               # pytest
│   ├── requirements.txt
│   └── Dockerfile           # python:3.12-slim
├── web/
│   ├── src/
│   │   ├── App.tsx          # 上传、阈值、结果、错误列表
│   │   ├── Chart.tsx        # SVG：曲线 / i,j 分界 / 三段拟合线
│   │   ├── api.ts           # fetch 封装与 422 错误类型
│   │   ├── payload.ts       # JSON 提取与内置示例
│   │   └── *.test.ts(x)     # Vitest
│   ├── e2e/app.spec.ts      # Playwright 联调
│   ├── Dockerfile           # 多阶段构建 → nginx:alpine
│   └── Dockerfile.verify    # mcr.microsoft.com/playwright:v1.63.0-noble
├── examples/sample.json
└── docker-compose.yml       # web、api 常驻；verify 一次性
```
