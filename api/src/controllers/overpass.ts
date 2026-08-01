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

// One shared limiter per process: the worker loops over tiles, so without
// pacing a single market could fire dozens of requests back to back.
const limiter = new RateLimiter(config.overpassMinIntervalMs);

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OverpassError';
  }
}

export async function fetchStoresInBbox(
  bbox: Bbox,
  tags: OsmTag[],
): Promise<DiscoveredStore[]> {
  const query = buildOverpassQuery(bbox, tags, config.overpassTimeoutSeconds);

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
  );
}
