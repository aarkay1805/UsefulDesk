import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAccountLocale } from '@/lib/locale/config';
import { todayInTz } from '@/lib/locale/format';
import type { GymStats } from '@/lib/memberships/stats';
import type {
  DashboardFollowUpRow,
  DashboardFollowUpSnapshot,
  DashboardFollowUpStaffMember,
} from './follow-ups';
import type { DashboardActionAttention } from './action-attention';
import { measureDashboardStage } from './timing';

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

const DASHBOARD_ACTION_SECTIONS: DashboardActionSection[] = [
  'gymMetrics',
  'followUps',
  'expiringMemberships',
  'uncontactedLeads',
  'attention',
];

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
  attention: DashboardActionAttention | null;
  errors: DashboardActionSection[];
}

type JsonRecord = Record<string, unknown>;

function emptyDashboardActionSnapshot(today: string): DashboardActionSnapshot {
  return {
    today,
    gymMetrics: null,
    followUps: null,
    expiringMemberships: null,
    uncontactedLeads: null,
    attention: null,
    errors: [],
  };
}

function failedDashboardActionSnapshot(today: string): DashboardActionSnapshot {
  return {
    ...emptyDashboardActionSnapshot(today),
    errors: [...DASHBOARD_ACTION_SECTIONS],
  };
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as JsonRecord;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return string(value, label);
}

function number(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} is invalid`);
  }
  return parsed;
}

function count(value: unknown, label: string): number {
  const parsed = number(value, label);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function isoDate(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
    throw new Error(`${label} is invalid`);
  }
  return parsed;
}

function person(value: unknown, label: string) {
  if (value === null) return null;
  const row = record(value, label);
  return {
    name: nullableString(row.name, `${label}.name`),
    phone: nullableString(row.phone, `${label}.phone`),
    avatar_url: nullableString(row.avatar_url, `${label}.avatar_url`),
  };
}

function gymMetrics(value: unknown): GymStats {
  const row = record(value, 'gymMetrics');
  return {
    expiring7: count(row.expiring7, 'gymMetrics.expiring7'),
    feesDueCount: count(row.feesDueCount, 'gymMetrics.feesDueCount'),
    feesDueAmount: number(row.feesDueAmount, 'gymMetrics.feesDueAmount'),
    collectedToday: number(row.collectedToday, 'gymMetrics.collectedToday'),
    collectionDailyAverage7d: number(
      row.collectionDailyAverage7d,
      'gymMetrics.collectionDailyAverage7d'
    ),
    missedVisitRisk: count(row.missedVisitRisk, 'gymMetrics.missedVisitRisk'),
    neverVisitedRisk: count(
      row.neverVisitedRisk,
      'gymMetrics.neverVisitedRisk'
    ),
  };
}

function followUpRow(value: unknown, label: string): DashboardFollowUpRow {
  const row = record(value, label);
  const taskType = string(row.task_type, `${label}.task_type`);
  if (!['call', 'email', 'todo'].includes(taskType)) {
    throw new Error(`${label}.task_type is invalid`);
  }
  const reason = string(row.reason, `${label}.reason`);
  if (!['renewal', 'payment', 'trial', 'inactive', 'other'].includes(reason)) {
    throw new Error(`${label}.reason is invalid`);
  }
  return {
    id: string(row.id, `${label}.id`),
    contact_id: string(row.contact_id, `${label}.contact_id`),
    membership_id: nullableString(row.membership_id, `${label}.membership_id`),
    task_type: taskType as DashboardFollowUpRow['task_type'],
    reason: reason as DashboardFollowUpRow['reason'],
    due_date: isoDate(row.due_date, `${label}.due_date`),
    remind_at: nullableString(row.remind_at, `${label}.remind_at`),
    assigned_to: nullableString(row.assigned_to, `${label}.assigned_to`),
    note: nullableString(row.note, `${label}.note`),
    contact: person(row.contact, `${label}.contact`),
  };
}

function followUpRows(value: unknown, label: string): DashboardFollowUpRow[] {
  const rows = list(value, label);
  if (rows.length > DASHBOARD_ACTION_LIST_LIMIT) {
    throw new Error(`${label} is not bounded`);
  }
  return rows.map((row, index) => followUpRow(row, `${label}[${index}]`));
}

function followUpStaff(
  value: unknown,
  label: string
): DashboardFollowUpStaffMember[] {
  const rows = list(value, label);
  if (rows.length > DASHBOARD_ACTION_LIST_LIMIT * 2) {
    throw new Error(`${label} is not bounded`);
  }
  return rows.map((value, index) => {
    const row = record(value, `${label}[${index}]`);
    return {
      user_id: string(row.user_id, `${label}[${index}].user_id`),
      full_name:
        row.full_name === null
          ? ''
          : string(row.full_name, `${label}[${index}].full_name`),
      avatar_url: nullableString(
        row.avatar_url,
        `${label}[${index}].avatar_url`
      ),
    };
  });
}

function followUps(value: unknown): DashboardFollowUpSnapshot {
  const row = record(value, 'followUps');
  const counts = record(row.counts, 'followUps.counts');
  const rows = record(row.rows, 'followUps.rows');
  return {
    counts: {
      all: count(counts.all, 'followUps.counts.all'),
      lead: count(counts.lead, 'followUps.counts.lead'),
      member: count(counts.member, 'followUps.counts.member'),
    },
    rows: {
      all: followUpRows(rows.all, 'followUps.rows.all'),
      lead: followUpRows(rows.lead, 'followUps.rows.lead'),
      member: followUpRows(rows.member, 'followUps.rows.member'),
    },
    staff: followUpStaff(row.staff, 'followUps.staff'),
  };
}

function membershipQueue(value: unknown): DashboardMembershipQueue {
  const row = record(value, 'expiringMemberships');
  const rows = list(row.rows, 'expiringMemberships.rows');
  if (rows.length > DASHBOARD_ACTION_LIST_LIMIT) {
    throw new Error('expiringMemberships.rows is not bounded');
  }
  return {
    total: count(row.total, 'expiringMemberships.total'),
    rows: rows.map((value, index) => {
      const label = `expiringMemberships.rows[${index}]`;
      const item = record(value, label);
      const plan =
        item.plan === null ? null : record(item.plan, `${label}.plan`);
      return {
        id: string(item.id, `${label}.id`),
        end_date: isoDate(item.end_date, `${label}.end_date`),
        contact: person(item.contact, `${label}.contact`),
        plan: plan
          ? {
              name: nullableString(plan.name, `${label}.plan.name`),
              plan_type: nullableString(
                plan.plan_type,
                `${label}.plan.plan_type`
              ),
            }
          : null,
      };
    }),
  };
}

function uncontactedQueue(value: unknown): DashboardUncontactedQueue {
  const row = record(value, 'uncontactedLeads');
  const rows = list(row.rows, 'uncontactedLeads.rows');
  if (rows.length > DASHBOARD_ACTION_LIST_LIMIT) {
    throw new Error('uncontactedLeads.rows is not bounded');
  }
  return {
    total: count(row.total, 'uncontactedLeads.total'),
    rows: rows.map((value, index) => {
      const label = `uncontactedLeads.rows[${index}]`;
      const item = record(value, label);
      const messagePreview = string(
        item.messagePreview,
        `${label}.messagePreview`
      );
      if (messagePreview.length > DASHBOARD_MESSAGE_PREVIEW_LIMIT) {
        throw new Error(`${label}.messagePreview is not bounded`);
      }
      const waitingDays = count(item.waitingDays, `${label}.waitingDays`);
      if (waitingDays < 1) throw new Error(`${label}.waitingDays is invalid`);
      return {
        id: string(item.id, `${label}.id`),
        name: nullableString(item.name, `${label}.name`),
        avatarUrl: nullableString(item.avatarUrl, `${label}.avatarUrl`),
        messagePreview,
        waitingDays,
      };
    }),
  };
}

function attention(value: unknown): DashboardActionAttention {
  const row = record(value, 'attention');
  return {
    churnRisk: count(row.churnRisk, 'attention.churnRisk'),
    trialFollowups: count(row.trialFollowups, 'attention.trialFollowups'),
    failedMandates: count(row.failedMandates, 'attention.failedMandates'),
  };
}

function errors(value: unknown): DashboardActionSection[] {
  const found = list(value, 'errors');
  const unique = new Set<DashboardActionSection>();
  for (const item of found) {
    if (!DASHBOARD_ACTION_SECTIONS.includes(item as DashboardActionSection)) {
      throw new Error('errors is invalid');
    }
    unique.add(item as DashboardActionSection);
  }
  return DASHBOARD_ACTION_SECTIONS.filter((section) => unique.has(section));
}

function parseSection<T>(
  row: JsonRecord,
  section: DashboardActionSection,
  existingErrors: DashboardActionSection[],
  parse: (value: unknown) => T
): T | null {
  if (row[section] === null) {
    if (!existingErrors.includes(section)) existingErrors.push(section);
    return null;
  }
  try {
    return parse(row[section]);
  } catch {
    if (!existingErrors.includes(section)) existingErrors.push(section);
    return null;
  }
}

export function parseDashboardActionSnapshot(
  value: unknown
): DashboardActionSnapshot {
  const row = record(value, 'dashboard action snapshot');
  const parsedErrors = errors(row.errors);
  const snapshot: DashboardActionSnapshot = {
    today: isoDate(row.today, 'today'),
    gymMetrics: parseSection(row, 'gymMetrics', parsedErrors, gymMetrics),
    followUps: parseSection(row, 'followUps', parsedErrors, followUps),
    expiringMemberships: parseSection(
      row,
      'expiringMemberships',
      parsedErrors,
      membershipQueue
    ),
    uncontactedLeads: parseSection(
      row,
      'uncontactedLeads',
      parsedErrors,
      uncontactedQueue
    ),
    attention: parseSection(row, 'attention', parsedErrors, attention),
    errors: DASHBOARD_ACTION_SECTIONS.filter((section) =>
      parsedErrors.includes(section)
    ),
  };
  return snapshot;
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

/** One selected-branch database request for every bounded action section. */
export async function loadDashboardActionSnapshot(
  db: SupabaseClient,
  context: DashboardActionDateContext,
  now: Date = new Date()
): Promise<DashboardActionSnapshot> {
  try {
    return await measureDashboardStage('actions.snapshot', async () => {
      const { data, error } = await db.rpc('dashboard_action_snapshot', {
        p_today: context.today,
        p_time_zone: context.timeZone,
        p_now: now.toISOString(),
        p_limit: DASHBOARD_ACTION_LIST_LIMIT,
      });
      if (error) throw error;
      return parseDashboardActionSnapshot(data);
    });
  } catch (error) {
    console.error('[dashboard action snapshot] failed:', error);
    return failedDashboardActionSnapshot(context.today);
  }
}

/** Keep each existing provider island limited to the section it renders. */
export function selectDashboardActionSection(
  snapshot: DashboardActionSnapshot,
  section: DashboardActionSection
): DashboardActionSnapshot {
  const selected = emptyDashboardActionSnapshot(snapshot.today);
  switch (section) {
    case 'gymMetrics':
      selected.gymMetrics = snapshot.gymMetrics;
      break;
    case 'followUps':
      selected.followUps = snapshot.followUps;
      break;
    case 'expiringMemberships':
      selected.expiringMemberships = snapshot.expiringMemberships;
      break;
    case 'uncontactedLeads':
      selected.uncontactedLeads = snapshot.uncontactedLeads;
      break;
    case 'attention':
      selected.attention = snapshot.attention;
      break;
  }
  selected.errors = snapshot.errors.includes(section) ? [section] : [];
  return selected;
}
