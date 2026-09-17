import { useMemo, useState } from 'react';
import Chart from './Chart';
import { analyzeCurve, ApiValidationError } from './api';
import { buildSample, extractName, extractRawPoints, extractThreshold } from './payload';
import type { AnalyzeRequest, AnalyzeResponse, ApiError, Point, Threshold } from './types';

interface ErrorState {
  kind: 'validation' | 'transport';
  errors: ApiError[];
  message?: string;
}

export default function App() {
  const [points, setPoints] = useState<Point[]>([]);
  const [curveName, setCurveName] = useState('');
  const [threshold, setThreshold] = useState<Threshold>({
    slope_min: '',
    slope_max: '',
    yield_ratio_max: '',
  });
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');

  const requestPayload = useMemo((): AnalyzeRequest | null => {
    if (points.length === 0) return null;
    return { curve: { ...(curveName ? { name: curveName } : {}), points }, threshold };
  }, [points, curveName, threshold]);

  function ingestJson(text: string, source: string): unknown | null {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      setErrorState({
        kind: 'transport',
        errors: [],
        message: `${source} 不是合法 JSON 文件`,
      });
      return null;
    }
    const rawPoints = extractRawPoints(json);
    setPoints(rawPoints);
    setResult(null);
    setErrorState(null);
    setFileName(source);
    setCurveName(extractName(json));
    const t = extractThreshold(json);
    setThreshold((prev) => ({
      slope_min: t.slope_min ?? prev.slope_min,
      slope_max: t.slope_max ?? prev.slope_max,
      yield_ratio_max: t.yield_ratio_max ?? prev.yield_ratio_max,
    }));
    return json;
  }

  async function handleFile(file: File) {
    const text = await file.text();
    ingestJson(text, file.name);
  }

  function loadSample() {
    const sample = buildSample();
    ingestJson(sample.text, '内置示例');
  }

  async function runAnalyze() {
    if (!requestPayload) return;
    setBusy(true);
    setErrorState(null);
    try {
      const data = await analyzeCurve(requestPayload);
      setResult(data);
      setErrorState(null);
    } catch (err) {
      setResult(null);
      if (err instanceof ApiValidationError) {
        setErrorState({ kind: 'validation', errors: err.errors });
      } else {
        setErrorState({
          kind: 'transport',
          errors: [],
          message: err instanceof Error ? err.message : '未知错误',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    points.length > 0 &&
    threshold.slope_min.trim() !== '' &&
    threshold.slope_max.trim() !== '' &&
    threshold.yield_ratio_max.trim() !== '' &&
    !busy;

  return (
    <div className="page">
      <header className="header">
        <h1>海上风机塔筒法兰 · 螺栓扳手曲线复核台</h1>
        <p className="subtitle">
          三段独立最小二乘分段（空转 / 弹性拉伸 / 屈服）· 整数与有理数精确求解 ·
          斜率与残差四舍五入远离零至 6 位
        </p>
      </header>

      <main className="layout">
        <section className="panel" aria-label="输入区">
          <div className="upload-row">
            <label className="file-btn">
              上传曲线 JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button type="button" className="ghost-btn" onClick={loadSample}>
              载入内置示例
            </button>
            {fileName && <span className="file-name" data-testid="file-name">{fileName}</span>}
          </div>

          {curveName && (
            <div className="curve-name">曲线：{curveName}（{points.length} 点）</div>
          )}
          {!curveName && points.length > 0 && (
            <div className="curve-name">共 {points.length} 个点</div>
          )}

          <fieldset className="threshold-box">
            <legend>判定阈值（至多 6 位小数的十进制字符串）</legend>
            <label>
              第二段斜率下界（含）
              <input
                value={threshold.slope_min}
                placeholder="如 0.1"
                inputMode="decimal"
                onChange={(e) =>
                  setThreshold({ ...threshold, slope_min: e.target.value })
                }
              />
            </label>
            <label>
              第二段斜率上界（含）
              <input
                value={threshold.slope_max}
                placeholder="如 10"
                inputMode="decimal"
                onChange={(e) =>
                  setThreshold({ ...threshold, slope_max: e.target.value })
                }
              />
            </label>
            <label>
              屈服比 b3/b2 上限 [0,1]
              <input
                value={threshold.yield_ratio_max}
                placeholder="如 0.5"
                inputMode="decimal"
                onChange={(e) =>
                  setThreshold({ ...threshold, yield_ratio_max: e.target.value })
                }
              />
            </label>
          </fieldset>

          <button
            type="button"
            className="primary-btn"
            disabled={!canSubmit}
            onClick={() => void runAnalyze()}
            data-testid="analyze-btn"
          >
            {busy ? '复核中…' : '提交复核'}
          </button>
          {points.length === 0 && (
            <p className="hint">请先上传 JSON 或载入示例。</p>
          )}

          {errorState?.kind === 'transport' && (
            <div className="banner reject" data-testid="transport-error">
              {errorState.message}
            </div>
          )}

          {errorState?.kind === 'validation' && (
            <div className="errors-box" data-testid="error-list">
              <div className="banner reject">
                422 校验未通过，共 {errorState.errors.length} 项错误；页面不绘制拟合线
              </div>
              <ul>
                {errorState.errors.map((err, k) => (
                  <li key={k}>
                    <code className="ptr">{err.loc === '' ? '（根）' : err.loc}</code>
                    <span>{err.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            <div
              className={`banner ${result.accepted ? 'accept' : 'reject'}`}
              data-testid="verdict"
            >
              {result.accepted
                ? '放行：该螺栓满足全部复核条件'
                : '拒绝：未通过放行判定（早屈服或斜率异常风险）'}
            </div>
          )}
        </section>

        <section className="panel chart-panel" aria-label="曲线区">
          <Chart points={points} result={result} />
        </section>

        {result && (
          <section className="panel result-panel" aria-label="结果区" data-testid="result">
            <h2>复核结果（数值与 API 完全一致）</h2>
            <div className="result-grid">
              <div><span className="k">i（二段首点）</span><span className="v">{result.i}</span></div>
              <div><span className="k">j（三段首点）</span><span className="v">{result.j}</span></div>
              <div><span className="k">屈服比 b3/b2</span><span className="v">{result.yield_ratio ?? '—'}</span></div>
              <div><span className="k">总残差</span><span className="v">{result.total_residual}</span></div>
            </div>

            <table className="seg-table">
              <thead>
                <tr>
                  <th>区段</th>
                  <th>点下标</th>
                  <th>斜率 b</th>
                  <th>截距</th>
                  <th>段残差</th>
                </tr>
              </thead>
              <tbody>
                {result.segments.map((seg, k) => (
                  <tr key={k}>
                    <td>{['空转', '弹性拉伸', '屈服'][k]}</td>
                    <td>[{seg.start}, {seg.end})</td>
                    <td data-testid={`slope-${k}`}>{seg.slope}</td>
                    <td>{seg.intercept}</td>
                    <td data-testid={`residual-${k}`}>{seg.residual}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="check-list">
              <li className={result.checks.b2_nonzero ? 'ok' : 'bad'}>
                b2 ≠ 0（否则直接拒绝）
              </li>
              <li className={result.checks.b1_lt_b2 ? 'ok' : 'bad'}>
                b1 &lt; b2（空转斜率低于弹性段）
              </li>
              <li className={result.checks.b3_lt_b2 ? 'ok' : 'bad'}>
                b3 &lt; b2（屈服段斜率回落）
              </li>
              <li className={result.checks.slope_in_range ? 'ok' : 'bad'}>
                b2 ∈ [{result.threshold.slope_min}, {result.threshold.slope_max}]
              </li>
              <li className={result.checks.yield_ratio_ok ? 'ok' : 'bad'}>
                0 ≤ b3/b2 ≤ {result.threshold.yield_ratio_max}
              </li>
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
