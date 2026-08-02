import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, get } from '../src/api/client';

const respond = (body: string, init: ResponseInit = {}) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, init)));

const catchError = async (run: () => Promise<unknown>): Promise<ApiError> => {
  try {
    await run();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected the call to reject');
};

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the parsed body on success', async () => {
    respond(JSON.stringify({ total: 112 }));
    expect(await get('/portfolio/summary')).to.deep.equal({ total: 112 });
  });

  it('unwraps the API error envelope', async () => {
    respond(
      JSON.stringify({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'No market with id 9.',
          details: { id: 9 },
        },
      }),
      { status: 404 },
    );

    const err = await catchError(() => get('/markets/9'));
    expect(err.status).to.equal(404);
    expect(err.code).to.equal('RESOURCE_NOT_FOUND');
    expect(err.message).to.equal('No market with id 9.');
    expect(err.details).to.deep.equal({ id: 9 });
  });

  it('falls back to a usable message when there is no envelope', async () => {
    respond('{}', { status: 500 });

    const err = await catchError(() => get('/markets'));
    expect(err.code).to.equal('UNKNOWN');
    expect(err.message).to.contain('500');
  });

  // A proxy or dev-server error page is HTML with any status. Letting
  // JSON.parse throw surfaced to the user as "Unexpected token '<'".
  it('reports a non-JSON response as such, not as a parse error', async () => {
    respond('<!doctype html><title>502 Bad Gateway</title>', { status: 502 });

    const err = await catchError(() => get('/markets'));
    expect(err.code).to.equal('MALFORMED_RESPONSE');
    expect(err.message).to.not.contain('Unexpected token');
  });

  it('turns an unreachable API into an actionable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const err = await catchError(() => get('/markets'));
    expect(err.code).to.equal('NETWORK_UNREACHABLE');
    expect(err.message).to.contain('Check that it is running');
  });

  // Without a timeout the promise never settles, and the status screen shows a
  // spinner with no error and no way out.
  it('reports a timeout rather than hanging forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new DOMException('The operation timed out.', 'TimeoutError'),
        ),
    );

    const err = await catchError(() => get('/markets'));
    expect(err.code).to.equal('REQUEST_TIMEOUT');
    expect(err.message).to.match(/did not respond within \d+ seconds/);
  });

  it('sends an abort signal so a stalled request can be cut off', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await get('/markets');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).to.be.instanceOf(AbortSignal);
  });

  // 204 cannot carry a body through the Response constructor, so this covers
  // the realistic shape: a 200 that simply returned nothing.
  it('treats an empty body as undefined rather than failing to parse', async () => {
    respond('', { status: 200 });
    expect(await get('/whatever')).to.equal(undefined);
  });
});
