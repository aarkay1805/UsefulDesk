// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberPaymentDuesPage } from '@/lib/memberships/payment-dues';

const loadMemberPaymentDues = vi.hoisted(() => vi.fn());
const supabase = vi.hoisted(() => ({ marker: 'browser-client' }));

vi.mock('@/lib/memberships/payment-dues', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/memberships/payment-dues')>();
  return { ...original, loadMemberPaymentDues };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabase,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account-1', canSendMessages: true }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      today: () => '2026-08-28',
      date: (value: string) => value,
      money: (value: number) => `INR ${value}`,
    },
  }),
}));

vi.mock('@/components/leads/leads-sort', () => ({
  LeadsSort: () => <button type="button">Sort</button>,
}));

vi.mock('@/components/table/column-header', () => ({
  ColumnHeader: ({ label }: { label: string }) => <span>{label}</span>,
}));

vi.mock('./payment-table-filters', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./payment-table-filters')>();
  return { ...original, PaymentDueFilters: () => <button>Filters</button> };
});

vi.mock('./member-identity', () => ({
  MemberIdentity: ({ name }: { name?: string }) => <span>{name}</span>,
}));

vi.mock('./member-avatar-quick-view', () => ({
  buildMemberAvatarPreview: () => undefined,
}));

vi.mock('./record-payment-dialog', () => ({ RecordPaymentDialog: () => null }));
vi.mock('@/components/follow-ups/follow-up-dialog', () => ({
  FollowUpDialog: () => null,
}));
vi.mock('./send-reminder-button', () => ({
  SendReminderButton: () => <button type="button">Remind</button>,
}));

const { PaymentsTable } = await import('./payments-table');

const snapshot: MemberPaymentDuesPage = {
  rows: [
    {
      id: 'membership-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      member_number: 1001,
      user_id: 'user-1',
      plan_id: 'plan-1',
      start_date: '2026-08-14',
      end_date: '2026-09-14',
      status: 'active',
      fee_amount: 2500,
      fee_status: 'due',
      created_at: '2026-08-14T00:00:00Z',
      updated_at: '2026-08-14T00:00:00Z',
      balance: 1500,
      contact: {
        id: 'contact-1',
        account_id: 'account-1',
        user_id: 'user-1',
        name: 'Asha Rao',
        phone: '+919876543210',
        created_at: '2026-08-14T00:00:00Z',
        updated_at: '2026-08-14T00:00:00Z',
      },
      plan: {
        id: 'plan-1',
        account_id: 'account-1',
        name: 'Monthly',
        price: 2500,
        duration_days: 30,
        plan_type: 'recurring',
        is_active: true,
        created_at: '2026-08-14T00:00:00Z',
        updated_at: '2026-08-14T00:00:00Z',
      },
    },
  ],
  page: 0,
  totalCount: 1,
  outstandingCount: 1,
  bucketCounts: { due_today: 0, overdue: 1 },
  planOptions: [{ id: 'plan-1', name: 'Monthly' }],
  summary: { today: 100, week: 700, month: 2500, outstanding: 1500 },
};

const readiness = {
  loading: false,
  ready: true,
  reason: null,
  resolution: null,
  templateName: 'gym_membership_renewal',
  templateLanguage: 'en_US',
};

beforeEach(() => {
  loadMemberPaymentDues.mockReset().mockResolvedValue(snapshot);
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PaymentsTable bounded data path', () => {
  it('loads one snapshot request and renders its page, exact count, and totals', async () => {
    render(
      <PaymentsTable
        readiness={readiness}
        onSelect={vi.fn()}
        reloadKey={0}
        onChanged={vi.fn()}
      />
    );

    expect(await screen.findByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Showing 1–1 of 1 payments due')).toBeTruthy();
    expect(screen.getByText('INR 100')).toBeTruthy();
    expect(screen.getByText('INR 700')).toBeTruthy();
    expect(screen.getByText('INR 2500')).toBeTruthy();
    expect(screen.getAllByText('INR 1500')).toHaveLength(2);
    expect(loadMemberPaymentDues).toHaveBeenCalledTimes(1);
    expect(loadMemberPaymentDues).toHaveBeenCalledWith(
      supabase,
      {
        today: '2026-08-28',
        search: '',
        filters: { buckets: [], plans: [] },
        sort: { key: 'due_date', dir: 'asc' },
        page: 0,
        pageSize: 25,
      },
      expect.any(AbortSignal)
    );
  });

  it('makes exactly one fresh snapshot request when realtime reload advances', async () => {
    const props = {
      readiness,
      onSelect: vi.fn(),
      onChanged: vi.fn(),
    };
    const view = render(<PaymentsTable {...props} reloadKey={0} />);
    await waitFor(() => expect(loadMemberPaymentDues).toHaveBeenCalledOnce());

    view.rerender(<PaymentsTable {...props} reloadKey={1} />);
    await waitFor(() => expect(loadMemberPaymentDues).toHaveBeenCalledTimes(2));
  });

  it('aborts and ignores a superseded lifecycle response', async () => {
    let resolveFirst!: (value: MemberPaymentDuesPage) => void;
    loadMemberPaymentDues
      .mockImplementationOnce(
        () =>
          new Promise<MemberPaymentDuesPage>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({
        ...snapshot,
        rows: [
          {
            ...snapshot.rows[0],
            id: 'membership-new',
            contact: { ...snapshot.rows[0].contact!, name: 'Fresh member' },
          },
        ],
      });
    const props = {
      readiness,
      onSelect: vi.fn(),
      onChanged: vi.fn(),
    };
    const view = render(<PaymentsTable {...props} reloadKey={0} />);
    await waitFor(() => expect(loadMemberPaymentDues).toHaveBeenCalledOnce());
    const firstSignal = loadMemberPaymentDues.mock.calls[0][2] as AbortSignal;

    view.rerender(<PaymentsTable {...props} reloadKey={1} />);
    expect(await screen.findByText('Fresh member')).toBeTruthy();
    expect(firstSignal.aborted).toBe(true);

    await act(async () => resolveFirst(snapshot));
    expect(screen.getByText('Fresh member')).toBeTruthy();
    expect(screen.queryByText('Asha Rao')).toBeNull();
  });

  it('preserves the totals and listing error states when the snapshot fails', async () => {
    loadMemberPaymentDues.mockRejectedValueOnce(new Error('RLS denied'));
    render(
      <PaymentsTable
        readiness={readiness}
        onSelect={vi.fn()}
        reloadKey={0}
        onChanged={vi.fn()}
      />
    );

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0].textContent).toContain(
      'Could not load payment totals: RLS denied'
    );
    expect(alerts[1].textContent).toContain(
      'Could not load payment dues: RLS denied'
    );
    expect(loadMemberPaymentDues).toHaveBeenCalledOnce();
  });
});
