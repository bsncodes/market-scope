import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { useRequest } from '../src/hooks/useRequest';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useRequest', () => {
  it('loads, then exposes the data', async () => {
    const { result } = renderHook(() =>
      useRequest('k', () => Promise.resolve('value')),
    );

    expect(result.current.loading).to.equal(true);
    await waitFor(() => expect(result.current.data).to.equal('value'));
    expect(result.current.loading).to.equal(false);
    expect(result.current.error).to.equal(undefined);
  });

  it('surfaces the API error rather than throwing', async () => {
    const failure = new ApiError(404, 'RESOURCE_NOT_FOUND', 'No market.');
    const { result } = renderHook(() =>
      useRequest('k', () => Promise.reject(failure)),
    );

    await waitFor(() => expect(result.current.error).to.equal(failure));
    expect(result.current.data).to.equal(undefined);
    expect(result.current.loading).to.equal(false);
  });

  it('wraps a non-ApiError throw so callers only handle one shape', async () => {
    const { result } = renderHook(() =>
      useRequest('k', () => Promise.reject(new TypeError('boom'))),
    );

    await waitFor(() =>
      expect(result.current.error).to.be.instanceOf(ApiError),
    );
    expect(result.current.error?.message).to.equal('boom');
  });

  it('does not fetch when the fetcher is null', () => {
    const { result } = renderHook(() => useRequest('k', null));

    expect(result.current.loading).to.equal(false);
    expect(result.current.data).to.equal(undefined);
  });

  it('clears stale data when the fetcher becomes null', async () => {
    const { result, rerender } = renderHook(
      ({
        fetcher,
        key,
      }: {
        fetcher: (() => Promise<string>) | null;
        key: string;
      }) => useRequest(key, fetcher),
      {
        initialProps: {
          key: 'a',
          fetcher: (() => Promise.resolve('cities of A')) as
            (() => Promise<string>) | null,
        },
      },
    );

    await waitFor(() => expect(result.current.data).to.equal('cities of A'));

    rerender({ key: 'none', fetcher: null });
    await waitFor(() => expect(result.current.data).to.equal(undefined));
  });

  it('refetches when the key changes', async () => {
    const fetcher = vi.fn((key: string) => Promise.resolve(`data for ${key}`));

    const { result, rerender } = renderHook(
      ({ key }) => useRequest(key, () => fetcher(key)),
      { initialProps: { key: 'a' } },
    );

    await waitFor(() => expect(result.current.data).to.equal('data for a'));
    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.data).to.equal('data for b'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // A new closure on every render must not be mistaken for new work, or the
  // component re-fetches forever.
  it('does not refetch when only the fetcher identity changes', async () => {
    const fetcher = vi.fn(() => Promise.resolve('once'));

    const { result, rerender } = renderHook(() =>
      useRequest('stable', () => fetcher()),
    );

    await waitFor(() => expect(result.current.data).to.equal('once'));
    rerender();
    rerender();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // The bug this guards: picking state A then quickly state B, where A's
  // slower response lands last and shows A's cities under B.
  it('ignores a superseded response that resolves late', async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();

    const { result, rerender } = renderHook(
      ({ key, promise }: { key: string; promise: Promise<string> }) =>
        useRequest(key, () => promise),
      { initialProps: { key: 'a', promise: slow.promise } },
    );

    rerender({ key: 'b', promise: fast.promise });
    fast.resolve('cities of B');
    await waitFor(() => expect(result.current.data).to.equal('cities of B'));

    slow.resolve('cities of A');
    await Promise.resolve();

    expect(result.current.data).to.equal('cities of B');
  });

  it('refetches on demand via reload', async () => {
    const fetcher = vi.fn(() => Promise.resolve('v'));
    const { result } = renderHook(() => useRequest('k', () => fetcher()));

    await waitFor(() => expect(result.current.data).to.equal('v'));
    act(() => result.current.reload());

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
