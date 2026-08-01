import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../src/server';

let server: Server | undefined;
let baseUrl: string | undefined;

/** Boots the real Express app on an ephemeral port, once per test run. */
export async function startTestServer(): Promise<string> {
  if (baseUrl) return baseUrl;

  server = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', resolve);
    server!.once('error', reject);
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server!.close((err) => (err ? reject(err) : resolve())),
  );
  server = undefined;
  baseUrl = undefined;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

async function toResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as T) : (undefined as T),
  };
}

export async function apiGet<T = unknown>(
  path: string,
): Promise<ApiResponse<T>> {
  const url = await startTestServer();
  return toResponse<T>(await fetch(`${url}${path}`));
}

/** Multipart upload via the platform FormData/Blob, so no HTTP test library. */
export async function apiUpload<T = unknown>(
  path: string,
  file: Buffer,
  filename = 'portfolio.csv',
  contentType = 'text/csv',
): Promise<ApiResponse<T>> {
  const url = await startTestServer();
  const form = new FormData();
  form.append('file', new Blob([file], { type: contentType }), filename);
  return toResponse<T>(
    await fetch(`${url}${path}`, { method: 'POST', body: form }),
  );
}

export async function apiPost<T = unknown>(
  path: string,
): Promise<ApiResponse<T>> {
  const url = await startTestServer();
  return toResponse<T>(await fetch(`${url}${path}`, { method: 'POST' }));
}
