import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_PATH_PREFIXES, isDashboardPath } from './dashboard-routes';

const DASHBOARD_APP_DIR = join(process.cwd(), 'src/app/(dashboard)');

function dashboardPagePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) return dashboardPagePaths(entryPath);
    if (entry.name !== 'page.tsx') return [];

    const route = relative(DASHBOARD_APP_DIR, directory)
      .split(sep)
      .filter(Boolean)
      .map((segment) => (segment.startsWith('[') ? 'test-value' : segment))
      .join('/');

    return [`/${route}`];
  });
}

describe('dashboard route authentication policy', () => {
  it('covers every page in the authenticated dashboard route group', () => {
    const dashboardPages = dashboardPagePaths(DASHBOARD_APP_DIR);

    expect(dashboardPages.length).toBeGreaterThan(0);
    expect(dashboardPages.filter((path) => !isDashboardPath(path))).toEqual([]);
  });

  it('matches complete path segments, including nested dashboard routes', () => {
    expect(isDashboardPath('/finance')).toBe(true);
    expect(isDashboardPath('/reports')).toBe(true);
    expect(isDashboardPath('/get-started')).toBe(true);
    expect(isDashboardPath('/automations/test-value/edit')).toBe(true);
    expect(isDashboardPath('/dashboard-public')).toBe(false);
  });

  it('does not classify public, tokenized, invitation, or auth routes as dashboard pages', () => {
    for (const pathname of [
      '/',
      '/login',
      '/reset-password',
      '/join/invite-token',
      '/f/form-token',
      '/data-deletion',
      '/auth/callback',
    ]) {
      expect(isDashboardPath(pathname)).toBe(false);
    }
  });

  it('has one proxy prefix for every top-level dashboard page segment', () => {
    const topLevelSegments = new Set(
      dashboardPagePaths(DASHBOARD_APP_DIR).map(
        (path) => `/${path.split('/')[1]}`
      )
    );

    expect(new Set(DASHBOARD_PATH_PREFIXES)).toEqual(topLevelSegments);
  });
});
