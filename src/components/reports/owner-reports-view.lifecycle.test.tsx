// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BranchPerformanceSnapshot } from '@/lib/reports/reporting';

const lifecycle = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  userId: 'user-a' as string | null,
  timeZone: 'Asia/Kolkata',
  loadSnapshot: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: lifecycle.userId ? { id: lifecycle.userId } : null,
    account: { id: lifecycle.accountId, created_at: '2025-01-01' },
    accountId: lifecycle.accountId,
    accountRole: 'owner',
    organizationId: null,
    isOrganizationOwner: false,
  }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: { timeZone: lifecycle.timeZone },
    fmt: {
      today: () => '2026-08-29',
      month: (value: string) => value.slice(0, 7),
      number: (value: number) => String(value),
      money: (value: number) => `INR ${value}`,
      date: (value: string) => value,
    },
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ marker: 'browser-client' }),
}));

vi.mock('@/lib/reports/reporting', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/reports/reporting')>();
  return { ...actual, loadBranchPerformanceSnapshot: lifecycle.loadSnapshot };
});

vi.mock('@/components/layout/page-header-actions', () => ({
  PageHeaderActions: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PageHeaderLeading: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/members/use-account-staff', () => ({
  useAccountStaff: () => ({ staff: [], loading: false }),
}));

vi.mock('./report-trend-card', () => ({
  ActivityTrendCard: () => <div>Activity trend</div>,
}));

vi.mock('./organization-reports-view', () => ({
  OrganizationReportsView: () => <div>Organization performance</div>,
}));

const { OwnerReportsView } = await import('./owner-reports-view');

const snapshot: BranchPerformanceSnapshot = {
  report: {
    period: { start: '2026-08-01', end: '2026-08-31', days: 31 },
    metrics: {
      revenue: { current: 100, previous: 90 },
      newMembers: { current: 2, previous: 1, activeTotal: 3 },
      averageSalePrice: { current: 50, previous: 45 },
      visits: { current: 4, previous: 3 },
      conversion: { current: 20, previous: 10, acquired: 2, converted: 1 },
    },
    attention: {
      renewalsDue: 0,
      outstandingDues: 0,
      outstandingAmount: 0,
      inactiveMembers: 0,
      churnRisk: 0,
      trialFollowups: 0,
      failedMandates: 0,
    },
    trend: [],
    plans: [],
    sources: [],
    collectionMethods: [],
    collectionSources: [],
  },
  adPerformance: null,
  expenseTotals: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  lifecycle.accountId = 'account-a';
  lifecycle.userId = 'user-a';
  lifecycle.timeZone = 'Asia/Kolkata';
  lifecycle.loadSnapshot.mockReset().mockResolvedValue(snapshot);
});

afterEach(() => {
  cleanup();
});

describe('OwnerReportsView request lifecycle', () => {
  it('measures first load, same-key rerender, and an exact-key remount', async () => {
    const first = render(
      <OwnerReportsView month="2026-08" onMonthChange={vi.fn()} />
    );
    await waitFor(() => expect(lifecycle.loadSnapshot).toHaveBeenCalledOnce());
    expect(await screen.findByText('Activity trend')).toBeTruthy();

    first.rerender(
      <OwnerReportsView month="2026-08" onMonthChange={vi.fn()} />
    );
    expect(lifecycle.loadSnapshot).toHaveBeenCalledOnce();

    first.unmount();
    render(<OwnerReportsView month="2026-08" onMonthChange={vi.fn()} />);
    await waitFor(() =>
      expect(lifecycle.loadSnapshot).toHaveBeenCalledTimes(2)
    );
  });

  it('measures Strict Mode and rapid A→B→A while requests are in flight', async () => {
    const august = deferred<BranchPerformanceSnapshot>();
    const july = deferred<BranchPerformanceSnapshot>();
    lifecycle.loadSnapshot
      .mockReturnValueOnce(august.promise)
      .mockReturnValueOnce(august.promise)
      .mockReturnValueOnce(july.promise)
      .mockReturnValueOnce(august.promise);

    const view = render(
      <StrictMode>
        <OwnerReportsView month="2026-08" onMonthChange={vi.fn()} />
      </StrictMode>
    );
    await waitFor(() =>
      expect(lifecycle.loadSnapshot).toHaveBeenCalledTimes(2)
    );

    view.rerender(
      <StrictMode>
        <OwnerReportsView month="2026-07" onMonthChange={vi.fn()} />
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <OwnerReportsView month="2026-08" onMonthChange={vi.fn()} />
      </StrictMode>
    );
    await waitFor(() =>
      expect(lifecycle.loadSnapshot).toHaveBeenCalledTimes(4)
    );

    await act(async () => {
      july.resolve(snapshot);
      august.resolve(snapshot);
      await Promise.all([july.promise, august.promise]);
    });
    expect(await screen.findByText('Activity trend')).toBeTruthy();
  });

  it('keeps Retry as an explicit additional request after an error', async () => {
    lifecycle.loadSnapshot
      .mockRejectedValueOnce(new Error('snapshot failed'))
      .mockResolvedValueOnce(snapshot);
    render(<OwnerReportsView month="2026-08" onMonthChange={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() =>
      expect(lifecycle.loadSnapshot).toHaveBeenCalledTimes(2)
    );
    expect(await screen.findByText('Activity trend')).toBeTruthy();
  });
});
