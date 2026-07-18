'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { useTotalUnread } from '@/hooks/use-total-unread';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import {
  Bell,
  Bot,
  ChartNoAxesCombined,
  Crown,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  Rocket,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import type { AccountRole } from '@/lib/auth/roles';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: 'Owner',
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  admin: {
    icon: Shield,
    label: 'Admin',
    // Primary-tinted: significant but not as scarce as owner.
    className: 'bg-primary/10 text-primary-text',
  },
  agent: {
    icon: UserCog,
    label: 'Agent',
    // Neutral slate: the operational default.
    className: 'bg-muted text-foreground',
  },
  viewer: {
    icon: User,
    label: 'Viewer',
    // Muted slate: read-only role; visually quieter than agent.
    className: 'bg-muted text-muted-foreground',
  },
};
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModeToggle } from '@/components/layout/mode-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

const navSections: { key: string; items: NavItem[] }[] = [
  {
    key: 'members',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/inbox', label: 'Inbox', icon: MessageSquare },
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/leads', label: 'Leads', icon: Users },
      { href: '/members', label: 'Members', icon: Dumbbell },
      { href: '/reports', label: 'Reports', icon: ChartNoAxesCombined },
    ],
  },
  {
    key: 'tools',
    items: [
      { href: '/broadcasts', label: 'Broadcasts', icon: Radio },
      { href: '/automations', label: 'Automations', icon: Zap },
      { href: '/flows', label: 'Flows', icon: Workflow, beta: true },
      { href: '/agents', label: 'AI Agents', icon: Bot },
    ],
  },
];

const bottomNavItems = [
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const onboarding = useOnboardingStatus();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          'bg-background/70 fixed inset-0 z-30 backdrop-blur-sm transition-opacity lg:hidden',
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          'border-border bg-sidebar fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r',
          'transition-transform duration-200 ease-out will-change-transform',
          open ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static, always visible — reset all the mobile framing.
          'lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none'
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span className="text-foreground text-sm font-semibold">
              UsefulDesk
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 w-9 items-center justify-center rounded-md lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navSections.map((section, sectionIndex) => (
            <Fragment key={section.key}>
              {sectionIndex > 0 && <Separator className="my-4" />}
              <ul className="flex flex-col gap-1">
                {/* Get Started sits above the regular nav while onboarding is
                    live for this account (admin+, not yet complete/dismissed).
                    It auto-disappears once every step is done — the provider
                    stamps `onboarding_dismissed_at` and `active` flips off. */}
                {sectionIndex === 0 &&
                  onboarding.active &&
                  !onboarding.allDone && (
                    <li>
                      <Link
                        href="/get-started"
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2',
                          pathname.startsWith('/get-started')
                            ? 'bg-primary/10 text-primary-text'
                            : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                        )}
                      >
                        <Rocket className="h-4 w-4" />
                        <span className="flex-1">Get Started</span>
                        {!onboarding.loading && (
                          <span
                            aria-label={`${onboarding.completedCount} of ${onboarding.total} setup steps complete`}
                            className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold"
                          >
                            {onboarding.completedCount}/{onboarding.total}
                          </span>
                        )}
                      </Link>
                    </li>
                  )}
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== '/dashboard' &&
                      pathname.startsWith(item.href));

                  const showUnreadDot =
                    item.href === '/inbox' && totalUnread > 0 && !isActive;

                  // Unlike the inbox dot, the notifications count stays visible
                  // even while the page is active — it reflects unread state
                  // (cleared by marking notifications read), not "currently
                  // viewing this section".
                  const showNotificationBadge =
                    item.href === '/notifications' && unreadNotifications > 0;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          // Taller on mobile so fingers can hit the row reliably (≥44px).
                          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2',
                          isActive
                            ? 'bg-primary/10 text-primary-text'
                            : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="flex-1">{item.label}</span>
                        {item.beta && (
                          <span
                            aria-label="Beta feature"
                            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-300"
                          >
                            Beta
                          </span>
                        )}
                        {showUnreadDot && (
                          <span
                            aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? '' : 's'}`}
                            className="relative flex h-2 w-2"
                          >
                            <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                            <span className="bg-primary relative inline-flex h-2 w-2 rounded-full" />
                          </span>
                        )}
                        {showNotificationBadge && (
                          <span
                            aria-label={`${unreadNotifications} unread notification${unreadNotifications === 1 ? '' : 's'}`}
                            className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
                          >
                            {unreadNotifications > 9
                              ? '9+'
                              : unreadNotifications}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          ))}

          <Separator className="my-4" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2',
                      isActive
                        ? 'bg-primary/10 text-primary-text'
                        : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User section */}
        <div className="border-border shrink-0 border-t p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {showAccountStrip && account?.name ? (
            <div className="text-muted-foreground mb-2 flex items-center gap-2 px-3 text-xs">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole
                ? // Always render the chip — owners used to be
                  // invisible here, which made them indistinguishable
                  // from admins at a glance. Now everyone sees their
                  // role (with a colour cue) regardless of tier.
                  (() => {
                    const meta = ROLE_CHIP[accountRole];
                    const Icon = meta.icon;
                    return (
                      <Badge
                        className={`ml-auto shrink-0 px-1.5 text-[10px] tracking-wider uppercase ${meta.className}`}
                      >
                        <Icon className="size-3" />
                        {meta.label}
                      </Badge>
                    );
                  })()
                : null}
            </div>
          ) : null}
          {/* User row — account menu grows left, theme toggle trails.
              The toggle moved here from the app bar so the bar stays
              free for page titles + actions (HubSpot-style). */}
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger className="hover:bg-foreground/[0.06] focus:bg-foreground/[0.06] data-popup-open:bg-foreground/[0.06] flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors focus:outline-none">
                <UserAvatar
                  className="size-8 shrink-0"
                  name={profile?.full_name || profile?.email || 'U'}
                  src={profile?.avatar_url}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {profile?.full_name ?? 'User'}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {profile?.email ?? ''}
                  </p>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="top"
                sideOffset={6}
                className="bg-popover text-popover-foreground ring-border min-w-56"
              >
                <DropdownMenuItem
                  render={
                    <Link
                      href="/settings?tab=profile"
                      onClick={onClose}
                      className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                    />
                  }
                >
                  <User className="size-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={
                    <Link
                      href="/settings?tab=whatsapp"
                      onClick={onClose}
                      className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                    />
                  }
                >
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  onClick={signOut}
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ModeToggle className="shrink-0" />
          </div>
        </div>
      </aside>
    </>
  );
}
