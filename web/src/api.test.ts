import { describe, expect, it, vi } from 'vitest';
import { analyzeCurve, ApiValidationError } from './api';

const validResponse = {
  i: 8,
  j: 16,
  segments: [],
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

const payload = {
  curve: { points: [{ angle: 0, torque: 0 }] },
  threshold: { slope_min: '0.1', slope_max: '10', yield_ratio_max: '0.5' },
};

describe('analyzeCurve', () => {
  it('成功时返回 JSON 结果', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const data = await analyzeCurve(payload, fetchMock);
    expect(data.i).toBe(8);
    expect(data.accepted).toBe(true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toContain('"angle":0');
  });

  it('422 时抛出含全部 JSON Pointer 错误的 ApiValidationError', async () => {
    const body = {
      errors: [
        { loc: '/curve/points/3/angle', message: 'angle 必须严格递增' },
        { loc: '/threshold/slope_min', message: '斜率区间下界必须为正' },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(body), { status: 422 }),
    );
    await expect(analyzeCurve(payload, fetchMock)).rejects.toMatchObject({
      name: 'ApiValidationError',
    });

    try {
      await analyzeCurve(payload, fetchMock);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiValidationError);
      expect((err as ApiValidationError).errors).toHaveLength(2);
      expect((err as ApiValidationError).errors[0].loc).toMatch(/^\/curve\//);
    }
  });

  it('网络失败时给出可读错误', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      analyzeCurve(payload, fetchMock),
    ).rejects.toThrow(/无法连接/);
  });
});
