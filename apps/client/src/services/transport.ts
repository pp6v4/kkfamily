import { API_BASE_URL } from './config';

interface ApiEnvelope<T> { data: T }
export type ApiMethod = NonNullable<UniApp.RequestOptions['method']> | 'PATCH';

function wireRequest(path: string, method: ApiMethod) {
  if (method !== 'PATCH') return { url: `${API_BASE_URL}${path}`, method };
  const queryIndex = path.indexOf('?');
  const pathname = queryIndex < 0 ? path : path.slice(0, queryIndex);
  const query = queryIndex < 0 ? '' : path.slice(queryIndex);
  return { url: `${API_BASE_URL}${pathname.replace(/\/$/, '')}/_patch${query}`, method: 'POST' as const };
}

function jsonBody(data: unknown): UniApp.RequestOptions['data'] {
  if (data === undefined || typeof data === 'string') return data;
  if (data !== null && typeof data === 'object') return data;
  return JSON.stringify(data);
}

function envelopeData<T>(data: unknown): T {
  if (!data || typeof data !== 'object' || !('data' in data)) throw new ApiError('服务器响应格式异常', 502);
  return (data as ApiEnvelope<T>).data;
}

export class ApiError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

export function rawRequest<T>(path: string, method: ApiMethod = 'GET', data?: unknown, headers: Record<string, string> = {}) {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      ...wireRequest(path, method),
      data: jsonBody(data),
      header: { 'content-type': 'application/json', ...headers },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try { resolve(envelopeData<T>(response.data)); } catch (error) { reject(error); }
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

export function rawBinaryRequest<T>(path:string,method:ApiMethod,data:ArrayBuffer,contentType:string,headers:Record<string,string>={}){
  return new Promise<T>((resolve,reject)=>{
    uni.request({...wireRequest(path,method),data,header:{'content-type':contentType,...headers},success(response){
      if(response.statusCode>=200&&response.statusCode<300){try{resolve(envelopeData<T>(response.data));}catch(error){reject(error);}return;}
      const body=response.data as unknown as {message?:string|string[]};const message=Array.isArray(body?.message)?body.message.join('；'):body?.message;
      reject(new ApiError(message||`请求失败（${response.statusCode}）`,response.statusCode));
    },fail(error){reject(new ApiError(error.errMsg||'网络连接失败',0));}});
  });
}
