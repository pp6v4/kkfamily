import { API_BASE_URL } from './config';

interface ApiEnvelope<T> { data: T }

export class ApiError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

export function rawRequest<T>(path: string, method: UniApp.RequestOptions['method'] = 'GET', data?: unknown, headers: Record<string, string> = {}) {
  return new Promise<T>((resolve, reject) => {
    uni.request<ApiEnvelope<T>>({
      url: `${API_BASE_URL}${path}`,
      method,
      data,
      header: { 'content-type': 'application/json', ...headers },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data.data);
          return;
        }
        const body = response.data as unknown as { message?: string | string[] };
        const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message;
        reject(new ApiError(message || `请求失败（${response.statusCode}）`, response.statusCode));
      },
      fail(error) { reject(new ApiError(error.errMsg || '网络连接失败', 0)); },
    });
  });
}
