'use client';

import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { PAGE_HEADER_SLOT_ID } from '@/components/layout/page-header-actions';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/inbox': 'Inbox',
  '/notifications': 'Notifications',
  '/leads': 'Leads',
  '/members': 'Members',
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
 * App bar — HubSpot-style single header row: page title on the left,
 * page-owned actions on the right. Account menu + theme toggle live in
 * the sidebar footer, so the bar stays free for per-page actions,
 * which pages inject via <PageHeaderActions>.
 */
export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="border-border bg-background flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 lg:px-6">
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
    </header>
  );
}
