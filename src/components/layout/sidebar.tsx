'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
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
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
    className: 'bg-amber-500/10 text-amber-foreground',
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

interface SidebarNavLinkProps {
  href: string;
  label: string;
  icon: NavItem['icon'];
  isActive: boolean;
  collapsed: boolean;
  trailing?: ReactNode;
  compactIndicator?: ReactNode;
}

function SidebarNavLink({
  href,
  label,
  icon: Icon,
  isActive,
  collapsed,
  trailing,
  compactIndicator,
}: SidebarNavLinkProps) {
  return (
    <Tooltip disabled={!collapsed}>
      <TooltipTrigger
        delay={350}
        render={
          <Link
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-[background-color,color,gap] duration-200 motion-reduce:transition-none lg:py-2',
              collapsed && 'lg:gap-0',
              isActive
                ? 'bg-primary/10 text-primary-text'
                : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
            )}
          >
            <span className="relative flex size-4 shrink-0 items-center justify-center">
              <Icon className="size-4" />
              {compactIndicator ? (
                <span className={cn('hidden', collapsed && 'lg:block')}>
                  {compactIndicator}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out motion-reduce:transition-none',
                collapsed
                  ? 'lg:max-w-0 lg:-translate-x-1 lg:opacity-0'
                  : 'max-w-40 translate-x-0 opacity-100'
              )}
            >
              {label}
            </span>
            {trailing ? (
              <span
                className={cn(
                  'flex shrink-0 items-center overflow-hidden transition-[max-width,opacity] duration-200 ease-out motion-reduce:transition-none',
                  collapsed ? 'lg:max-w-0 lg:opacity-0' : 'max-w-20 opacity-100'
                )}
              >
                {trailing}
              </span>
            ) : null}
          </Link>
        }
      />
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const onboarding = useOnboardingStatus();
  const totalUnread = useTotalUnread({ sound: true });
  const unreadNotifications = useUnreadNotifications();
  const [collapsed, setCollapsed] = useState(false);
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
        id="primary-sidebar"
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          'border-border bg-sidebar fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col overflow-hidden border-r',
          'transition-[width,transform] duration-200 ease-out will-change-[width,transform] motion-reduce:transition-none',
          open ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static and always visible. Width remains animated so
          // the adjacent page content grows and shrinks with the rail.
          'lg:static lg:z-0 lg:translate-x-0 lg:duration-300 lg:ease-in-out',
          collapsed ? 'lg:w-16' : 'lg:w-60'
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center justify-between gap-2 px-4 transition-[padding] duration-200 motion-reduce:transition-none',
            collapsed && 'lg:justify-center lg:px-3'
          )}
        >
          <Link
            href="/dashboard"
            className={cn(
              'flex items-center gap-2 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 motion-reduce:transition-none',
              collapsed ? 'lg:max-w-0 lg:opacity-0' : 'max-w-40 opacity-100'
            )}
          >
            <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span className="text-foreground text-sm font-semibold">
              UsefulDesk
            </span>
          </Link>
          <Tooltip>
            <TooltipTrigger
              delay={350}
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setCollapsed((value) => !value)}
                  aria-label={
                    collapsed ? 'Expand navigation' : 'Collapse navigation'
                  }
                  aria-expanded={!collapsed}
                  aria-controls="primary-sidebar"
                  className="hidden lg:inline-flex"
                >
                  {collapsed ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )}
                </Button>
              }
            />
            <TooltipContent
              side={collapsed ? 'right' : 'bottom'}
              sideOffset={8}
            >
              {collapsed ? 'Expand navigation' : 'Collapse navigation'}
            </TooltipContent>
          </Tooltip>
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
        <ScrollArea className="min-h-0 flex-1" scrollbarVisibility="hover">
          <nav className="px-3 py-4">
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
                      <SidebarNavLink
                        href="/get-started"
                        label="Get Started"
                        icon={Rocket}
                        isActive={pathname.startsWith('/get-started')}
                        collapsed={collapsed}
                        trailing={
                          !onboarding.loading ? (
                            <span
                              aria-label={`${onboarding.completedCount} of ${onboarding.total} setup steps complete`}
                              className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold"
                            >
                              {onboarding.completedCount}/{onboarding.total}
                            </span>
                          ) : null
                        }
                        compactIndicator={
                          !onboarding.loading ? (
                            <span className="bg-primary text-primary-foreground absolute -top-2 -right-3 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8px] font-semibold">
                              {onboarding.completedCount}
                            </span>
                          ) : null
                        }
                      />
                    </li>
                  )}
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== '/dashboard' &&
                      pathname.startsWith(item.href));

                  const showUnreadDot =
                    item.href === '/inbox' && totalUnread > 0;

                  // Keep unread state visible even while its page is active:
                  // viewing a section is not the same as clearing every item.
                  // Notifications clear only when their rows are marked read.
                  const showNotificationBadge =
                    item.href === '/notifications' && unreadNotifications > 0;

                  return (
                    <li key={item.href}>
                      <SidebarNavLink
                        href={item.href}
                        label={item.label}
                        icon={item.icon}
                        isActive={isActive}
                        collapsed={collapsed}
                        trailing={
                          item.beta ||
                          showUnreadDot ||
                          showNotificationBadge ? (
                            <>
                              {item.beta && (
                                <span
                                  aria-label="Beta feature"
                                  className="text-amber-foreground rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase"
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
                            </>
                          ) : null
                        }
                        compactIndicator={
                          item.beta ? (
                            <span className="absolute -top-1.5 -right-2 size-2 rounded-full bg-amber-500" />
                          ) : showUnreadDot ? (
                            <span className="bg-primary absolute -top-1.5 -right-2 size-2 rounded-full" />
                          ) : showNotificationBadge ? (
                            <span className="bg-primary text-primary-foreground absolute -top-2 -right-3 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8px] font-semibold">
                              {unreadNotifications > 9
                                ? '9+'
                                : unreadNotifications}
                            </span>
                          ) : null
                        }
                      />
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
                  <SidebarNavLink
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    isActive={isActive}
                    collapsed={collapsed}
                  />
                </li>
              );
            })}
          </ul>
          </nav>
        </ScrollArea>

        {/* User section */}
        <div className="border-border shrink-0 border-t p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {showAccountStrip && account?.name ? (
            <div
              className={cn(
                'text-muted-foreground mb-2 flex max-h-8 items-center gap-2 overflow-hidden px-3 text-xs opacity-100 transition-[max-height,margin,opacity] duration-200 motion-reduce:transition-none',
                collapsed && 'lg:mb-0 lg:max-h-0 lg:opacity-0'
              )}
            >
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
          <div
            className={cn(
              'flex items-center gap-1',
              collapsed && 'lg:flex-col'
            )}
          >
            <DropdownMenu>
              <Tooltip disabled={!collapsed}>
                <TooltipTrigger
                  delay={350}
                  render={
                    <DropdownMenuTrigger
                      className={cn(
                        'hover:bg-foreground/[0.06] focus:bg-foreground/[0.06] data-popup-open:bg-foreground/[0.06] flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-left transition-[background-color,gap,padding,width] duration-200 focus:outline-none motion-reduce:transition-none',
                        collapsed &&
                          'lg:size-10 lg:flex-none lg:justify-center lg:gap-0 lg:p-1'
                      )}
                    >
                      <UserAvatar
                        className="size-8 shrink-0"
                        name={profile?.full_name || profile?.email || 'U'}
                        src={profile?.avatar_url}
                      />
                      <div
                        className={cn(
                          'min-w-0 flex-1 overflow-hidden transition-[max-width,opacity,transform] duration-200 motion-reduce:transition-none',
                          collapsed
                            ? 'lg:max-w-0 lg:-translate-x-1 lg:opacity-0'
                            : 'max-w-40 translate-x-0 opacity-100'
                        )}
                      >
                        <p className="text-foreground truncate text-sm font-medium">
                          {profile?.full_name ?? 'User'}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {profile?.email ?? ''}
                        </p>
                      </div>
                    </DropdownMenuTrigger>
                  }
                />
                <TooltipContent side="right" sideOffset={8}>
                  {profile?.full_name ?? profile?.email ?? 'Account menu'}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align={collapsed ? 'start' : 'end'}
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
