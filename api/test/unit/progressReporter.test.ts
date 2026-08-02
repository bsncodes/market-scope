import { expect } from 'chai';
import { ProgressReporter } from '../../src/helpers/progressReporter';
import type { DiscoveryProgress } from '../../src/types/discovery';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Captures what would have been written, so no database is involved. */
function recorder() {
  const writes: DiscoveryProgress[] = [];
  const write = async (_id: number, progress: DiscoveryProgress) => {
    writes.push({ ...progress });
  };
  return { writes, write };
}

describe('ProgressReporter', () => {
  it('starts every counter at zero', () => {
    const { write } = recorder();
    const snapshot = new ProgressReporter(1, write, 0).snapshot();

    expect(snapshot.tilesTotal).to.equal(0);
    expect(snapshot.tilesFetched).to.equal(0);
    expect(snapshot.geocodeCandidates).to.equal(0);
    expect(snapshot.discoveredInBoundary).to.equal(0);
  });

  it('increments and sets counters', () => {
    const { write } = recorder();
    const reporter = new ProgressReporter(1, write, 0);

    reporter.set({ tilesTotal: 9 });
    reporter.increment('tilesFetched');
    reporter.increment('tilesFetched');
    reporter.increment('tilesReused', 3);

    const snapshot = reporter.snapshot();
    expect(snapshot.tilesTotal).to.equal(9);
    expect(snapshot.tilesFetched).to.equal(2);
    expect(snapshot.tilesReused).to.equal(3);
  });

  // Otherwise a caller could mutate the counters behind the reporter's back.
  it('returns a copy, not the live object', () => {
    const { write } = recorder();
    const reporter = new ProgressReporter(1, write, 0);

    const snapshot = reporter.snapshot();
    snapshot.tilesFetched = 999;

    expect(reporter.snapshot().tilesFetched).to.equal(0);
  });

  describe('throttling', () => {
    it('flush always writes', async () => {
      const { writes, write } = recorder();
      const reporter = new ProgressReporter(1, write, 60_000);

      await reporter.flush();
      await reporter.flush();

      expect(writes.length).to.equal(2);
    });

    // The status endpoint is polled every ~10s, so a write per tile costs
    // updates without telling anyone anything sooner.
    it('flushIfDue suppresses writes inside the interval', async () => {
      const { writes, write } = recorder();
      const reporter = new ProgressReporter(1, write, 60_000);

      for (let i = 0; i < 50; i += 1) {
        reporter.increment('tilesFetched');
        await reporter.flushIfDue();
      }

      expect(writes.length).to.equal(0);
    });

    it('flushIfDue writes once the interval has passed', async () => {
      const { writes, write } = recorder();
      const reporter = new ProgressReporter(1, write, 20);

      await reporter.flushIfDue();
      expect(writes.length).to.equal(0);

      await sleep(30);
      await reporter.flushIfDue();
      expect(writes.length).to.equal(1);
    });

    it('flush resets the interval so the next flushIfDue is suppressed', async () => {
      const { writes, write } = recorder();
      const reporter = new ProgressReporter(1, write, 60_000);

      await reporter.flush();
      await reporter.flushIfDue();

      expect(writes.length).to.equal(1);
    });
  });

  it('writes the counters as they stood at that moment', async () => {
    const { writes, write } = recorder();
    const reporter = new ProgressReporter(1, write, 0);

    reporter.increment('tilesFetched');
    await reporter.flush();
    reporter.increment('tilesFetched');
    await reporter.flush();

    expect(writes.map((w) => w.tilesFetched)).to.deep.equal([1, 2]);
  });
});
