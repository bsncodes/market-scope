import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';

interface RequestState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
}

/**
 * Runs `fetcher` whenever `deps` change, discarding results from a superseded
 * call. Without that guard the cascading dropdowns can show one state's cities
 * under another: a slow request for state A can land after a fast one for B.
 *
 * A `null` fetcher means "nothing to load yet" and clears the previous data,
 * which is what a dropdown needs when its parent selection is cleared.
 */
export function useRequest<T>(
  fetcher: (() => Promise<T>) | null,
  deps: unknown[],
): RequestState<T> & { reload: () => void } {
  const [state, setState] = useState<RequestState<T>>({
    data: undefined,
    error: undefined,
    loading: fetcher !== null,
  });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!fetcher) {
      setState({ data: undefined, error: undefined, loading: false });
      return;
    }

    let current = true;
    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    fetcher()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload };
}

export function asApiError(err: unknown): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError(0, 'UNEXPECTED', (err as Error)?.message ?? 'Unknown error');
}
