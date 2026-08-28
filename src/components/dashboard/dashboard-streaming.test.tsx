import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requestContext: {
    account: {
      supabase: { marker: 'rls-client' },
      accountId: 'account-1',
      dateContext: { timeZone: 'Asia/Kolkata', today: '2026-08-28' },
    },
  },
  loadSnapshot: vi.fn(),
}));

vi.mock('@/lib/auth/dashboard-request-context', () => ({
  getDashboardRequestContext: async () => h.requestContext,
  requireDashboardAccountContext: (context: typeof h.requestContext) =>
    context.account,
}));

vi.mock('@/lib/dashboard/action-snapshot', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/dashboard/action-snapshot')>();
  return { ...original, loadDashboardActionSnapshot: h.loadSnapshot };
});

vi.mock('./dashboard-actions', () => ({
  DashboardActionsProvider: ({
    children,
    initialSnapshot,
  }: {
    children: React.ReactNode;
    initialSnapshot?: { errors: string[] };
  }) => (
    <div data-errors={initialSnapshot?.errors.join(',') ?? 'loading'}>
      {children}
    </div>
  ),
}));

const { DashboardActionSectionData, loadDashboardActionSnapshotForRequest } =
  await import('./dashboard-streaming');

const snapshot = {
  today: '2026-08-28',
  gymMetrics: null,
  followUps: null,
  expiringMemberships: { rows: [], total: 2 },
  uncontactedLeads: null,
  attention: null,
  errors: ['expiringMemberships' as const],
};

describe('dashboard action streaming', () => {
  it('starts one snapshot through the selected-branch RLS client', async () => {
    h.loadSnapshot.mockResolvedValue(snapshot);

    await expect(loadDashboardActionSnapshotForRequest()).resolves.toBe(
      snapshot
    );

    expect(h.loadSnapshot).toHaveBeenCalledOnce();
    expect(h.loadSnapshot).toHaveBeenCalledWith(
      h.requestContext.account.supabase,
      h.requestContext.account.dateContext
    );
  });

  it('projects one shared promise into section-local provider state', async () => {
    const shared = Promise.resolve(snapshot);

    const markup = renderToStaticMarkup(
      await DashboardActionSectionData({
        snapshot: shared,
        section: 'expiringMemberships',
        children: <div>Expiring rows</div>,
      })
    );

    expect(h.loadSnapshot).not.toHaveBeenCalled();
    expect(markup).toContain('Expiring rows');
    expect(markup).toContain('data-errors="expiringMemberships"');
  });
});
