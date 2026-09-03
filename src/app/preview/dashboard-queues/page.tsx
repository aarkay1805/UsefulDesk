'use client';

import { notFound } from 'next/navigation';

import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { DashboardActionsProvider } from '@/components/dashboard/dashboard-actions';
import { ExpiringMemberships } from '@/components/dashboard/expiring-memberships';
import { FollowUpQueue } from '@/components/dashboard/follow-up-queue';
import { UncontactedLeads } from '@/components/dashboard/uncontacted-leads';
import type {
  DashboardActionSection,
  DashboardActionSnapshot,
} from '@/lib/dashboard/action-snapshot';
import type { DashboardFollowUpRow } from '@/lib/dashboard/follow-ups';
import type { ActivityItem } from '@/lib/dashboard/types';

// Dev-only visual harness for the dashboard's two paired queue rows. The real
// sections live behind auth on /dashboard, so this renders them against fixed
// data — enough rows in each to overflow the 480px cap and prove the scroll
// happens INSIDE the card rather than pushing the row below it down. Never
// reachable in production.
//
// `useAuth` falls back to a least-privileged value outside its provider, so
// the queues render here without one: every `canX` is false, which is also the
// read-only state worth eyeballing.

const TODAY = '2026-09-02';

function followUp(
  id: number,
  overrides: Partial<DashboardFollowUpRow> = {}
): DashboardFollowUpRow {
  return {
    id: `follow-up-${id}`,
    contact_id: `contact-${id}`,
    membership_id: null,
    task_type: 'call',
    reason: 'other',
    due_date: '2026-09-02',
    remind_at: null,
    assigned_to: 'staff-1',
    note: null,
    contact: { name: `Lead ${id}`, phone: '+919876543210', avatar_url: null },
    ...overrides,
  };
}

const FOLLOW_UP_ROWS: DashboardFollowUpRow[] = [
  followUp(1, {
    membership_id: 'membership-1',
    reason: 'renewal',
    note: 'Wants to switch to the quarterly plan before renewing — quote it.',
    contact: { name: 'Aarti Deshmukh', phone: null, avatar_url: null },
  }),
  followUp(2, {
    due_date: '2026-08-28',
    note: 'Asked for a call after 7pm.',
    contact: { name: 'Rohit', phone: '+919812345678', avatar_url: null },
  }),
  followUp(3, {
    task_type: 'todo',
    membership_id: 'membership-3',
    reason: 'payment',
    due_date: '2026-09-05',
    note: 'Second instalment pending; send the payment link again.',
    contact: { name: 'Priya Nair', phone: null, avatar_url: null },
  }),
  followUp(4, { task_type: 'email', note: null }),
  followUp(5, {
    membership_id: 'membership-5',
    reason: 'inactive',
    due_date: '2026-09-11',
    note: 'Has not checked in for three weeks.',
  }),
  followUp(6, { due_date: '2026-08-30', note: 'Trial ended, wants pricing.' }),
  followUp(7, { assigned_to: null, note: 'Walk-in enquiry, no owner yet.' }),
  followUp(8, {
    membership_id: 'membership-8',
    reason: 'trial',
    note: 'Bring the trainer schedule to the call.',
  }),
];

const SNAPSHOT: DashboardActionSnapshot = {
  today: TODAY,
  gymMetrics: null,
  followUps: {
    // Larger than the eight rows below, the way a real account is: the list
    // is capped at DASHBOARD_ACTION_LIST_LIMIT, so this is what exercises the
    // queue's "8 of 41" truncation signal.
    counts: { all: 41, lead: 17, member: 24 },
    rows: {
      all: FOLLOW_UP_ROWS,
      lead: FOLLOW_UP_ROWS.filter((row) => !row.membership_id),
      member: FOLLOW_UP_ROWS.filter((row) => row.membership_id),
    },
    staff: [{ user_id: 'staff-1', full_name: 'Nikhil Rao', avatar_url: null }],
  },
  expiringMemberships: {
    total: 23,
    rows: Array.from({ length: 8 }, (_, index) => ({
      id: `membership-${index}`,
      end_date: `2026-09-0${(index % 7) + 2}`,
      contact: {
        name: `Member ${index + 1}`,
        phone: '+919876543210',
        avatar_url: null,
      },
      plan: { name: 'Quarterly · Gym + Cardio', plan_type: 'membership' },
    })),
  },
  uncontactedLeads: {
    total: 14,
    rows: Array.from({ length: 8 }, (_, index) => ({
      id: `lead-${index}`,
      name: `Enquiry ${index + 1}`,
      avatarUrl: null,
      messagePreview:
        'Hi, what are your monthly charges and do you have a trial?',
      waitingDays: index + 1,
    })),
  },
  attention: null,
  errors: [] as DashboardActionSection[],
};

// Fixed instants, never `Date.now()`: this module is evaluated once on the
// server and again in the browser, so a clock-derived timestamp renders two
// different relative labels and hydration fails on the harness itself.
const ACTIVITY_ANCHOR = Date.parse(`${TODAY}T09:00:00.000Z`);

const ACTIVITY: ActivityItem[] = Array.from({ length: 14 }, (_, index) => ({
  id: `activity-${index}`,
  kind: (['message', 'contact', 'broadcast', 'automation'] as const)[index % 4],
  text: `Activity line ${index + 1} — a message, lead, broadcast, or automation`,
  at: new Date(ACTIVITY_ANCHOR - index * 3_600_000).toISOString(),
}));

export default function DashboardQueuesPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="bg-background min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 lg:grid-cols-2">
          <DashboardActionsProvider initialSnapshot={SNAPSHOT}>
            <FollowUpQueue />
          </DashboardActionsProvider>
          <DashboardActionsProvider initialSnapshot={SNAPSHOT}>
            <ExpiringMemberships />
          </DashboardActionsProvider>
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-8 lg:grid-cols-2">
          <DashboardActionsProvider initialSnapshot={SNAPSHOT}>
            <UncontactedLeads />
          </DashboardActionsProvider>
          <ActivityFeed items={ACTIVITY} loading={false} />
        </div>
      </div>
    </div>
  );
}
