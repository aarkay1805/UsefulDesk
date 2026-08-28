import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(async () => ({
    supabase: { from: vi.fn() },
    accountId: 'account-1',
  })),
  loadDateContext: vi.fn(async () => ({
    timeZone: 'Asia/Kolkata',
    today: '2026-08-28',
  })),
  loadSnapshot: vi.fn(async () => ({ marker: 'server-snapshot' })),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
}));
vi.mock('@/lib/dashboard/action-snapshot', () => ({
  loadDashboardActionDateContext: h.loadDateContext,
  loadDashboardActionSnapshot: h.loadSnapshot,
}));
vi.mock('@/components/dashboard/dashboard-actions', () => ({
  DashboardActionsProvider: ({
    children,
    initialSnapshot,
  }: {
    children: ReactNode;
    initialSnapshot?: { marker: string };
  }) => (
    <div data-snapshot={initialSnapshot?.marker ?? 'missing'}>{children}</div>
  ),
}));

vi.mock('@/components/dashboard/deferred-dashboard-insights', () => ({
  DeferredDashboardInsights: () => null,
}));
vi.mock('@/components/dashboard/dashboard-section', () => ({
  DashboardSection: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/dashboard/expiring-memberships', () => ({
  ExpiringMemberships: () => null,
}));
vi.mock('@/components/dashboard/follow-up-queue', () => ({
  FollowUpQueue: () => null,
}));
vi.mock('@/components/dashboard/gym-metrics', () => ({
  GymMetrics: () => null,
}));
vi.mock('@/components/dashboard/needs-attention-card', () => ({
  NeedsAttentionCard: () => null,
}));
vi.mock('@/components/dashboard/quick-actions', () => ({
  QuickActions: () => null,
}));
vi.mock('@/components/dashboard/uncontacted-leads', () => ({
  UncontactedLeads: () => null,
}));

const { default: DashboardPage } = await import('./page');

describe('DashboardPage first response', () => {
  it('loads the action snapshot on the server and seeds the provider', async () => {
    const markup = renderToStaticMarkup(await DashboardPage());

    expect(h.getCurrentAccount).toHaveBeenCalledOnce();
    expect(h.loadDateContext).toHaveBeenCalledOnce();
    expect(h.loadSnapshot).toHaveBeenCalledOnce();
    expect(markup).toContain('data-snapshot="server-snapshot"');
  });
});
