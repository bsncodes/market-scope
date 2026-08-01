const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Token bucket: `capacity` tokens are available at once and refill at
 * `refillPerSecond`. A caller takes one token per request and waits when the
 * bucket is empty.
 *
 * Chosen over a fixed gap between calls because it separates the two limits
 * that actually matter. Sustained rate is what a provider's fair-use policy
 * caps, while a short burst — the first few tiles of a market — is harmless
 * and finishes noticeably faster. A fixed interval cannot express that: making
 * it small enough to allow the burst also raises the sustained rate.
 *
 * Waiters are served strictly FIFO. Without a queue every blocked caller would
 * wake on the same timer and race for one token, so the last request could be
 * starved indefinitely while newer ones barge ahead.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;
  private readonly waiters: Array<() => void> = [];
  private draining = false;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    if (!(capacity > 0)) {
      throw new Error(`capacity must be positive, got ${capacity}`);
    }
    if (!(refillPerSecond > 0)) {
      throw new Error(
        `refillPerSecond must be positive, got ${refillPerSecond}`,
      );
    }
    this.tokens = capacity;
    this.lastRefillAt = Date.now();
  }

  /** Tokens currently available, for tests and diagnostics. */
  get available(): number {
    this.refill();
    return this.tokens;
  }

  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      void this.drain();
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillAt) / 1000;
    if (elapsedSeconds <= 0) return;

    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefillAt = now;
  }

  // A single drain loop owns the queue, so tokens are handed out in arrival
  // order rather than to whichever waiter happens to wake first.
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.waiters.length > 0) {
        this.refill();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          this.waiters.shift()?.();
          continue;
        }

        const deficit = 1 - this.tokens;
        await sleep(Math.ceil((deficit / this.refillPerSecond) * 1000));
      }
    } finally {
      this.draining = false;
    }
  }
}

/**
 * Wraps a bucket so callers hand over a task rather than managing tokens.
 * One instance per external service: their limits are independent.
 */
export class RateLimiter {
  private readonly bucket: TokenBucket;

  constructor(refillPerSecond: number, burstCapacity: number) {
    this.bucket = new TokenBucket(burstCapacity, refillPerSecond);
  }

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    await this.bucket.acquire();
    return task();
  }
}
