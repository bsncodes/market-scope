import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

interface RequestState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
}

/**
 * Runs `fetcher` whenever `key` changes, discarding results from a superseded
 * call. Without that guard the cascading dropdowns can show one state's cities
 * under another: a slow request for state A can land after a fast one for B.
 *
 * `key` is a single string rather than a dependency array on purpose. Spreading
 * a caller's array into the effect's deps made its length caller-controlled,
 * and React hard-errors if that length ever varies between renders. A string
 * also has to be built from whatever the fetcher closes over, so a forgotten
 * dependency shows up as a key that obviously ignores the value rather than as
 * a stale response nobody notices.
 *
 * A `null` fetcher means "nothing to load yet" and clears any previous data,
 * which is what a dropdown needs when its parent selection is cleared.
 */
export function useRequest<T>(
  key: string,
  fetcher: (() => Promise<T>) | null,
): RequestState<T> & { reload: () => void } {
  const [state, setState] = useState<RequestState<T>>({
    data: undefined,
    error: undefined,
    loading: fetcher !== null,
  });
  const [nonce, setNonce] = useState(0);

  // The effect deliberately depends on `key`, not on `fetcher` — callers pass
  // a new closure every render, which would re-fetch on every render.
  const latestFetcher = useRef(fetcher);
  useEffect(() => {
    latestFetcher.current = fetcher;
  });

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const run = latestFetcher.current;
    if (!run) {
      setState({ data: undefined, error: undefined, loading: false });
      return;
    }

    let current = true;
    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    run()
      .then((data) => {
        if (current) setState({ data, error: undefined, loading: false });
      })
      .catch((err: unknown) => {
        if (current) {
          setState({ data: undefined, error: asApiError(err), loading: false });
        }
      });

    return () => {
      current = false;
    };
  }, [key, nonce]);

  return { ...state, reload };
}

export function asApiError(err: unknown): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError(0, 'UNEXPECTED', (err as Error)?.message ?? 'Unknown error');
}
