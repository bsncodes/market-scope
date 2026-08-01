import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubBoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

type Responder = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/**
 * Stands in for Nominatim so tests never touch the real service. Counting
 * requests is the point: proving the bbox cache avoids a second call is only
 * meaningful if we can see that no call happened.
 */
class NominatimStub {
  private server?: http.Server;
  private responder: Responder = respondWithBox({
    south: 12.8,
    north: 13.1,
    west: 77.4,
    east: 77.8,
  });

  requestCount = 0;
  lastQuery: string | null = null;

  // Fixed port rather than 0: mocha imports every spec file — and therefore
  // config.ts, which reads NOMINATIM_BASE_URL — before root hooks run, so the
  // URL has to be known at setup time rather than discovered on listen.
  async start(port: number): Promise<number> {
    this.server = http.createServer((req, res) => {
      this.requestCount += 1;
      this.lastQuery = new URL(
        req.url ?? '/',
        'http://localhost',
      ).searchParams.get('q');
      this.responder(req, res);
    });

    await new Promise<void>((resolve) =>
      this.server!.listen(port, '127.0.0.1', resolve),
    );
    return (this.server!.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((err) => (err ? reject(err) : resolve())),
    );
    this.server = undefined;
  }

  reset(): void {
    this.requestCount = 0;
    this.lastQuery = null;
    this.respondWith(
      respondWithBox({ south: 12.8, north: 13.1, west: 77.4, east: 77.8 }),
    );
  }

  respondWith(responder: Responder): void {
    this.responder = responder;
  }
}

export function respondWithBox(box: StubBoundingBox): Responder {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    // Nominatim's order is [south, north, west, east], not min/max lat/lng.
    res.end(
      JSON.stringify([
        {
          boundingbox: [
            String(box.south),
            String(box.north),
            String(box.west),
            String(box.east),
          ],
        },
      ]),
    );
  };
}

export const respondWithNoResults: Responder = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('[]');
};

export const respondWithServerError: Responder = (_req, res) => {
  res.writeHead(503);
  res.end('service unavailable');
};

export const respondWithMalformedBox: Responder = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify([{ boundingbox: ['x', 'y', 'z', 'w'] }]));
};

export const nominatimStub = new NominatimStub();
