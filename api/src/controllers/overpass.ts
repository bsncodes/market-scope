import { config } from '../config';
import {
  buildOverpassQuery,
  parseOverpassResponse,
  type OverpassResponse,
} from '../helpers/overpass';
import { RateLimiter } from '../helpers/rateLimiter';
import { HttpError, http } from '../http';
import type { Bbox, DiscoveredStore, OsmTag } from '../types/discovery';

const USER_AGENT = 'MarketScope/1.0 (take-home project)';

// One shared limiter PER PROCESS. This holds only while the worker runs a
// single job at a time: raising `concurrency` in worker.ts, or running a
// second worker replica, multiplies the real request rate by that factor and
// silently breaches fair use. Scaling out needs a Redis-backed bucket so the
// budget is shared rather than duplicated.
const limiter = new RateLimiter(
  config.overpassRatePerSecond,
  config.overpassBurst,
);

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Honoured verbatim when the server named a wait, from `Retry-After`. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'OverpassError';
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries in place rather than letting the failure propagate to BullMQ.
 * A tile failure is isolated by design — the surrounding loop records it and
 * carries on — so it never reaches the queue's retry machinery. Without a
 * retry here, a single transient 503 would leave a permanent hole in the
 * market that only creating a new market could fill.
 *
 * Only retryable failures are repeated: a 400 means the query itself is wrong
 * and every attempt would fail identically, wasting fair-use budget.
 */
export async function fetchStoresInBbox(
  bbox: Bbox,
  tags: OsmTag[],
): Promise<DiscoveredStore[]> {
  const attempts = Math.max(1, config.overpassTileAttempts);

  // Bounded in the header rather than only by a throw inside the catch, so the
  // loop is verifiably finite against a rate-limited service at a glance.
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchOnce(bbox, tags);
    } catch (err) {
      const failure =
        err instanceof OverpassError
          ? err
          : new OverpassError(String(err), false);

      if (!failure.retryable || attempt === attempts) throw failure;
      await sleep(backoffMs(failure, attempt));
    }
  }

  // Unreachable: the final attempt always returns or throws above. Present
  // because a bounded loop header cannot prove that to the compiler, which is
  // the trade for making the bound checkable by a reader.
  throw new OverpassError('Overpass retries exhausted', false);
}

/**
 * The server's own `Retry-After` wins when it sent one: retrying a 429 after a
 * locally-chosen delay is how one rate-limit response becomes a run of them.
 *
 * Otherwise the wait doubles per attempt, with jitter. A fixed delay makes
 * every tile that failed in the same bad window retry in the same instant,
 * recreating the burst that caused the failure — jitter spreads them out.
 */
function backoffMs(failure: OverpassError, attempt: number): number {
  if (failure.retryAfterMs !== undefined) {
    return Math.min(failure.retryAfterMs, config.overpassMaxBackoffMs);
  }

  const exponential = config.overpassTileRetryDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, config.overpassMaxBackoffMs);
  return capped * (0.5 + Math.random() * 0.5);
}

async function fetchOnce(
  bbox: Bbox,
  tags: OsmTag[],
): Promise<DiscoveredStore[]> {
  const query = buildOverpassQuery(
    bbox,
    tags,
    config.overpassTimeoutSeconds,
    config.overpassElementTypes,
  );

  const response = await limiter.schedule(async () => {
    try {
      return await http.post<OverpassResponse>('', query, {
        baseUrl: config.overpassBaseUrl,
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'text/plain',
        },
        // Overpass is asked for a server-side budget above; allow for it to
        // use that budget plus transfer time before giving up locally.
        timeoutMs: (config.overpassTimeoutSeconds + 15) * 1000,
      });
    } catch (err) {
      throw toOverpassError(err);
    }
  });

  return parseOverpassResponse(response, tags);
}

/**
 * Separates failures worth retrying from ones that will never succeed. 429 and
 * 504 are how Overpass signals "too busy, come back", which is exactly the
 * case backoff exists for; a 400 means the query itself is wrong and retrying
 * only wastes the fair-use budget.
 */
function toOverpassError(err: unknown): OverpassError {
  if (!(err instanceof HttpError)) {
    return new OverpassError(String(err), false);
  }

  if (err.status === null) {
    return new OverpassError(`Overpass unreachable: ${err.message}`, true);
  }

  const retryable = err.status === 429 || err.status >= 500;
  return new OverpassError(
    `Overpass responded ${err.status}${retryable ? ' (retryable)' : ''}`,
    retryable,
    err.retryAfterMs,
  );
}
