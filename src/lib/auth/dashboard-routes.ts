/**
 * URL prefixes owned by the authenticated `(dashboard)` route group.
 *
 * Keep this list in sync with the top-level page segments under
 * `src/app/(dashboard)`. A filesystem contract test enforces that invariant so
 * a newly added dashboard surface cannot silently bypass the proxy's early
 * authentication redirect. The server dashboard layout remains the
 * authoritative backstop.
 */
export const DASHBOARD_PATH_PREFIXES = [
  '/agents',
  '/automations',
  '/broadcasts',
  '/contacts',
  '/dashboard',
  '/finance',
  '/flows',
  '/get-started',
  '/inbox',
  '/leads',
  '/members',
  '/notifications',
  '/pipelines',
  '/reports',
  '/settings',
] as const;

export function isDashboardPath(pathname: string): boolean {
  return DASHBOARD_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
