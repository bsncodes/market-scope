import { useEffect, useRef, useState } from 'react';
import { delayUntilNextRun } from '../lib/throttle';

/**
 * Follows `value` at most once per `intervalMs`, always settling on the latest
 * one. Used for the live area readout: a drag fires on every mouse move, and
 * recomputing a geodesic area that often is wasted work — but the trailing
 * update matters, because the number the user stops on has to be the true one.
 *
 * The timing rule lives in `delayUntilNextRun` so it can be tested directly.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastRunAt = useRef(0);

  useEffect(() => {
    const publish = () => {
      lastRunAt.current = Date.now();
      setThrottled(value);
    };

    const delay = delayUntilNextRun(lastRunAt.current, intervalMs, Date.now());
    if (delay === 0) {
      publish();
      return;
    }

    const timer = setTimeout(publish, delay);
    return () => clearTimeout(timer);
  }, [value, intervalMs]);

  return throttled;
}
