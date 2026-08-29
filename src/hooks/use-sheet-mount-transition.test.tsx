// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSheetMountTransition } from './use-sheet-mount-transition';

describe('useSheetMountTransition', () => {
  it('reports closed on the first commit so a sheet mounted open still animates in', async () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() =>
      useSheetMountTransition(true, onOpenChange)
    );

    // Base UI seeds its transition state from the popup's first `open` value,
    // so this false is what buys the slide-in.
    expect(result.current.open).toBe(false);

    await waitFor(() => expect(result.current.open).toBe(true));
  });

  it('holds a close from the host until the exit transition completes', async () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() =>
      useSheetMountTransition(true, onOpenChange)
    );
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.onOpenChange(false));

    // The sheet closes locally, but the host is not told yet — telling it
    // would unmount the sheet mid-slide-out.
    expect(result.current.open).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => result.current.onOpenChangeComplete(false));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('propagates an open immediately and ignores a completed open', async () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() =>
      useSheetMountTransition(false, onOpenChange)
    );

    act(() => result.current.onOpenChange(true));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);

    act(() => result.current.onOpenChangeComplete(true));
    expect(onOpenChange).toHaveBeenCalledOnce();
  });
});
