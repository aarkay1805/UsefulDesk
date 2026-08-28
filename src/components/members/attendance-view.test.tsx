// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttendanceSnapshotPage } from '@/lib/memberships/attendance-snapshot';
import type { Membership } from '@/types';

const loadAttendanceSnapshot = vi.hoisted(() => vi.fn());
const supabase = vi.hoisted(() => ({ marker: 'browser-client' }));
const auth = vi.hoisted(() => ({
  user: { id: 'user-1' },
  accountId: 'account-1',
  canSendMessages: true,
}));

vi.mock('@/lib/memberships/attendance-snapshot', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/memberships/attendance-snapshot')
    >();
  return { ...original, loadAttendanceSnapshot };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabase }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => auth,
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: {
      locale: 'en-IN',
      timeZone: 'Asia/Kolkata',
      weekStart: 1,
    },
    fmt: {
      today: () => '2026-08-28',
      date: (value: string) => value,
      time: (value: string) => value.slice(11, 16),
    },
  }),
}));
vi.mock('@/components/table/column-header', () => ({
  ColumnHeader: ({
    label,
    onSort,
    filter,
  }: {
    label: string;
    onSort: (dir: 'asc' | 'desc') => void;
    filter?: {
      options: { value: string; label: string }[];
      onToggle: (value: string) => void;
    };
  }) => (
    <div>
      <button
        type="button"
        aria-label={`Sort ${label}`}
        onClick={() => onSort('desc')}
      >
        {label}
      </button>
      {filter?.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={`Filter ${option.label}`}
          onClick={() => filter.onToggle(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('./member-identity', () => ({
  MemberIdentity: ({ name }: { name?: string }) => <span>{name}</span>,
}));
vi.mock('./member-avatar-quick-view', () => ({
  buildMemberAvatarPreview: () => undefined,
}));
vi.mock('./attendance-override-dialog', () => ({
  AttendanceOverrideDialog: () => null,
}));
vi.mock('@/components/follow-ups/follow-up-dialog', () => ({
  FollowUpDialog: () => null,
}));

const { AttendanceView } = await import('./attendance-view');

const membership = {
  id: 'membership-1',
  account_id: 'account-1',
  contact_id: 'contact-1',
  member_number: 1001,
  user_id: 'user-1',
  plan_id: 'plan-1',
  start_date: '2026-08-01',
  end_date: '2026-09-01',
  status: 'active',
  fee_amount: 2500,
  fee_status: 'paid',
  is_trial: false,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  contact: {
    id: 'contact-1',
    account_id: 'account-1',
    user_id: 'user-1',
    name: 'Asha Rao',
    phone: '+919876543210',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
  plan: {
    id: 'plan-1',
    account_id: 'account-1',
    name: 'Ten sessions',
    price: 2500,
    duration_days: 30,
    plan_type: 'session_pack',
    sessions_count: 10,
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
} as Membership;

const snapshot: AttendanceSnapshotPage = {
  rows: [{ membership, attendance: null, used: 3 }],
  page: 0,
  totalCount: 1,
  presentCount: 4,
  absentCount: 7,
  planOptions: [{ value: 'plan-1', label: 'Ten sessions' }],
};

const readiness = {
  loading: false,
  ready: true,
  reason: null,
  resolution: null,
  templateName: 'gym_membership_renewal',
  templateLanguage: 'en_US',
};

const props = {
  readiness,
  reloadKey: 0,
  onSelect: vi.fn(),
  onAttendanceChanged: vi.fn(),
};

beforeEach(() => {
  loadAttendanceSnapshot.mockReset().mockResolvedValue(snapshot);
  auth.canSendMessages = true;
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

describe('AttendanceView bounded data path', () => {
  it('loads one snapshot and renders its row, usage, exact facets, and total', async () => {
    render(<AttendanceView {...props} />);

    expect(await screen.findByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('7 of 10 sessions left')).toBeTruthy();
    expect(screen.getByText('Showing 1–1 of 1 absent members')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Present members' }).textContent
    ).toContain('4');
    expect(
      screen.getByRole('button', { name: 'Absent members' }).textContent
    ).toContain('7');
    expect(loadAttendanceSnapshot).toHaveBeenCalledOnce();
    expect(loadAttendanceSnapshot).toHaveBeenCalledWith(
      supabase,
      {
        dayStart: '2026-08-27T18:30:00.000Z',
        dayEnd: '2026-08-28T18:30:00.000Z',
        today: '2026-08-28',
        timeZone: 'Asia/Kolkata',
        weekStart: 1,
        includeUsage: true,
        bucket: 'absent',
        search: '',
        planIds: [],
        sort: { key: 'name', dir: 'asc' },
        page: 0,
        pageSize: 25,
      },
      expect.any(AbortSignal)
    );
  });

  it('makes exactly one fresh request when realtime reload advances', async () => {
    const view = render(<AttendanceView {...props} />);
    await waitFor(() => expect(loadAttendanceSnapshot).toHaveBeenCalledOnce());

    view.rerender(<AttendanceView {...props} reloadKey={1} />);
    await waitFor(() =>
      expect(loadAttendanceSnapshot).toHaveBeenCalledTimes(2)
    );
  });

  it('aborts and ignores a superseded lifecycle response', async () => {
    let resolveFirst!: (value: AttendanceSnapshotPage) => void;
    loadAttendanceSnapshot
      .mockImplementationOnce(
        () =>
          new Promise<AttendanceSnapshotPage>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({
        ...snapshot,
        rows: [
          {
            ...snapshot.rows[0],
            membership: {
              ...membership,
              id: 'membership-fresh',
              contact: { ...membership.contact!, name: 'Fresh member' },
            },
          },
        ],
      });
    const view = render(<AttendanceView {...props} />);
    await waitFor(() => expect(loadAttendanceSnapshot).toHaveBeenCalledOnce());
    const firstSignal = loadAttendanceSnapshot.mock.calls[0][2] as AbortSignal;

    view.rerender(<AttendanceView {...props} reloadKey={1} />);
    expect(await screen.findByText('Fresh member')).toBeTruthy();
    expect(firstSignal.aborted).toBe(true);

    await act(async () => resolveFirst(snapshot));
    expect(screen.getByText('Fresh member')).toBeTruthy();
    expect(screen.queryByText('Asha Rao')).toBeNull();
  });

  it('keeps the inline error state and recovers on retry by reload', async () => {
    loadAttendanceSnapshot.mockRejectedValueOnce(new Error('RLS denied'));
    const view = render(<AttendanceView {...props} />);

    expect(await screen.findByText('RLS denied')).toBeTruthy();
    view.rerender(<AttendanceView {...props} reloadKey={1} />);
    expect(await screen.findByText('Asha Rao')).toBeTruthy();
  });

  it('loads past-day boundaries without usage and keeps actions read-only', async () => {
    render(<AttendanceView {...props} />);
    await screen.findByText('Asha Rao');

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() =>
      expect(loadAttendanceSnapshot).toHaveBeenCalledTimes(2)
    );
    expect(loadAttendanceSnapshot.mock.calls[1][1]).toMatchObject({
      dayStart: '2026-08-26T18:30:00.000Z',
      dayEnd: '2026-08-27T18:30:00.000Z',
      includeUsage: false,
      page: 0,
    });
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });

  it('renders a server-clamped larger page without a duplicate request', async () => {
    loadAttendanceSnapshot.mockResolvedValueOnce({
      ...snapshot,
      page: 1,
      totalCount: 26,
    });
    render(<AttendanceView {...props} />);

    expect(await screen.findByText('Page 2 of 2')).toBeTruthy();
    expect(screen.getByText('Showing 26–26 of 26 absent members')).toBeTruthy();
    expect(loadAttendanceSnapshot).toHaveBeenCalledOnce();
  });

  it('forwards search, bucket, plan, sort, and page interactions to bounded requests', async () => {
    loadAttendanceSnapshot.mockResolvedValue({
      ...snapshot,
      totalCount: 26,
      absentCount: 26,
    });
    render(<AttendanceView {...props} />);
    await screen.findByText('Asha Rao');

    fireEvent.change(
      screen.getByRole('searchbox', {
        name: 'Search attendance by name or Member ID',
      }),
      { target: { value: '1001' } }
    );
    await waitFor(() =>
      expect(loadAttendanceSnapshot.mock.calls.at(-1)?.[1]).toMatchObject({
        search: '1001',
        page: 0,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Present members' }));
    await waitFor(() =>
      expect(loadAttendanceSnapshot.mock.calls.at(-1)?.[1]).toMatchObject({
        bucket: 'present',
        page: 0,
      })
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Filter Ten sessions' })
    );
    await waitFor(() =>
      expect(loadAttendanceSnapshot.mock.calls.at(-1)?.[1]).toMatchObject({
        planIds: ['plan-1'],
        page: 0,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sort Check-in' }));
    await waitFor(() =>
      expect(loadAttendanceSnapshot.mock.calls.at(-1)?.[1]).toMatchObject({
        sort: { key: 'checked_in_at', dir: 'desc' },
        page: 0,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(loadAttendanceSnapshot.mock.calls.at(-1)?.[1]).toMatchObject({
        page: 1,
        pageSize: 25,
      })
    );
  });

  it('keeps attendance mutations disabled for read-only roles', async () => {
    auth.canSendMessages = false;
    render(<AttendanceView {...props} />);

    const checkIn = await screen.findByRole('button', { name: 'Check in' });
    expect((checkIn as HTMLButtonElement).disabled).toBe(true);
    expect(checkIn.getAttribute('title')).toContain('Read-only');
  });
});
