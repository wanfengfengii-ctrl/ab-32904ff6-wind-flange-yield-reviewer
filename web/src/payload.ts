import type { Point, Threshold } from './types';

/** 从任意 JSON 中尽量提取合法点，供 422 时仍叠绘原始曲线（不画拟合线）。 */
export function extractRawPoints(json: unknown): Point[] {
  const raw = (json as { curve?: { points?: unknown } } | null)?.curve?.points;
  if (!Array.isArray(raw)) return [];
  const points: Point[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      Number.isInteger((item as Point).angle) &&
      Number.isInteger((item as Point).torque) &&
      (item as Point).torque >= 0
    ) {
      points.push({
        angle: (item as Point).angle,
        torque: (item as Point).torque,
      });
    }
  }
  return points;
}

/** 读取上传 JSON 中附带的阈值（不做合法性判断，交给后端 422）。 */
export function extractThreshold(json: unknown): Partial<Threshold> {
  const t = (json as { threshold?: unknown } | null)?.threshold;
  if (!t || typeof t !== 'object') return {};
  const obj = t as Record<string, unknown>;
  const out: Partial<Threshold> = {};
  for (const key of ['slope_min', 'slope_max', 'yield_ratio_max'] as const) {
    if (typeof obj[key] === 'string') out[key] = obj[key] as string;
  }
  return out;
}

export function extractName(json: unknown): string {
  const name = (json as { curve?: { name?: unknown } } | null)?.curve?.name;
  return typeof name === 'string' ? name : '';
}

/** 生成内置示例：空转 → 弹性拉伸 → 屈服，24 点严格线性。 */
export function buildSample(): {
  text: string;
  points: Point[];
  threshold: Threshold;
  name: string;
} {
  const points: Point[] = [];
  const slopes = [2, 5, 1];
  for (let k = 0; k < 24; k++) {
    const seg = k < 8 ? 0 : k < 16 ? 1 : 2;
    points.push({ angle: k * 10, torque: slopes[seg] * k * 10 + 5 });
  }
  const threshold: Threshold = {
    slope_min: '0.1',
    slope_max: '10',
    yield_ratio_max: '0.5',
  };
  const doc = {
    curve: { name: '示例螺栓 T-01', points },
    threshold,
  };
  return { text: JSON.stringify(doc, null, 2), points, threshold, name: doc.curve.name };
}
