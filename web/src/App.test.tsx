import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

function makePoints() {
  const pts: { angle: number; torque: number }[] = [];
  const slopes = [2, 5, 1];
  for (let k = 0; k < 24; k++) {
    const seg = k < 8 ? 0 : k < 16 ? 1 : 2;
    pts.push({ angle: k * 10, torque: slopes[seg] * k * 10 + 5 });
  }
  return pts;
}

const apiOk = {
  i: 8,
  j: 16,
  segments: [
    { start: 0, end: 8, slope: '2', intercept: '5', residual: '0',
      fit: [{ x: 0, y: '5' }, { x: 70, y: '145' }] },
    { start: 8, end: 16, slope: '5', intercept: '5', residual: '0',
      fit: [{ x: 80, y: '405' }, { x: 150, y: '755' }] },
    { start: 16, end: 24, slope: '1', intercept: '5', residual: '0',
      fit: [{ x: 160, y: '165' }, { x: 230, y: '235' }] },
  ],
  slopes: ['2', '5', '1'],
  total_residual: '0',
  yield_ratio: '0.2',
  accepted: true,
  checks: {
    b2_nonzero: true,
    b1_lt_b2: true,
    b3_lt_b2: true,
    slope_in_range: true,
    yield_ratio_ok: true,
  },
  threshold: { slope_min: '0.1', slope_max: '10', yield_ratio_max: '0.5' },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App 联调', () => {
  it('合法结果：显示与 API 一致的 i/j/斜率/残差，并叠绘分界与拟合线', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(apiOk), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByText('载入内置示例'));
    fireEvent.click(screen.getByTestId('analyze-btn'));

    const verdict = await screen.findByTestId('verdict');
    expect(verdict).toHaveTextContent('放行');
    const result = screen.getByTestId('result');
    expect(result).toHaveTextContent('8');
    expect(screen.getByTestId('slope-0')).toHaveTextContent('2');
    expect(screen.getByTestId('slope-1')).toHaveTextContent('5');
    expect(screen.getByTestId('slope-2')).toHaveTextContent('1');
    expect(result).toHaveTextContent('总残差');
    // SVG：原始曲线、两条分界、三条拟合线
    expect(screen.getByTestId('raw-line')).toBeInTheDocument();
    expect(screen.getByTestId('boundary-0')).toBeInTheDocument();
    expect(screen.getByTestId('boundary-1')).toBeInTheDocument();
    for (const k of [0, 1, 2]) {
      expect(screen.getByTestId(`fit-line-${k}`)).toBeInTheDocument();
    }
    // 发往后端的载荷字段
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.curve.points).toHaveLength(24);
    expect(body.threshold).toEqual(apiOk.threshold);
  });

  it('422：列出全部 JSON Pointer 错误，且不绘制任何拟合线', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            errors: [
              { loc: '/curve/points/1/angle', message: 'angle 必须严格递增' },
              { loc: '/threshold/slope_min', message: '斜率区间下界必须为正' },
            ],
          }),
          { status: 422 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    // 上传一份点合法、阈值非法（下界 0）的 JSON
    const file = new File(
      [JSON.stringify({
        curve: { name: 'bad', points: makePoints() },
        threshold: { slope_min: '0', slope_max: '10', yield_ratio_max: '0.5' },
      })],
      'bad.json',
      { type: 'application/json' },
    );
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('file-name')).toHaveTextContent('bad.json'));

    fireEvent.click(screen.getByTestId('analyze-btn'));

    const errList = await screen.findByTestId('error-list');
    expect(errList).toHaveTextContent('/curve/points/1/angle');
    expect(errList).toHaveTextContent('/threshold/slope_min');
    expect(errList).toHaveTextContent('422');
    // 原始曲线仍画，拟合线一律不画
    expect(screen.getByTestId('raw-line')).toBeInTheDocument();
    expect(screen.queryByTestId('fit-line-0')).toBeNull();
    expect(screen.queryByTestId('boundary-0')).toBeNull();
    expect(screen.queryByTestId('result')).toBeNull();
  });

  it('拒绝结果显示拒绝横幅（早屈服场景）', async () => {
    const rejected = {
      ...apiOk,
      accepted: false,
      checks: { ...apiOk.checks, yield_ratio_ok: false },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify(rejected), { status: 200 }),
      ),
    );
    render(<App />);
    fireEvent.click(screen.getByText('载入内置示例'));
    fireEvent.click(screen.getByTestId('analyze-btn'));
    const verdict = await screen.findByTestId('verdict');
    expect(verdict).toHaveTextContent('拒绝');
  });
});
