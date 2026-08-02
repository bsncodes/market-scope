import { emptyProgress, type DiscoveryProgress } from '../types/discovery';

type CounterKey = {
  [K in keyof DiscoveryProgress]: DiscoveryProgress[K] extends number
    ? K
    : never;
}[keyof DiscoveryProgress];

export type ProgressWriter = (
  marketId: number,
  progress: DiscoveryProgress,
) => Promise<void>;

/**
 * Owns the progress counters for one discovery run and decides when they reach
 * the database.
 *
 * Stages report through this rather than mutating a shared object: the counters
 * have one owner, and the throttling policy lives in one place instead of being
 * re-implemented inside each loop.
 *
 * The writer is injected so the throttling can be tested without a database.
 */
export class ProgressReporter {
  private readonly progress = emptyProgress();
  private lastWriteAt = Date.now();

  constructor(
    private readonly marketId: number,
    private readonly write: ProgressWriter,
    private readonly intervalMs: number,
  ) {}

  set(patch: Partial<DiscoveryProgress>): void {
    Object.assign(this.progress, patch);
  }

  increment(key: CounterKey, by = 1): void {
    this.progress[key] += by;
  }

  /** A copy, so a caller cannot mutate the counters behind this object's back. */
  snapshot(): DiscoveryProgress {
    return { ...this.progress };
  }

  async flush(): Promise<void> {
    this.lastWriteAt = Date.now();
    await this.write(this.marketId, this.progress);
  }

  /**
   * The status endpoint is polled every ~10s, so writing on every tile costs
   * updates without anyone learning anything sooner.
   */
  async flushIfDue(): Promise<void> {
    if (Date.now() - this.lastWriteAt < this.intervalMs) return;
    await this.flush();
  }
}
