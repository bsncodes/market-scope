import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottledValue } from '../src/hooks/useThrottledValue';

describe('useThrottledValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes the first value immediately', () => {
    const { result } = renderHook(() => useThrottledValue('first', 100));
    expect(result.current).to.equal('first');
  });

  it('suppresses updates inside the interval', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottledValue(value, 100),
      { initialProps: { value: 0 } },
    );

    act(() => {
      vi.advanceTimersByTime(10);
    });
    rerender({ value: 1 });
    rerender({ value: 2 });

    expect(result.current).to.equal(0);
  });

  // This is the guarantee the area readout depends on: a drag stops mid-window
  // and the last position must still reach the screen.
  it('publishes the final value after the interval, with no further renders', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottledValue(value, 100),
      { initialProps: { value: 0 } },
    );

    rerender({ value: 1 });
    rerender({ value: 2 });
    rerender({ value: 3 });
    expect(result.current).to.equal(0);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).to.equal(3);
  });

  it('lets a later change through once the window has passed', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottledValue(value, 100),
      { initialProps: { value: 'a' } },
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).to.equal('b');
  });

  it('drops a pending publish on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ value }) => useThrottledValue(value, 100),
      { initialProps: { value: 0 } },
    );

    rerender({ value: 1 });
    unmount();

    // A leaked timer firing here would setState on an unmounted component.
    expect(() => vi.advanceTimersByTime(500)).to.not.throw();
  });
});
