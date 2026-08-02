import http from 'node:http';

export interface StubStore {
  type?: 'node' | 'way' | 'relation';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

type Responder = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void;

/**
 * Stands in for Overpass. Counting requests is the point: proving that an
 * overlapping market reuses cached tiles is only meaningful if we can show the
 * second run made fewer calls.
 */
class OverpassStub {
  private server?: http.Server;
  private responder: Responder = respondWithStores([]);

  requestCount = 0;
  queries: string[] = [];

  async start(port: number): Promise<void> {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        this.requestCount += 1;
        this.queries.push(body);
        this.responder(req, res, body);
      });
    });

    await new Promise<void>((resolve) =>
      this.server!.listen(port, '127.0.0.1', resolve),
    );
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
    this.queries = [];
    this.responder = respondWithStores([]);
  }

  respondWith(responder: Responder): void {
    this.responder = responder;
  }
}

export function respondWithStores(stores: StubStore[]): Responder {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        elements: stores.map((store) => ({
          type: store.type ?? 'node',
          id: store.id,
          lat: store.lat,
          lon: store.lon,
          tags: store.tags ?? { name: `Store ${store.id}` },
        })),
      }),
    );
  };
}

/** Only returns stores that fall inside the requested tile's bbox. */
export function respondWithStoresInBbox(stores: StubStore[]): Responder {
  return (_req, res, body) => {
    const match = body.match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
    const [minLat, minLng, maxLat, maxLng] = match
      ? match.slice(1).map(Number)
      : [-90, -180, 90, 180];

    const inside = stores.filter(
      (s) =>
        s.lat >= minLat && s.lat < maxLat && s.lon >= minLng && s.lon < maxLng,
    );
    respondWithStores(inside)(_req, res, body);
  };
}

export const respondWithServerError: Responder = (_req, res) => {
  res.writeHead(503);
  res.end('overpass unavailable');
};

/** 429 with the wait the server wants, which the retry loop must honour. */
export function respondWithRateLimit(retryAfterSeconds: number): Responder {
  return (_req, res) => {
    res.writeHead(429, { 'retry-after': String(retryAfterSeconds) });
    res.end('too many requests');
  };
}

export const respondWithBadRequest: Responder = (_req, res) => {
  res.writeHead(400);
  res.end('bad query');
};

export const overpassStub = new OverpassStub();
