import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  loading: false,
  accountStatus: 'error' as 'loading' | 'ready' | 'unlinked' | 'error',
  accountStatusDetail: 'account unavailable' as string | null,
  accountId: 'account-1' as string | null,
  branchAccessError: null as string | null,
  branches: [] as Array<{
    account_id: string;
    account_name: string;
    branch_status: 'active' | 'read_only' | 'archived';
  }>,
  switchBranch: vi.fn(),
  refreshProfile: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState,
}));

vi.mock('@/hooks/use-onboarding-status', () => ({
  OnboardingProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/layout/sidebar', () => ({
  Sidebar: () => <nav>Sidebar</nav>,
}));

vi.mock('@/components/layout/header', () => ({
  Header: () => <header>Header</header>,
}));

vi.mock('@/components/layout/account-appearance-sync', () => ({
  AccountAppearanceSync: () => null,
}));

vi.mock('@/components/presence/presence-heartbeat', () => ({
  PresenceHeartbeat: () => null,
}));

vi.mock('@/hooks/use-notification-audio', () => ({
  useNotificationAudio: () => undefined,
}));

const reminderRingtone = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-follow-up-reminder-ringtone', () => ({
  useFollowUpReminderRingtone: reminderRingtone,
}));

const { DashboardShell } = await import('./dashboard-shell');

const SERVER_PROPS = {
  initialUser: { id: 'user-1' } as never,
  initialBootstrap: {
    profile: null,
    account: null,
    branches: [],
    branchAccessError: null,
    accountStatusDetail: null,
  },
};

describe('DashboardShell account boundary', () => {
  beforeEach(() => {
    authState.user = { id: 'user-1' };
    authState.loading = false;
    authState.accountStatus = 'error';
    authState.accountStatusDetail = 'account unavailable';
    authState.accountId = 'account-1';
    authState.branchAccessError = null;
    authState.branches = [];
  });

  it('keeps account-dependent children unmounted after hydration fails', () => {
    const markup = renderToStaticMarkup(
      <DashboardShell {...SERVER_PROPS}>
        <div>Business content</div>
      </DashboardShell>
    );

    expect(markup).toContain('Could not load your account access');
    expect(markup).toContain('Retry');
    expect(markup).not.toContain('Business content');
    expect(markup).not.toContain('Sidebar');
  });

  it('keeps account-dependent children unmounted while hydrating', () => {
    authState.accountStatus = 'loading';

    const markup = renderToStaticMarkup(
      <DashboardShell {...SERVER_PROPS}>
        <div>Business content</div>
      </DashboardShell>
    );

    expect(markup).toContain('Loading...');
    expect(markup).not.toContain('Business content');
  });

  it('mounts dashboard content only when account hydration is ready', () => {
    authState.accountStatus = 'ready';

    const markup = renderToStaticMarkup(
      <DashboardShell {...SERVER_PROPS}>
        <div>Business content</div>
      </DashboardShell>
    );

    expect(markup).toContain('Business content');
    expect(markup).toContain('Sidebar');
    expect(markup).not.toContain('Could not load your account access');
    expect(reminderRingtone).toHaveBeenCalledWith('account-1', true);
  });

  it('provides an immediate loading boundary for authenticated navigation', () => {
    const loadingPath = resolve(
      process.cwd(),
      'src/app/(dashboard)/loading.tsx'
    );
    const exists = existsSync(loadingPath);

    expect(exists).toBe(true);
    if (!exists) return;

    const source = readFileSync(loadingPath, 'utf8');
    expect(source).toContain('aria-label="Loading page"');
    expect(source).toContain('SkeletonCard');
  });
});
