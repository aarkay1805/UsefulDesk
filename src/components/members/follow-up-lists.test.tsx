// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberFollowUpsPage } from '@/lib/memberships/member-follow-ups';
import type { FollowUp } from '@/types';

const loadMemberFollowUps = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const supabase = vi.hoisted(() => ({ marker: 'browser-client' }));

vi.mock('@/lib/memberships/member-follow-ups', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/memberships/member-follow-ups')
    >();
  return { ...original, loadMemberFollowUps };
});

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabase }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    accountId: 'account-1',
    canSendMessages: true,
  }),
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
vi.mock('@/hooks/use-table-prefs', () => ({
  useTablePrefs: () => [
    { pageSize: 25, sort: null, order: [], hidden: [], widths: {} },
    vi.fn(),
  ],
}));
vi.mock('./use-account-staff', () => ({
  useAccountStaff: () => ({
    staff: [],
    nameById: new Map([['user-1', 'Rajat']]),
    avatarById: new Map(),
  }),
}));
vi.mock('@/components/follow-ups/follow-up-queue-controls', () => ({
  FollowUpQueueControls: ({
    counts,
  }: {
    counts: MemberFollowUpsPage['bucketCounts'];
  }) => (
    <output data-testid="counts">
      {counts.all}/{counts.overdue}/{counts.today}/{counts.upcoming}
    </output>
  ),
}));
vi.mock('@/components/table/column-header', () => ({
  ColumnHeader: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock('@/components/leads/editable-cell', () => ({
  EditableCell: ({ display }: { display: React.ReactNode }) => display,
}));
vi.mock('./member-identity', () => ({
  MemberIdentity: ({ name }: { name?: string }) => <span>{name}</span>,
}));
vi.mock('./member-avatar-quick-view', () => ({
  buildMemberAvatarPreview: () => undefined,
}));
vi.mock('@/components/follow-ups/follow-up-task-summary', () => ({
  FollowUpTaskSummary: ({ note }: { note?: string }) => <span>{note}</span>,
}));
vi.mock('@/components/follow-ups/follow-up-completion-control', () => ({
  FollowUpCompletionButton: () => <button type="button">Complete</button>,
}));
vi.mock('@/components/follow-ups/complete-follow-up-dialog', () => ({
  CompleteFollowUpDialog: () => null,
  BulkCompleteFollowUpsDialog: () => null,
}));
vi.mock('./send-reminder-button', () => ({
  SendReminderButton: () => <button type="button">Remind</button>,
}));

const { FollowUpLists } = await import('./follow-up-lists');

const row = {
  id: 'follow-up-1',
  account_id: 'account-1',
  contact_id: 'contact-1',
  membership_id: 'membership-1',
  assigned_to: 'user-1',
  created_by: 'user-1',
  reason: 'renewal',
  task_type: 'call',
  due_date: '2026-08-29',
  status: 'open',
  note: 'Call after lunch',
  created_at: '2026-08-20T00:00:00Z',
  updated_at: '2026-08-20T00:00:00Z',
  contact: { name: 'Asha Rao', phone: '+919876543210' },
  membership: {
    id: 'membership-1',
    member_number: 1001,
    contact: { name: 'Asha Rao', phone: '+919876543210' },
  },
} as unknown as FollowUp;

const snapshot: MemberFollowUpsPage = {
  rows: [row],
  page: 0,
  totalCount: 1,
  bucketCounts: { all: 1, overdue: 0, today: 0, upcoming: 1 },
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
  loadMemberFollowUps.mockReset().mockResolvedValue(snapshot);
  toastError.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FollowUpLists bounded data path', () => {
  const props = {
    readiness,
    onSelect: vi.fn(),
    onChanged: vi.fn(),
    canEdit: true,
  };

  it('loads one snapshot and renders its row, exact total, and contextual facets', async () => {
    render(<FollowUpLists {...props} reloadKey={0} />);

    expect(await screen.findByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('1 follow-up')).toBeTruthy();
    expect(screen.getByTestId('counts').textContent).toBe('1/0/0/1');
    expect(loadMemberFollowUps).toHaveBeenCalledTimes(1);
    expect(loadMemberFollowUps).toHaveBeenCalledWith(
      supabase,
      {
        today: '2026-08-28',
        search: '',
        scope: 'mine',
        filters: { buckets: [], reasons: [], assignees: [] },
        sort: null,
        page: 0,
        pageSize: 25,
      },
      expect.any(AbortSignal)
    );
  });

  it('keeps the existing loading and empty states around a bounded response', async () => {
    let resolveLoad!: (value: MemberFollowUpsPage) => void;
    loadMemberFollowUps.mockImplementationOnce(
      () =>
        new Promise<MemberFollowUpsPage>((resolve) => {
          resolveLoad = resolve;
        })
    );
    render(<FollowUpLists {...props} reloadKey={0} />);

    expect(screen.getByText('Loading follow-ups')).toBeTruthy();
    await act(async () =>
      resolveLoad({
        rows: [],
        page: 0,
        totalCount: 0,
        bucketCounts: { all: 0, overdue: 0, today: 0, upcoming: 0 },
      })
    );
    expect(
      await screen.findByText('No open member follow-ups in My work.')
    ).toBeTruthy();
  });

  it('makes exactly one fresh snapshot request when realtime reload advances', async () => {
    const view = render(<FollowUpLists {...props} reloadKey={0} />);
    await waitFor(() => expect(loadMemberFollowUps).toHaveBeenCalledOnce());

    view.rerender(<FollowUpLists {...props} reloadKey={1} />);
    await waitFor(() => expect(loadMemberFollowUps).toHaveBeenCalledTimes(2));
  });

  it('aborts and ignores a superseded lifecycle response', async () => {
    let resolveFirst!: (value: MemberFollowUpsPage) => void;
    loadMemberFollowUps
      .mockImplementationOnce(
        () =>
          new Promise<MemberFollowUpsPage>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({
        ...snapshot,
        rows: [
          {
            ...row,
            id: 'follow-up-new',
            contact: { ...row.contact!, name: 'Fresh member' },
          },
        ],
      });
    const view = render(<FollowUpLists {...props} reloadKey={0} />);
    await waitFor(() => expect(loadMemberFollowUps).toHaveBeenCalledOnce());
    const firstSignal = loadMemberFollowUps.mock.calls[0][2] as AbortSignal;

    view.rerender(<FollowUpLists {...props} reloadKey={1} />);
    expect(await screen.findByText('Fresh member')).toBeTruthy();
    expect(firstSignal.aborted).toBe(true);

    await act(async () => resolveFirst(snapshot));
    expect(screen.getByText('Fresh member')).toBeTruthy();
    expect(screen.queryByText('Asha Rao')).toBeNull();
  });

  it('keeps the last good rows, toasts errors, and recovers on the next reload', async () => {
    const view = render(<FollowUpLists {...props} reloadKey={0} />);
    expect(await screen.findByText('Asha Rao')).toBeTruthy();
    loadMemberFollowUps.mockRejectedValueOnce(new Error('RLS denied'));

    view.rerender(<FollowUpLists {...props} reloadKey={1} />);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('RLS denied'));
    expect(screen.getByText('Asha Rao')).toBeTruthy();

    loadMemberFollowUps.mockResolvedValueOnce({
      ...snapshot,
      rows: [
        {
          ...row,
          id: 'follow-up-recovered',
          contact: { ...row.contact!, name: 'Recovered member' },
        },
      ],
    });
    view.rerender(<FollowUpLists {...props} reloadKey={2} />);
    expect(await screen.findByText('Recovered member')).toBeTruthy();
    expect(loadMemberFollowUps).toHaveBeenCalledTimes(3);
  });

  it('renders the server-clamped page without a duplicate request', async () => {
    loadMemberFollowUps.mockResolvedValueOnce({
      ...snapshot,
      page: 1,
      totalCount: 26,
    });
    render(<FollowUpLists {...props} reloadKey={0} />);

    expect(await screen.findByText('Page 2 of 2')).toBeTruthy();
    expect(loadMemberFollowUps).toHaveBeenCalledOnce();
  });
});
