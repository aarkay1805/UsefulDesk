'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** DOM id of the app bar's trailing action slot (rendered by Header). */
export const PAGE_HEADER_SLOT_ID = 'page-header-actions';

/** DOM id of the app bar's tab-row slot, below the title row. Empty for
 *  pages without sub-navigation (the slot is `empty:hidden`). */
export const PAGE_HEADER_TABS_SLOT_ID = 'page-header-tabs';

/**
 * Portals children into one of the app bar's slots so a page can surface
 * chrome (actions or sub-nav tabs) inside the shared header instead of
 * owning a second header row of its own.
 *
 * Only one page is mounted at a time, so a slot never has competing
 * writers; unmounting the page clears it automatically.
 */
function HeaderSlot({
  slotId,
  children,
}: {
  slotId: string;
  children: React.ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // The Header commits in the same shell render as the page, so the
    // slot exists by the time effects run. One-time DOM lookup — not a
    // data fetch, so the async-IIFE loading pattern doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(document.getElementById(slotId));
  }, [slotId]);

  if (!slot) return null;
  return createPortal(children, slot);
}

/** Portals a page's primary/secondary actions into the app bar's
 *  trailing slot (e.g. Import / Export / Add member). */
export function PageHeaderActions({ children }: { children: React.ReactNode }) {
  return <HeaderSlot slotId={PAGE_HEADER_SLOT_ID}>{children}</HeaderSlot>;
}

/** Portals a page's sub-navigation tab bar into the app bar's tab row,
 *  below the title. The header's bottom divider then falls after the
 *  tabs, so the nav reads as part of the header. */
export function PageHeaderTabs({ children }: { children: React.ReactNode }) {
  return <HeaderSlot slotId={PAGE_HEADER_TABS_SLOT_ID}>{children}</HeaderSlot>;
}
