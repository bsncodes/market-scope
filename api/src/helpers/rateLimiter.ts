const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Serialises calls to one external service and keeps a minimum gap between
 * them. Both Nominatim and Overpass publish fair-use limits that a worker
 * looping over tiles would otherwise blow straight through.
 *
 * Deliberately serial rather than a concurrent token bucket: the work is
 * throughput-insensitive (it runs on a queue, off the request path) and a
 * single ordered chain is far easier to reason about than parallel workers
 * competing for tokens.
 */
export class RateLimiter {
  private chain: Promise<unknown> = Promise.resolve();
  private lastStartedAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const elapsed = Date.now() - this.lastStartedAt;
      const wait = this.minIntervalMs - elapsed;
      if (wait > 0) await sleep(wait);
      this.lastStartedAt = Date.now();
      return task();
    });

    // The chain must survive a rejected task, otherwise one failure would
    // wedge every later call behind it.
    this.chain = result.catch(() => undefined);
    return result;
  }
}
