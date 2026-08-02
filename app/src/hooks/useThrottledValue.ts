import { useEffect, useRef, useState } from 'react';

/**
 * Follows `value` at most once per `intervalMs`, always settling on the latest
 * one. Used for the live area readout: a drag fires on every mouse move, and
 * recomputing a geodesic area that often is wasted work — but the trailing
 * update matters, because the number the user stops on has to be the true one.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastRunAt = useRef(0);

  useEffect(() => {
    const elapsed = Date.now() - lastRunAt.current;
    if (elapsed >= intervalMs) {
      lastRunAt.current = Date.now();
      setThrottled(value);
      return;
    }

    const timer = setTimeout(() => {
      lastRunAt.current = Date.now();
      setThrottled(value);
    }, intervalMs - elapsed);
    return () => clearTimeout(timer);
  }, [value, intervalMs]);

  return throttled;
}
