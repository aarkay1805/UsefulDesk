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

// Every queue below mounts a `ScrollArea`, whose Base UI viewport calls
// `getAnimations()` on a timer after render. jsdom has no Web Animations API,
// so that throws outside any test's stack and Vitest reports an unhandled
// error even while the assertions pass. The stub is deliberately scoped to
// this file: setting it globally changes which branch Base UI's popover and
// dialog exit logic takes, and breaks the blocker tests that rely on it.
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

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
      number: (value: number) => String(value),
      phone: (value?: string | null) => value ?? '',
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
  FollowUpTaskLine: ({ note }: { note?: string | null }) => <span>{note}</span>,
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

import { ExpiringMemberships } from './expiring-memberships';
import { FollowUpQueue } from './follow-up-queue';
import { NeedsAttentionCard } from './needs-attention-card';
import { UncontactedLeads } from './uncontacted-leads';
import {
  DashboardActionsProvider,
  useDashboardActions,
} from './dashboard-actions';
import type { DashboardActionSnapshot } from '@/lib/dashboard/action-snapshot';

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
    mayLeave: 5,
    trials: 6,
    autoPay: { total: 0, rows: [] },
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
          snapshot.attention?.mayLeave,
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

    fireEvent.click(screen.getByRole('button', { name: /Enquiries/ }));
    expect(await screen.findByText('Lead One')).toBeTruthy();
    expect(screen.queryByText('Member One')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'See all' }).getAttribute('href')
    ).toBe('/leads?view=followups&scope=team');
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

function renderWith(section: ReactNode, snapshot: DashboardActionSnapshot) {
  return render(
    <DashboardActionsProvider initialSnapshot={snapshot}>
      {section}
    </DashboardActionsProvider>
  );
}

const baseSnapshot = payload as unknown as DashboardActionSnapshot;

describe('Home queues show exact populations', () => {
  beforeEach(() => {
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
  });

  it('opens each attention count on the list that holds exactly those people', () => {
    renderWith(<NeedsAttentionCard />, {
      ...baseSnapshot,
      attention: {
        trials: 2,
        mayLeave: 3,
        autoPay: {
          total: 2,
          rows: [
            {
              membershipId: 'membership-stopped',
              name: 'Kavita Menon',
              avatarUrl: null,
              problem: 'stopped',
            },
            {
              membershipId: 'membership-setup',
              name: 'Sanjay Gupta',
              avatarUrl: null,
              problem: 'setup_failed',
            },
          ],
        },
      },
    });

    expect(
      screen
        .getByRole('link', { name: /Trials to follow up/ })
        .getAttribute('href')
    ).toBe('/members?view=trials');
    expect(
      screen.getByRole('link', { name: /May leave/ }).getAttribute('href')
    ).toBe('/members?view=all&filter=may-leave');
    expect(
      screen.getByRole('link', { name: /Kavita Menon/ }).textContent
    ).toContain('AutoPay stopped after payments failed');
    expect(
      screen.getByRole('link', { name: /Sanjay Gupta/ }).getAttribute('href')
    ).toBe('/members?view=all&member=membership-setup');
    expect(
      screen.getByRole('link', { name: /Sanjay Gupta/ }).textContent
    ).toContain('AutoPay could not be set up');
    // Two AutoPay problems are both on screen, so no truncation note.
    expect(screen.queryByText(/AutoPay problems\./)).toBeNull();
  });

  it('gives a zero no row, and says so once when nothing needs attention', () => {
    renderWith(<NeedsAttentionCard />, {
      ...baseSnapshot,
      attention: { trials: 0, mayLeave: 4, autoPay: { total: 0, rows: [] } },
    });
    expect(screen.queryByText('Trials to follow up')).toBeNull();
    expect(screen.getByText('May leave')).toBeTruthy();
    cleanup();

    renderWith(<NeedsAttentionCard />, {
      ...baseSnapshot,
      attention: { trials: 0, mayLeave: 0, autoPay: { total: 0, rows: [] } },
    });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(
      screen.getByText(
        'No trials to follow up, AutoPay problems, or members marked “May leave”.'
      )
    ).toBeTruthy();
  });

  it('keeps a failed attention read distinct from an empty one', () => {
    renderWith(<NeedsAttentionCard />, {
      ...baseSnapshot,
      attention: null,
      errors: ['attention'],
    });
    expect(screen.getByText('Could not load these lists')).toBeTruthy();
    expect(screen.queryByText(/No trials to follow up/)).toBeNull();
  });

  it('shows the open follow-up on an expiring row and saves warnings for the next two days', () => {
    renderWith(<ExpiringMemberships />, {
      ...baseSnapshot,
      expiringMemberships: {
        total: 2,
        rows: [
          {
            id: 'membership-tomorrow',
            end_date: '2026-08-28',
            contact: { name: 'Asha Rao', phone: null, avatar_url: null },
            plan: { name: 'Monthly', plan_type: 'recurring' },
            followUp: { dueDate: '2026-08-26', ownerName: 'Nikhil' },
          },
          {
            id: 'membership-later',
            end_date: '2026-09-01',
            contact: { name: 'Ravi Kumar', phone: null, avatar_url: null },
            plan: { name: 'Monthly', plan_type: 'recurring' },
            followUp: null,
          },
        ],
      },
    });

    expect(
      screen.getByText('Monthly · Follow-up overdue · Nikhil')
    ).toBeTruthy();
    expect(screen.getByText('Expires tomorrow')).toBeTruthy();
    expect(screen.getByText('Expires in 5 days')).toBeTruthy();
    expect(screen.queryByText(/\dd$/)).toBeNull();
  });

  it('lists a fresh enquiry with how long it has waited', () => {
    renderWith(<UncontactedLeads />, {
      ...baseSnapshot,
      uncontactedLeads: {
        total: 2,
        rows: [
          {
            id: 'lead-fresh',
            name: 'Neha',
            avatarUrl: null,
            messagePreview: 'What are the fees?',
            waitingMinutes: 12,
          },
          {
            id: 'lead-old',
            name: 'Vikram',
            avatarUrl: null,
            messagePreview: 'No message yet',
            waitingMinutes: 3 * 24 * 60,
          },
        ],
      },
    });

    expect(screen.getByText('Waiting 12 minutes')).toBeTruthy();
    expect(screen.getByText('Waiting 3 days')).toBeTruthy();
    cleanup();

    renderWith(<UncontactedLeads />, {
      ...baseSnapshot,
      uncontactedLeads: { total: 0, rows: [] },
    });
    expect(
      screen.getByText('Your team has contacted every new enquiry.')
    ).toBeTruthy();
  });
});
