import { describe, expect, it } from 'vitest';
import { delayUntilNextRun } from '../src/lib/throttle';

describe('delayUntilNextRun', () => {
  it('publishes immediately once the interval has elapsed', () => {
    expect(delayUntilNextRun(1000, 100, 1100)).to.equal(0);
    expect(delayUntilNextRun(1000, 100, 5000)).to.equal(0);
  });

  // The trailing edge is the point: the value the user stops on has to be
  // published, not dropped because it arrived inside the window.
  it('schedules the remainder of the interval when called too soon', () => {
    expect(delayUntilNextRun(1000, 100, 1040)).to.equal(60);
    expect(delayUntilNextRun(1000, 100, 1000)).to.equal(100);
  });

  it('never waits longer than the interval itself', () => {
    for (const now of [0, 500, 999, 1000, 1001, 9999]) {
      expect(delayUntilNextRun(1000, 100, now)).to.be.at.most(100);
    }
  });

  // A clock that steps backwards would otherwise produce a negative elapsed
  // time and a wait longer than the interval.
  it('falls back to a full interval if the clock went backwards', () => {
    expect(delayUntilNextRun(5000, 100, 1000)).to.equal(100);
  });

  it('treats a zero interval as always due', () => {
    expect(delayUntilNextRun(1000, 0, 1000)).to.equal(0);
  });
});
