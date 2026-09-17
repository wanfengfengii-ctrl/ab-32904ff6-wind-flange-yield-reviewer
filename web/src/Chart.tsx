import { useMemo } from 'react';
import type { AnalyzeResponse, Point } from './types';

interface ChartProps {
  points: Point[];
  result: AnalyzeResponse | null;
}

const WIDTH = 920;
const HEIGHT = 440;
const PAD = { top: 32, right: 28, bottom: 56, left: 84 };

const SEG_COLORS = ['#d97706', '#059669', '#dc2626'];
const SEG_NAMES = ['第一段 · 空转', '第二段 · 弹性拉伸', '第三段 · 屈服'];

interface Scale {
  x: (v: number) => number;
  y: (v: number) => number;
}

function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min || 0];
  }
  const span = max - min;
  const rawStep = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

function formatTick(v: number): string {
  if (v !== 0 && Math.abs(v) >= 10000) return v.toExponential(1);
  return String(v);
}

export default function Chart({ points, result }: ChartProps) {
  const { scale, xTicks, yTicks } = useMemo(() => {
    if (points.length === 0) {
      return { scale: null, xTicks: [], yTicks: [] };
    }
    const xs = points.map((p) => p.angle);
    const ys = points.map((p) => p.torque);
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = 0;
    let maxY = Math.max(...ys);
    // 拟合线端点纳入值域，避免越界
    if (result) {
      for (const seg of result.segments) {
        for (const fp of seg.fit) {
          const fy = Number(fp.y);
          minY = Math.min(minY, fy);
          maxY = Math.max(maxY, fy);
        }
      }
    }
    if (minX === maxX) maxX += 1;
    if (minY === maxY) maxY += 1;
    const padY = (maxY - minY) * 0.06;
    maxY += padY;
    minY = Math.max(0, minY - padY);

    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const scale: Scale = {
      x: (v) => PAD.left + ((v - minX) / (maxX - minX)) * plotW,
      y: (v) => PAD.top + plotH - ((v - minY) / (maxY - minY)) * plotH,
    };
    return { scale, xTicks: niceTicks(minX, maxX), yTicks: niceTicks(minY, maxY) };
  }, [points, result]);

  if (points.length === 0) {
    return (
      <div className="chart-empty" data-testid="chart-empty">
        上传或选择示例后在此叠绘扳手曲线
      </div>
    );
  }

  const rawPath = points
    .map((p, k) => `${k === 0 ? 'M' : 'L'}${scale!.x(p.angle)},${scale!.y(p.torque)}`)
    .join(' ');

  const boundaryAngles = result
    ? [points[result.i]?.angle, points[result.j]?.angle].filter(
        (v): v is number => Number.isInteger(v),
      )
    : [];

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="扳手扭矩-角度曲线及分段拟合"
      data-testid="chart"
    >
      {/* 区段底色：在分界点处相接 */}
      {result &&
        result.segments.map((seg, k) => {
          const x0 = scale!.x(points[seg.start].angle);
          const lastAngle =
            k < result.segments.length - 1
              ? points[seg.end].angle
              : points[points.length - 1].angle;
          const x1 = scale!.x(lastAngle);
          return (
            <rect
              key={`bg-${k}`}
              x={x0}
              y={PAD.top}
              width={Math.max(0, x1 - x0)}
              height={HEIGHT - PAD.top - PAD.bottom}
              fill={SEG_COLORS[k]}
              opacity={0.05}
            />
          );
        })}

      {/* 网格与 Y 轴刻度 */}
      {yTicks.map((t) => (
        <g key={`y-${t}`}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={scale!.y(t)}
            y2={scale!.y(t)}
            className="grid"
          />
          <text x={PAD.left - 10} y={scale!.y(t) + 4} className="tick-label" textAnchor="end">
            {formatTick(t)}
          </text>
        </g>
      ))}
      {/* X 轴刻度 */}
      {xTicks.map((t) => (
        <g key={`x-${t}`}>
          <line
            x1={scale!.x(t)}
            x2={scale!.x(t)}
            y1={HEIGHT - PAD.bottom}
            y2={HEIGHT - PAD.bottom + 6}
            className="axis-line"
          />
          <text x={scale!.x(t)} y={HEIGHT - PAD.bottom + 22} className="tick-label" textAnchor="middle">
            {formatTick(t)}
          </text>
        </g>
      ))}

      {/* 坐标轴 */}
      <line
        x1={PAD.left}
        y1={HEIGHT - PAD.bottom}
        x2={WIDTH - PAD.right}
        y2={HEIGHT - PAD.bottom}
        className="axis-line"
      />
      <line
        x1={PAD.left}
        y1={PAD.top}
        x2={PAD.left}
        y2={HEIGHT - PAD.bottom}
        className="axis-line"
      />
      <text x={WIDTH / 2} y={HEIGHT - 8} className="axis-title" textAnchor="middle">
        angle（毫度）
      </text>
      <text
        x={20}
        y={HEIGHT / 2}
        className="axis-title"
        textAnchor="middle"
        transform={`rotate(-90 20 ${HEIGHT / 2})`}
      >
        torque（毫牛·米）
      </text>

      {/* 分段分界竖线（i、j） */}
      {boundaryAngles.map((angle, k) => (
        <g key={`boundary-${k}`} data-testid={`boundary-${k}`}>
          <line
            x1={scale!.x(angle)}
            x2={scale!.x(angle)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            className="boundary"
          />
          <text x={scale!.x(angle) + 4} y={PAD.top + 14} className="boundary-label">
            {k === 0 ? `i=${result!.i}` : `j=${result!.j}`}
          </text>
        </g>
      ))}

      {/* 原始曲线 */}
      <path d={rawPath} className="raw-line" data-testid="raw-line" />
      {points.map((p, k) => (
        <circle
          key={k}
          cx={scale!.x(p.angle)}
          cy={scale!.y(p.torque)}
          r={points.length > 200 ? 1.4 : 2.4}
          className="raw-dot"
        />
      ))}

      {/* 三段独立最小二乘拟合线（仅合法结果时绘制） */}
      {result?.segments.map((seg, k) => (
        <line
          key={`fit-${k}`}
          x1={scale!.x(seg.fit[0].x)}
          y1={scale!.y(Number(seg.fit[0].y))}
          x2={scale!.x(seg.fit[1].x)}
          y2={scale!.y(Number(seg.fit[1].y))}
          stroke={SEG_COLORS[k]}
          strokeWidth={2.4}
          data-testid={`fit-line-${k}`}
        />
      ))}

      {/* 图例 */}
      <g transform={`translate(${PAD.left + 12}, ${PAD.top + 8})`}>
        <rect
          x={-8}
          y={-8}
          width={210}
          height={result ? 92 : 26}
          rx={6}
          fill="white"
          opacity={0.85}
        />
        <g>
          <line x1={0} y1={6} x2={26} y2={6} className="raw-line" />
          <text x={34} y={10} className="legend-text">原始扳手曲线</text>
        </g>
        {result?.segments.map((_, k) => (
          <g key={`legend-${k}`} transform={`translate(0, ${22 + k * 22})`}>
            <line x1={0} y1={6} x2={26} y2={6} stroke={SEG_COLORS[k]} strokeWidth={2.4} />
            <text x={34} y={10} className="legend-text">{SEG_NAMES[k]}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
