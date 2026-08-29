'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Restores the open/close transition on a Base UI sheet whose host mounts it
 * already-open.
 *
 * Base UI seeds its transition state from the popup's FIRST `open` value —
 * `useTransitionStatus` does `useState(open)` and guards the starting state
 * behind `if (open && !mounted)`. A dialog that mounts open therefore never
 * gets `data-starting-style`, so the slide-in on `SheetContent` never runs and
 * the sheet just appears. The leads sheet animates only because it stays
 * mounted and flips `open`; the member sheets are code-split and mounted on
 * selection (`{selected ? <MemberDetailView open /> : null}`), which is
 * exactly the case Base UI skips.
 *
 * This bridges both directions. It opens one frame after mount so the popup
 * sees a real closed -> open flip, and it withholds the host's close callback
 * until the exit transition has finished, so a host that unmounts on close
 * can't cut the slide-out short.
 *
 * Spread the result onto `Sheet`. Keep using the `open` PROP for data loading
 * and child `active` flags — those should still start on mount rather than
 * waiting a frame.
 */
export function useSheetMountTransition(
  open: boolean,
  onOpenChange: (open: boolean) => void
) {
  const [visible, setVisible] = useState(false);

  // The setState lives inside the frame callback, not the effect body:
  // `react-hooks/set-state-in-effect` is enforced, and deferring is the whole
  // point — the popup has to commit closed once before it can animate open.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(open));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setVisible(next);
      // Opening propagates immediately. Closing does not — the host would
      // unmount us and kill the exit transition, so it waits for the
      // completion callback below.
      if (next) onOpenChange(true);
    },
    [onOpenChange]
  );

  const handleOpenChangeComplete = useCallback(
    (next: boolean) => {
      if (!next) onOpenChange(false);
    },
    [onOpenChange]
  );

  return {
    open: visible,
    onOpenChange: handleOpenChange,
    onOpenChangeComplete: handleOpenChangeComplete,
  };
}
