import axios, { AxiosError, type Method } from 'axios';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Transport-level failure. `status` is null when the request never produced a
 * response at all — DNS failure, connection refused, timeout — which callers
 * usually want to treat differently from a 4xx/5xx.
 */
export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
    readonly body?: unknown,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'HttpError';
  }
}

export interface HttpOptions {
  baseUrl?: string;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

async function request<T>(
  method: Method,
  url: string,
  data: unknown,
  options: HttpOptions = {},
): Promise<T> {
  try {
    const response = await axios.request<T>({
      method,
      url,
      data,
      baseURL: options.baseUrl,
      params: options.params,
      headers: options.headers,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return response.data;
  } catch (err) {
    throw toHttpError(err, url);
  }
}

function toHttpError(err: unknown, url: string): HttpError {
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? null;
    const detail = status === null ? err.message : `responded ${status}`;
    return new HttpError(
      url,
      status,
      `Request to ${url} failed: ${detail}`,
      err.response?.data,
      err,
    );
  }
  return new HttpError(
    url,
    null,
    `Request to ${url} failed: ${String(err)}`,
    undefined,
    err,
  );
}

// The only HTTP entry point for the app. Controllers call these rather than
// axios directly, so timeouts, error shape and instrumentation stay in one
// place.
export const http = {
  get: <T>(url: string, options?: HttpOptions) =>
    request<T>('get', url, undefined, options),

  post: <T>(url: string, data?: unknown, options?: HttpOptions) =>
    request<T>('post', url, data, options),

  put: <T>(url: string, data?: unknown, options?: HttpOptions) =>
    request<T>('put', url, data, options),

  patch: <T>(url: string, data?: unknown, options?: HttpOptions) =>
    request<T>('patch', url, data, options),

  delete: <T>(url: string, options?: HttpOptions) =>
    request<T>('delete', url, undefined, options),
};
