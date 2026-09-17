/** 与后端 /api/analyze 契约一致的类型定义。 */

export interface Point {
  /** 严格递增整数，单位：毫度 */
  angle: number;
  /** 非负整数，单位：毫牛·米 */
  torque: number;
}

export interface Threshold {
  /** 正的第二段斜率闭区间下界（至多 6 位小数十进制字符串） */
  slope_min: string;
  /** 闭区间上界 */
  slope_max: string;
  /** 屈服比上限，范围 [0, 1] */
  yield_ratio_max: string;
}

export interface AnalyzeRequest {
  curve: {
    name?: string;
    points: Point[];
  };
  threshold: Threshold;
}

export interface FitPoint {
  x: number;
  /** 后端四舍五入远离零至 6 位后的字符串，原样展示 */
  y: string;
}

export interface SegmentResult {
  start: number;
  end: number;
  slope: string;
  intercept: string;
  residual: string;
  fit: [FitPoint, FitPoint];
}

export interface Checks {
  b2_nonzero: boolean;
  b1_lt_b2: boolean;
  b3_lt_b2: boolean;
  slope_in_range: boolean;
  yield_ratio_ok: boolean;
}

export interface AnalyzeResponse {
  i: number;
  j: number;
  segments: SegmentResult[];
  slopes: [string, string, string];
  total_residual: string;
  yield_ratio: string | null;
  accepted: boolean;
  checks: Checks;
  threshold: Threshold;
}

export interface ApiError {
  /** RFC 6901 JSON Pointer，如 /curve/points/3/angle */
  loc: string;
  message: string;
}
