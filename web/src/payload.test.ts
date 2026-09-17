import { describe, expect, it } from 'vitest';
import { buildSample, extractName, extractRawPoints, extractThreshold } from './payload';

describe('payload helpers', () => {
  it('仅提取整数合法点，非法点被丢弃（由后端 422 报错）', () => {
    const json = {
      curve: {
        name: 'T-9',
        points: [
          { angle: 0, torque: 1 },
          { angle: 5, torque: 2.5 },
          { angle: 5, torque: 3 },
          { angle: 'x', torque: 4 },
          { angle: 10, torque: -1 },
          { angle: 15, torque: 6 },
          true,
        ],
      },
      threshold: { slope_min: '0.1', slope_max: 9, yield_ratio_max: '0.5' },
    };
    expect(extractRawPoints(json)).toEqual([
      { angle: 0, torque: 1 },
      { angle: 5, torque: 3 },
      { angle: 15, torque: 6 },
    ]);
    expect(extractThreshold(json)).toEqual({ slope_min: '0.1', yield_ratio_max: '0.5' });
    expect(extractName(json)).toBe('T-9');
  });

  it('内置示例为 24 点三段线性数据', () => {
    const s = buildSample();
    expect(s.points).toHaveLength(24);
    const angles = s.points.map((p) => p.angle);
    expect(angles.every((a, k) => k === 0 || a > angles[k - 1])).toBe(true);
    expect(s.threshold.slope_min).toBe('0.1');
    expect(JSON.parse(s.text).curve.points).toHaveLength(24);
  });
});
