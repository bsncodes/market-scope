import { expect } from 'chai';
import { RateLimiter, TokenBucket } from '../../src/helpers/rateLimiter';

const elapsed = async (fn: () => Promise<unknown>): Promise<number> => {
  const started = Date.now();
  await fn();
  return Date.now() - started;
};

describe('TokenBucket', () => {
  describe('construction', () => {
    it('rejects a non-positive capacity or refill rate', () => {
      expect(() => new TokenBucket(0, 1)).to.throw(/capacity/);
      expect(() => new TokenBucket(-1, 1)).to.throw(/capacity/);
      expect(() => new TokenBucket(1, 0)).to.throw(/refillPerSecond/);
    });

    it('starts full so the first calls are not delayed', () => {
      expect(new TokenBucket(5, 1).available).to.be.closeTo(5, 0.01);
    });
  });

  describe('burst', () => {
    // The point of a bucket over a fixed gap: a short burst runs immediately.
    it('allows capacity calls with no waiting', async () => {
      const bucket = new TokenBucket(5, 1);
      const took = await elapsed(async () => {
        for (let i = 0; i < 5; i += 1) await bucket.acquire();
      });
      expect(took).to.be.lessThan(50);
    });

    it('spends a token per acquire', async () => {
      const bucket = new TokenBucket(3, 1);
      await bucket.acquire();
      await bucket.acquire();
      expect(bucket.available).to.be.closeTo(1, 0.05);
    });
  });

  describe('throttling', () => {
    it('makes the call past capacity wait for a refill', async () => {
      // 20 tokens/sec means one becomes available roughly every 50ms.
      const bucket = new TokenBucket(1, 20);
      await bucket.acquire();

      const took = await elapsed(() => bucket.acquire());
      expect(took).to.be.greaterThan(30);
      expect(took).to.be.lessThan(250);
    });

    it('sustains the configured rate once the burst is spent', async () => {
      const bucket = new TokenBucket(2, 50);
      const took = await elapsed(async () => {
        // 2 burst + 4 throttled at ~20ms each.
        for (let i = 0; i < 6; i += 1) await bucket.acquire();
      });
      expect(took).to.be.greaterThan(50);
      expect(took).to.be.lessThan(500);
    });
  });

  describe('refill', () => {
    it('accrues tokens while idle', async () => {
      const bucket = new TokenBucket(10, 50);
      await bucket.acquire();
      await bucket.acquire();

      await new Promise((r) => setTimeout(r, 60));
      expect(bucket.available).to.be.greaterThan(8.5);
    });

    // Otherwise a long idle period would bank unlimited tokens and the next
    // burst would breach the provider's limit outright.
    it('never accrues beyond capacity', async () => {
      const bucket = new TokenBucket(2, 1000);
      await new Promise((r) => setTimeout(r, 50));
      expect(bucket.available).to.be.closeTo(2, 0.01);
    });
  });

  describe('fairness', () => {
    // Without a queue every blocked caller wakes on the same timer and races
    // for one token, so the earliest request can be starved indefinitely.
    it('serves waiters in arrival order', async () => {
      const bucket = new TokenBucket(1, 40);
      const order: number[] = [];

      await bucket.acquire();
      await Promise.all(
        [1, 2, 3, 4].map(async (n) => {
          await bucket.acquire();
          order.push(n);
        }),
      );

      expect(order).to.deep.equal([1, 2, 3, 4]);
    });
  });
});

describe('RateLimiter', () => {
  it('returns the task result', async () => {
    const limiter = new RateLimiter(1000, 5);
    expect(await limiter.schedule(async () => 'done')).to.equal('done');
  });

  it('propagates a task failure to the caller', async () => {
    const limiter = new RateLimiter(1000, 5);
    let rejected = false;
    try {
      await limiter.schedule(async () => {
        throw new Error('task blew up');
      });
    } catch (err) {
      rejected = true;
      expect((err as Error).message).to.equal('task blew up');
    }
    expect(rejected).to.equal(true);
  });

  // One failing call must not wedge everything queued behind it.
  it('keeps working after a task fails', async () => {
    const limiter = new RateLimiter(1000, 5);
    await limiter
      .schedule(async () => {
        throw new Error('first fails');
      })
      .catch(() => undefined);

    expect(await limiter.schedule(async () => 'still works')).to.equal(
      'still works',
    );
  });

  it('throttles scheduled tasks, not just token handout', async () => {
    const limiter = new RateLimiter(20, 1);
    await limiter.schedule(async () => undefined);

    const took = await elapsed(() => limiter.schedule(async () => undefined));
    expect(took).to.be.greaterThan(30);
  });
});
