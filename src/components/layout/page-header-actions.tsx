'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** DOM id of the app bar's trailing action slot (rendered by Header). */
export const PAGE_HEADER_SLOT_ID = 'page-header-actions';

/**
 * Portals its children into the app bar's trailing slot so a page can
 * surface its primary/secondary actions (e.g. Import / Add Lead) next
 * to the page title without owning a second header row of its own.
 *
 * Only one page is mounted at a time, so the slot never has competing
 * writers; unmounting the page removes its actions automatically.
 */
export function PageHeaderActions({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // The Header commits in the same shell render as the page, so the
    // slot exists by the time effects run. One-time DOM lookup — not a
    // data fetch, so the async-IIFE loading pattern doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(document.getElementById(PAGE_HEADER_SLOT_ID));
  }, []);

  if (!slot) return null;
  return createPortal(children, slot);
}
