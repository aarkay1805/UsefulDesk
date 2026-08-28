// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  useReminderReadiness: vi.fn(() => ({ ready: true })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: h.createClient,
}));
vi.mock('@/components/layout/branch-link', () => ({
  BranchLink: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/use-can', () => ({ useCan: () => true }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      today: () => '2026-08-27',
      date: (value: string) => value,
    },
  }),
}));
vi.mock('@/components/members/send-reminder-button', () => ({
  useReminderReadiness: h.useReminderReadiness,
}));
vi.mock('@/components/members/use-account-staff', () => ({
  useAccountStaff: () => ({ nameById: new Map(), avatarById: new Map() }),
}));
vi.mock('@/components/follow-ups/follow-up-task-summary', () => ({
  FollowUpTaskSummary: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock('@/components/follow-ups/follow-up-completion-control', () => ({
  FollowUpCompletionControl: ({
    onMarkDone,
    ariaLabel,
  }: {
    onMarkDone: (event: { stopPropagation: () => void }) => void;
    ariaLabel: string;
  }) => (
    <button onClick={() => onMarkDone({ stopPropagation() {} })}>
      {ariaLabel}
    </button>
  ),
}));
vi.mock('@/components/follow-ups/complete-follow-up-dialog', () => ({
  CompleteFollowUpDialog: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved}>Save completion</button>
  ),
}));
vi.mock('@/components/contacts/contact-detail-view', () => ({
  ContactDetailView: () => null,
}));
vi.mock('@/components/members/member-detail-view', () => ({
  MemberDetailView: () => null,
}));
vi.mock('@/components/members/member-form', () => ({ MemberForm: () => null }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => null }));

import { FollowUpQueue } from './follow-up-queue';
import {
  DashboardActionsProvider,
  useDashboardActions,
} from './dashboard-actions';

const leadFollowUp = {
  id: 'follow-up-lead',
  contact_id: 'lead-1',
  membership_id: null,
  task_type: 'call' as const,
  reason: 'other' as const,
  due_date: '2026-08-27',
  remind_at: null,
  assigned_to: null,
  note: null,
  contact: { name: 'Lead One', phone: null, avatar_url: null },
};
const memberFollowUp = {
  ...leadFollowUp,
  id: 'follow-up-member',
  contact_id: 'member-1',
  membership_id: 'membership-1',
  contact: { name: 'Member One', phone: null, avatar_url: null },
};

const payload = {
  today: '2026-08-27',
  gymMetrics: {
    expiring7: 2,
    feesDueCount: 3,
    feesDueAmount: 4000,
    collectedToday: 5000,
    collectionDailyAverage7d: 4500,
    missedVisitRisk: 1,
    neverVisitedRisk: 1,
  },
  followUps: {
    counts: { all: 2, lead: 1, member: 1 },
    rows: {
      all: [leadFollowUp, memberFollowUp],
      lead: [leadFollowUp],
      member: [memberFollowUp],
    },
    staff: [],
  },
  expiringMemberships: { rows: [], total: 3 },
  uncontactedLeads: { rows: [], total: 4 },
  attention: {
    renewalsDue: 0,
    outstandingDues: 0,
    outstandingAmount: 0,
    inactiveMembers: 0,
    churnRisk: 5,
    trialFollowups: 6,
    failedMandates: 7,
  },
  errors: [],
};

function SnapshotProbe() {
  const { snapshot, failed, refresh } = useDashboardActions();
  if (!snapshot) return <output>{failed ? 'failed' : 'loading'}</output>;
  return (
    <div>
      <output data-testid="action-sections">
        {[
          snapshot.gymMetrics?.expiring7,
          snapshot.followUps?.counts.all,
          snapshot.expiringMemberships?.total,
          snapshot.uncontactedLeads?.total,
          snapshot.attention?.churnRisk,
        ].join('|')}
      </output>
      <button onClick={refresh}>Refresh actions</button>
    </div>
  );
}

describe('DashboardActionsProvider consolidated request path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(payload))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hydrates all five action sections from one no-store browser request', async () => {
    render(
      <DashboardActionsProvider>
        <SnapshotProbe />
      </DashboardActionsProvider>
    );

    expect(await screen.findByText('2|2|3|4|5')).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/dashboard/actions', {
      cache: 'no-store',
    });
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it('uses the server snapshot without repeating the request after hydration', async () => {
    render(
      <DashboardActionsProvider initialSnapshot={payload}>
        <SnapshotProbe />
      </DashboardActionsProvider>
    );

    expect(screen.getByText('2|2|3|4|5')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh actions' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });

  it('switches preloaded follow-up scopes without a request and refreshes mutations through the same boundary', async () => {
    render(
      <DashboardActionsProvider>
        <FollowUpQueue />
      </DashboardActionsProvider>
    );

    expect(await screen.findByText('Lead One')).toBeTruthy();
    expect(screen.getByText('Member One')).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    expect(h.useReminderReadiness).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('listitem', { name: 'Open Member One details' })
    );
    await waitFor(() => expect(h.useReminderReadiness).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: /Leads/ }));
    expect(await screen.findByText('Lead One')).toBeTruthy();
    expect(screen.queryByText('Member One')).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole('button', { name: 'Complete follow-up for Lead One' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save completion' })
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/dashboard/actions', {
      cache: 'no-store',
    });
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it('surfaces an initial boundary failure instead of loading forever', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 403 })
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <DashboardActionsProvider>
        <SnapshotProbe />
      </DashboardActionsProvider>
    );

    expect(await screen.findByText('failed')).toBeTruthy();
  });

  it('keeps closed follow-up detail surfaces out of the initial dashboard bundle', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/dashboard/follow-up-queue.tsx'),
      'utf8'
    );

    expect(source).toContain("import dynamic from 'next/dynamic'");
    expect(source).toContain('{detailContactId ? (');
    expect(source).toContain('{editing ? (');
    expect(source).not.toContain("from '@/components/members/member-form'");
  });
});
