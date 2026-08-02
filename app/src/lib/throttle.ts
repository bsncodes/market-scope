/**
 * How long to wait before publishing the next value, or 0 to publish now.
 *
 * Split out of `useThrottledValue` so the rule can be tested without a DOM or
 * a React renderer: the trailing-edge guarantee is the entire reason the hook
 * exists, and it was previously only exercised by dragging a map by hand.
 */
export function delayUntilNextRun(
  lastRunAt: number,
  intervalMs: number,
  now: number,
): number {
  const elapsed = now - lastRunAt;

  // A clock that jumped backwards, or a caller passing a future timestamp,
  // would otherwise schedule a wait longer than the interval itself.
  if (elapsed < 0) return intervalMs;

  return elapsed >= intervalMs ? 0 : intervalMs - elapsed;
}
