const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

// Generous enough for a city bbox that misses the cache and falls through to
// Nominatim, short enough that a dead API is reported rather than waited on.
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Mirrors the API's `{ error: { code, message, details } }` envelope so screens
 * can show the server's own message instead of a generic failure, and can read
 * `details` when there is something structured to render (per-row CSV errors).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

async function toResult<T>(res: Response): Promise<T> {
  const text = await res.text();

  // A proxy or dev-server error page is served as HTML with any status. Letting
  // JSON.parse throw would surface to the user as "Unexpected token '<'", which
  // says nothing about what went wrong or what to do.
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(
      res.status,
      'MALFORMED_RESPONSE',
      `The API returned a ${res.status} that was not JSON. Check that ${BASE_URL} is the MarketScope API.`,
    );
  }

  if (!res.ok) {
    const envelope = (body ?? {}) as ErrorEnvelope;
    throw new ApiError(
      res.status,
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? `Request failed with status ${res.status}.`,
      envelope.error?.details,
    );
  }
  return body as T;
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      // Without this a stalled API never settles the promise, and the caller
      // waits forever — on the status screen that is a spinner with no error
      // and no way out, which is precisely the state this app set out to avoid.
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    throw new ApiError(
      0,
      timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_UNREACHABLE',
      timedOut
        ? `The API did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
        : 'Could not reach the MarketScope API. Check that it is running.',
    );
  }
  return toResult<T>(res);
}

export const get = <T>(path: string) => send<T>(path);

export const postJson = <T>(path: string, body: unknown) =>
  send<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export function postFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  // No Content-Type header: the browser has to set the multipart boundary.
  return send<T>(path, { method: 'POST', body: form });
}
