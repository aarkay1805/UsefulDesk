import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAccountLocale } from '@/lib/locale/config';
import { todayInTz } from '@/lib/locale/format';
import { istAddDays } from '@/lib/memberships/expiry';
import { loadGymStats, type GymStats } from '@/lib/memberships/stats';
import { loadOwnerAttention } from '@/lib/reports/reporting';
import type { OwnerAttention } from '@/lib/reports/types';
import {
  loadDashboardFollowUpSnapshot,
  type DashboardFollowUpSnapshot,
} from './follow-ups';

export const DASHBOARD_ACTION_LIST_LIMIT = 8;
export const DASHBOARD_RENEWAL_WINDOW_DAYS = 7;
export const DASHBOARD_UNCONTACTED_HOURS = 24;
export const DASHBOARD_MESSAGE_PREVIEW_LIMIT = 160;

export type DashboardActionSection =
  | 'gymMetrics'
  | 'followUps'
  | 'expiringMemberships'
  | 'uncontactedLeads'
  | 'attention';

export interface DashboardActionDateContext {
  timeZone: string;
  today: string;
}

export interface DashboardMembershipPreview {
  id: string;
  end_date: string;
  contact: {
    name: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
  plan: { name: string | null; plan_type: string | null } | null;
}

export interface DashboardMembershipQueue {
  rows: DashboardMembershipPreview[];
  total: number;
}

export interface DashboardUncontactedLead {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  messagePreview: string;
  waitingDays: number;
}

export interface DashboardUncontactedQueue {
  rows: DashboardUncontactedLead[];
  total: number;
}

export interface DashboardActionSnapshot {
  today: string;
  gymMetrics: GymStats | null;
  followUps: DashboardFollowUpSnapshot | null;
  expiringMemberships: DashboardMembershipQueue | null;
  uncontactedLeads: DashboardUncontactedQueue | null;
  attention: OwnerAttention | null;
  errors: DashboardActionSection[];
}

interface ExpiringQueryResult {
  data: DashboardMembershipPreview[] | null;
  count: number | null;
  error: unknown;
}

interface StaleLeadRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

/** Resolve calendar inputs from the authorized selected branch. */
export async function loadDashboardActionDateContext(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date()
): Promise<DashboardActionDateContext> {
  const { data, error } = await db
    .from('accounts')
    .select('timezone')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Selected branch is unavailable');

  const locale = resolveAccountLocale(data);
  return {
    timeZone: locale.timeZone,
    today: todayInTz(locale.timeZone, now),
  };
}

function expiringBase(
  db: SupabaseClient,
  context: DashboardActionDateContext,
  columns: string
) {
  return db
    .from('memberships')
    .select(columns, { count: 'exact' })
    .eq('is_trial', false)
    .eq('status', 'active')
    .gte('end_date', context.today)
    .lte('end_date', istAddDays(context.today, DASHBOARD_RENEWAL_WINDOW_DAYS))
    .order('end_date', { ascending: true })
    .limit(DASHBOARD_ACTION_LIST_LIMIT);
}

/**
 * Recurring and legacy plan-less memberships are queried separately so the
 * response can stay capped while its total still matches the renewal chase.
 */
export async function loadDashboardExpiringMemberships(
  db: SupabaseClient,
  context: DashboardActionDateContext
): Promise<DashboardMembershipQueue> {
  const common =
    'id, end_date, contact:contacts(name, phone, avatar_url), plan:membership_plans(name, plan_type)';
  const recurring =
    'id, end_date, contact:contacts(name, phone, avatar_url), plan:membership_plans!inner(name, plan_type)';
  const [legacyResult, recurringResult] = (await Promise.all([
    expiringBase(db, context, common).is('plan_id', null),
    expiringBase(db, context, recurring).eq(
      'membership_plans.plan_type',
      'recurring'
    ),
  ])) as [ExpiringQueryResult, ExpiringQueryResult];

  if (legacyResult.error) throw legacyResult.error;
  if (recurringResult.error) throw recurringResult.error;

  const legacyRows = legacyResult.data ?? [];
  const recurringRows = recurringResult.data ?? [];
  const rows = [...legacyRows, ...recurringRows]
    .sort(
      (left, right) =>
        left.end_date.localeCompare(right.end_date) ||
        left.id.localeCompare(right.id)
    )
    .slice(0, DASHBOARD_ACTION_LIST_LIMIT);

  return {
    rows,
    total:
      (legacyResult.count ?? legacyRows.length) +
      (recurringResult.count ?? recurringRows.length),
  };
}

/** A bounded first-response queue with only the text the card can display. */
export async function loadDashboardUncontactedLeads(
  db: SupabaseClient,
  now: Date = new Date()
): Promise<DashboardUncontactedQueue> {
  const staleCutoff = new Date(
    now.getTime() - DASHBOARD_UNCONTACTED_HOURS * 60 * 60 * 1000
  ).toISOString();
  const staleResult = await db
    .from('contacts')
    .select('id, name, avatar_url, created_at, memberships!left(id)', {
      count: 'exact',
    })
    .is('memberships', null)
    .is('lead_status', null)
    .lt('created_at', staleCutoff)
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_ACTION_LIST_LIMIT);
  if (staleResult.error) throw staleResult.error;

  const staleRows = (
    (staleResult.data ?? []) as unknown as StaleLeadRow[]
  ).slice(0, DASHBOARD_ACTION_LIST_LIMIT);
  const staleContactIds = staleRows.map((lead) => lead.id);
  const conversationResult =
    staleContactIds.length > 0
      ? await db
          .from('conversations')
          .select('contact_id, last_message_text')
          .in('contact_id', staleContactIds)
          .order('last_message_at', {
            ascending: false,
            nullsFirst: false,
          })
          .limit(staleContactIds.length)
      : { data: [], error: null };
  if (conversationResult.error) throw conversationResult.error;

  const messageByContact = new Map<string, string>();
  for (const conversation of conversationResult.data ?? []) {
    if (!messageByContact.has(conversation.contact_id)) {
      const preview =
        conversation.last_message_text?.trim() || 'No message yet';
      messageByContact.set(
        conversation.contact_id,
        preview.slice(0, DASHBOARD_MESSAGE_PREVIEW_LIMIT)
      );
    }
  }

  return {
    rows: staleRows.map((lead) => ({
      id: lead.id,
      name: lead.name,
      avatarUrl: lead.avatar_url,
      messagePreview: messageByContact.get(lead.id) ?? 'No message yet',
      waitingDays: Math.max(
        1,
        Math.floor(
          (now.getTime() - new Date(lead.created_at).getTime()) /
            (24 * 60 * 60 * 1000)
        )
      ),
    })),
    total: staleResult.count ?? 0,
  };
}

/**
 * One browser-visible snapshot, five independent server-side failure domains.
 * Every read runs through the selected branch's RLS-scoped client.
 */
export async function loadDashboardActionSnapshot(
  db: SupabaseClient,
  accountId: string,
  context: DashboardActionDateContext,
  now: Date = new Date()
): Promise<DashboardActionSnapshot> {
  const results = await Promise.allSettled([
    loadGymStats(db, context.today, context.timeZone),
    loadDashboardFollowUpSnapshot(db, accountId, DASHBOARD_ACTION_LIST_LIMIT),
    loadDashboardExpiringMemberships(db, context),
    loadDashboardUncontactedLeads(db, now),
    loadOwnerAttention(db, accountId, context.today, context.timeZone),
  ] as const);
  const sections: DashboardActionSection[] = [
    'gymMetrics',
    'followUps',
    'expiringMemberships',
    'uncontactedLeads',
    'attention',
  ];
  const errors = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    console.error(
      `[dashboard action snapshot] ${sections[index]} failed:`,
      result.reason
    );
    return [sections[index]];
  });

  return {
    today: context.today,
    gymMetrics: results[0].status === 'fulfilled' ? results[0].value : null,
    followUps: results[1].status === 'fulfilled' ? results[1].value : null,
    expiringMemberships:
      results[2].status === 'fulfilled' ? results[2].value : null,
    uncontactedLeads:
      results[3].status === 'fulfilled' ? results[3].value : null,
    attention: results[4].status === 'fulfilled' ? results[4].value : null,
    errors,
  };
}
