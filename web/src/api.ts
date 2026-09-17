import type { AnalyzeRequest, AnalyzeResponse, ApiError } from './types';

/** 422 校验失败：携带后端按 JSON Pointer 列出的全部错误。 */
export class ApiValidationError extends Error {
  constructor(readonly errors: ApiError[]) {
    super('校验未通过');
    this.name = 'ApiValidationError';
  }
}

export async function analyzeCurve(
  payload: AnalyzeRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<AnalyzeResponse> {
  let response: Response;
  try {
    response = await fetchImpl('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('无法连接复核服务，请检查 API 是否可用');
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // 响应体非 JSON，按通用错误处理
  }

  if (response.status === 422) {
    const errors = isApiErrors(data)
      ? (data as { errors: ApiError[] }).errors
      : [{ loc: '', message: '请求被拒绝（422）' }];
    throw new ApiValidationError(errors);
  }
  if (!response.ok) {
    throw new Error(`复核服务返回 ${response.status}`);
  }
  return data as AnalyzeResponse;
}

function isApiErrors(data: unknown): data is { errors: ApiError[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { errors?: unknown }).errors)
  );
}
