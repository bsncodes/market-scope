const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

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
  const body = text ? JSON.parse(text) : undefined;

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

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    // A network-level failure has no envelope to unwrap, and "failed to fetch"
    // tells a user nothing about what to do.
    throw new ApiError(
      0,
      'NETWORK_UNREACHABLE',
      'Could not reach the MarketScope API. Check that it is running.',
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
