'use client';

import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import {
  PAGE_HEADER_SLOT_ID,
  PAGE_HEADER_TABS_SLOT_ID,
} from '@/components/layout/page-header-actions';

const pageTitles: Record<string, string> = {
  '/get-started': 'Get Started',
  '/dashboard': 'Dashboard',
  '/inbox': 'Inbox',
  '/notifications': 'Notifications',
  '/leads': 'Leads',
  '/members': 'Members',
  '/finance': 'Finance',
  '/reports': 'Reports',
  '/broadcasts': 'Broadcasts',
  '/automations': 'Automations',
  '/settings': 'Settings',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path)
  );
  return match ? match[1] : 'Dashboard';
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

/**
 * App bar — HubSpot-style header: a title row (page title left, page-owned
 * actions right) and, below it, an optional sub-navigation tab row. The
 * bottom divider sits on the whole header, so when a page fills the tab
 * slot the divider falls *after* the tabs and the nav reads as part of the
 * header. Pages inject chrome via <PageHeaderActions> / <PageHeaderTabs>.
 * Account menu + theme toggle live in the sidebar footer.
 */
export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="border-border bg-background flex shrink-0 flex-col border-b">
      {/* Title row */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open menu"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-10 w-10 items-center justify-center rounded-md transition-colors lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-foreground truncate text-base font-semibold sm:text-lg">
            {title}
          </h1>
        </div>

        {/* Trailing slot — pages portal their primary/secondary buttons
            here (see PageHeaderActions). Empty for pages that don't. */}
        <div
          id={PAGE_HEADER_SLOT_ID}
          className="flex shrink-0 items-center gap-2"
        />
      </div>

      {/* Tab row — pages portal a sub-nav tab bar here (see PageHeaderTabs).
          `empty:hidden` collapses it entirely for pages without tabs, so
          those headers stay a single title row exactly as before. `-mb-px`
          lifts the header's bottom divider by 1px so it tucks under the
          active tab's underline — the black indicator paints over the grey
          line and the two merge (no gap, no negative-offset overflow). */}
      <div
        id={PAGE_HEADER_TABS_SLOT_ID}
        className="-mb-px overflow-x-auto px-4 empty:hidden lg:px-6"
      />
    </header>
  );
}
