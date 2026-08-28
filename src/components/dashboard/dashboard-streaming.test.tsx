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
  loadSection: vi.fn(),
}));

vi.mock('@/lib/auth/dashboard-request-context', () => ({
  getDashboardRequestContext: async () => h.requestContext,
  requireDashboardAccountContext: (context: typeof h.requestContext) =>
    context.account,
}));

vi.mock('@/lib/dashboard/action-snapshot', () => ({
  loadDashboardActionSection: h.loadSection,
}));

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

const { DashboardActionSectionData } = await import('./dashboard-streaming');

describe('DashboardActionSectionData', () => {
  it('loads only its own section through the selected-branch RLS client', async () => {
    h.loadSection.mockResolvedValue({ errors: [] });

    const markup = renderToStaticMarkup(
      await DashboardActionSectionData({
        section: 'followUps',
        children: <div>Follow-up rows</div>,
      })
    );

    expect(h.loadSection).toHaveBeenCalledOnce();
    expect(h.loadSection).toHaveBeenCalledWith(
      h.requestContext.account.supabase,
      'account-1',
      h.requestContext.account.dateContext,
      'followUps'
    );
    expect(markup).toContain('Follow-up rows');
    expect(markup).toContain('data-errors=""');
  });
});
