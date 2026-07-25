import type { SupabaseClient } from '@supabase/supabase-js';

import { dayStartInTz } from '@/lib/locale/format';
import {
  humaniseKey,
  optionLabel,
  resolveFieldOptions,
} from '@/lib/leads/field-options';
import { reportDateRange } from '@/lib/reports/reporting';
import type {
  LeadRatingConfidence,
  LeadRatingMetric,
  LeadRatingMetricKey,
  LeadSourceRating,
  LeadSourceRatingData,
} from './types';

type RangeDays = 7 | 30 | 90;

export const ALL_LEADS_RATING_KEY = '__all_leads__';

const POSITIVE_FOLLOW_UP_OUTCOMES = new Set([
  'renewed',
  'paid',
  'promised',
  'contacted',
  'trial_booked',
]);

export const LEAD_RATING_TARGETS: Record<
  LeadRatingMetricKey,
  { label: string; weight: number; target: number }
> = {
  memberConversion: {
    label: 'Member conversion',
    weight: 35,
    target: 30,
  },
  trialBooking: {
    label: 'Trial booking proxy',
    weight: 20,
    target: 40,
  },
  humanResponse: {
    label: 'First human response within 24h',
    weight: 15,
    target: 90,
  },
  followUp: {
    label: 'On-time follow-up completion',
    weight: 15,
    target: 90,
  },
  positiveOutcome: {
    label: 'Positive follow-up outcome',
    weight: 15,
    target: 60,
  },
};

export interface LeadRatingRows {
  contacts: Array<{
    id: string;
    source: string | null;
    lead_status: string | null;
    created_at: string;
  }>;
  memberships: Array<{
    contact_id: string;
    is_trial: boolean;
    converted_at: string | null;
    created_at: string;
  }>;
  conversations: Array<{
    id: string;
    contact_id: string;
  }>;
  messages: Array<{
    conversation_id: string;
    sender_type: string;
    created_at: string;
  }>;
  followUps: Array<{
    contact_id: string;
    status: string;
    outcome: string | null;
    due_date: string;
    completed_at: string | null;
    created_at: string;
  }>;
}

function sourceKey(value: string | null): string {
  return value?.trim() || 'unknown';
}

function rate(successes: number, sample: number): number | null {
  if (sample === 0) return null;
  return (successes / sample) * 100;
}

function metric(
  key: LeadRatingMetricKey,
  successes: number,
  sample: number
): LeadRatingMetric {
  const config = LEAD_RATING_TARGETS[key];
  const actual = rate(successes, sample);
  return {
    key,
    ...config,
    actual,
    normalized:
      actual == null ? null : Math.min(100, (actual / config.target) * 100),
    successes,
    sample,
  };
}

function confidenceFor(metrics: LeadRatingMetric[]): {
  confidence: LeadRatingConfidence;
  confidenceSample: number;
} {
  if (metrics.some((item) => item.normalized == null)) {
    return { confidence: 'insufficient', confidenceSample: 0 };
  }
  const confidenceSample = Math.min(...metrics.map((item) => item.sample));
  if (confidenceSample < 10) return { confidence: 'low', confidenceSample };
  if (confidenceSample < 30) {
    return { confidence: 'directional', confidenceSample };
  }
  return { confidence: 'strong', confidenceSample };
}

function endOfDueDate(dueDate: string, timeZone: string): number | null {
  const next = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(next.getTime())) return null;
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDay = next.toISOString().slice(0, 10);
  return dayStartInTz(nextDay, timeZone)?.getTime() ?? null;
}

/**
 * Builds source diagnostics over an acquisition cohort. A contact belongs to
 * the source it currently attributes to, and outcomes are observed through
 * `now`. Missing response/follow-up samples stay unavailable instead of
 * quietly becoming zero.
 */
export function aggregateLeadSourceRatings(
  rows: LeadRatingRows,
  rangeDays: RangeDays,
  period: { start: string; end: string },
  timeZone: string,
  sourceLabels: ReadonlyMap<string, string> = new Map(),
  now: Date = new Date()
): LeadSourceRatingData {
  const contactsBySource = new Map<string, LeadRatingRows['contacts']>();
  const contactById = new Map(
    rows.contacts.map((contact) => [contact.id, contact])
  );
  for (const contact of rows.contacts) {
    const key = sourceKey(contact.source);
    const bucket = contactsBySource.get(key) ?? [];
    bucket.push(contact);
    contactsBySource.set(key, bucket);
  }

  const membershipByContact = new Map(
    rows.memberships
      .filter((membership) => contactById.has(membership.contact_id))
      .map((membership) => [membership.contact_id, membership])
  );
  const followUpsByContact = new Map<string, LeadRatingRows['followUps']>();
  for (const followUp of rows.followUps) {
    if (!contactById.has(followUp.contact_id)) continue;
    const bucket = followUpsByContact.get(followUp.contact_id) ?? [];
    bucket.push(followUp);
    followUpsByContact.set(followUp.contact_id, bucket);
  }

  const contactByConversation = new Map(
    rows.conversations
      .filter((conversation) => contactById.has(conversation.contact_id))
      .map((conversation) => [conversation.id, conversation.contact_id])
  );
  const messagesByContact = new Map<string, LeadRatingRows['messages']>();
  for (const message of rows.messages) {
    const contactId = contactByConversation.get(message.conversation_id);
    if (!contactId) continue;
    const bucket = messagesByContact.get(contactId) ?? [];
    bucket.push(message);
    messagesByContact.set(contactId, bucket);
  }
  for (const messages of messagesByContact.values()) {
    messages.sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );
  }

  const today = period.end;
  const buildRating = (
    key: string,
    label: string,
    contacts: LeadRatingRows['contacts']
  ): LeadSourceRating => {
    let converted = 0;
    let trialBooked = 0;
    let responseSample = 0;
    let responseIn24h = 0;
    let followUpSample = 0;
    let followUpOnTime = 0;
    let outcomeSample = 0;
    let positiveOutcomes = 0;

    for (const contact of contacts) {
      const contactCreatedAt = Date.parse(contact.created_at);
      const membership = membershipByContact.get(contact.id);
      const joinedAt = membership
        ? Date.parse(membership.converted_at ?? membership.created_at)
        : Number.NaN;
      if (
        membership &&
        !membership.is_trial &&
        Number.isFinite(joinedAt) &&
        joinedAt >= contactCreatedAt &&
        joinedAt <= now.getTime()
      ) {
        converted += 1;
      }

      const contactFollowUps = followUpsByContact.get(contact.id) ?? [];
      for (const followUp of contactFollowUps) {
        if (followUp.status !== 'done' || followUp.outcome == null) continue;
        outcomeSample += 1;
        if (POSITIVE_FOLLOW_UP_OUTCOMES.has(followUp.outcome)) {
          positiveOutcomes += 1;
        }
      }
      const hasTrialOutcome = contactFollowUps.some(
        (followUp) =>
          followUp.status === 'done' && followUp.outcome === 'trial_booked'
      );
      if (
        contact.lead_status === 'trial_booked' ||
        hasTrialOutcome ||
        membership?.is_trial ||
        membership?.converted_at != null
      ) {
        trialBooked += 1;
      }

      const messages = (messagesByContact.get(contact.id) ?? []).filter(
        (message) => Date.parse(message.created_at) >= contactCreatedAt
      );
      const firstInboundIndex = messages.findIndex(
        (message) => message.sender_type === 'customer'
      );
      if (firstInboundIndex >= 0) {
        responseSample += 1;
        const inboundAt = Date.parse(messages[firstInboundIndex].created_at);
        const response = messages
          .slice(firstInboundIndex + 1)
          .find((message) => message.sender_type === 'agent');
        if (
          response &&
          Date.parse(response.created_at) - inboundAt <= 24 * 60 * 60 * 1000
        ) {
          responseIn24h += 1;
        }
      }

      for (const followUp of contactFollowUps) {
        if (followUp.status === 'cancelled' || followUp.due_date > today) {
          continue;
        }
        followUpSample += 1;
        const dueEnd = endOfDueDate(followUp.due_date, timeZone);
        const completedAt = followUp.completed_at
          ? Date.parse(followUp.completed_at)
          : Number.NaN;
        if (
          followUp.status === 'done' &&
          dueEnd != null &&
          Number.isFinite(completedAt) &&
          completedAt < dueEnd
        ) {
          followUpOnTime += 1;
        }
      }
    }

    const metrics = [
      metric('memberConversion', converted, contacts.length),
      metric('trialBooking', trialBooked, contacts.length),
      metric('humanResponse', responseIn24h, responseSample),
      metric('followUp', followUpOnTime, followUpSample),
      metric('positiveOutcome', positiveOutcomes, outcomeSample),
    ];
    const hasAllMetrics = metrics.every((item) => item.normalized != null);
    const rating = hasAllMetrics
      ? metrics.reduce(
          (sum, item) => sum + ((item.normalized ?? 0) * item.weight) / 100,
          0
        )
      : null;
    const confidence = confidenceFor(metrics);

    return {
      key,
      label,
      cohortSize: contacts.length,
      rating,
      metrics,
      ...confidence,
    };
  };

  const allLeads = buildRating(
    ALL_LEADS_RATING_KEY,
    'All leads',
    rows.contacts
  );
  const sources = Array.from(contactsBySource.entries())
    .map(([key, contacts]) =>
      buildRating(
        key,
        key === 'unknown'
          ? 'Unknown'
          : (sourceLabels.get(key) ?? humaniseKey(key)),
        contacts
      )
    )
    .sort(
      (a, b) =>
        b.cohortSize - a.cohortSize ||
        (b.rating ?? -1) - (a.rating ?? -1) ||
        a.label.localeCompare(b.label)
    );

  return {
    rangeDays,
    period,
    allLeads,
    sources,
    totalCohort: rows.contacts.length,
  };
}

type PagedResult = PromiseLike<{ data: unknown[] | null; error: unknown }>;

async function fetchAll<T>(
  page: (from: number, to: number) => PagedResult
): Promise<T[]> {
  const pageSize = 1_000;
  const result: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const response = await page(from, from + pageSize - 1);
    if (response.error) throw response.error;
    const batch = (response.data ?? []) as T[];
    result.push(...batch);
    if (batch.length < pageSize) return result;
  }
}

function shiftDate(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function loadLeadSourceRatings(
  db: SupabaseClient,
  rangeDays: RangeDays,
  timeZone: string,
  today: string
): Promise<LeadSourceRatingData> {
  const period = reportDateRange(today, rangeDays);
  const start = dayStartInTz(period.start, timeZone);
  const end = dayStartInTz(shiftDate(period.end, 1), timeZone);
  if (!start || !end) throw new Error('Could not resolve lead rating dates');
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [
    contacts,
    memberships,
    conversations,
    messages,
    followUps,
    sourceRows,
  ] = await Promise.all([
    fetchAll<LeadRatingRows['contacts'][number]>((from, to) =>
      db
        .from('contacts')
        .select('id, source, lead_status, created_at')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('id')
        .range(from, to)
    ),
    fetchAll<LeadRatingRows['memberships'][number]>((from, to) =>
      db
        .from('memberships')
        .select('id, contact_id, is_trial, converted_at, created_at')
        .gte('created_at', startIso)
        .order('id')
        .range(from, to)
    ),
    fetchAll<LeadRatingRows['conversations'][number]>((from, to) =>
      db
        .from('conversations')
        .select('id, contact_id')
        .gte('created_at', startIso)
        .order('id')
        .range(from, to)
    ),
    fetchAll<LeadRatingRows['messages'][number]>((from, to) =>
      db
        .from('messages')
        .select('id, conversation_id, sender_type, created_at')
        .gte('created_at', startIso)
        .order('id')
        .range(from, to)
    ),
    fetchAll<LeadRatingRows['followUps'][number]>((from, to) =>
      db
        .from('follow_ups')
        .select(
          'id, contact_id, status, outcome, due_date, completed_at, created_at'
        )
        .gte('created_at', startIso)
        .order('id')
        .range(from, to)
    ),
    db
      .from('lead_field_options')
      .select('key, label')
      .eq('field', 'source')
      .order('sort_order', { ascending: true }),
  ]);

  if (sourceRows.error) throw sourceRows.error;
  const sourceOptions = resolveFieldOptions('source', sourceRows.data ?? []);
  const labels = new Map(
    sourceOptions.map((source) => [
      source.key,
      optionLabel(sourceOptions, source.key),
    ])
  );

  return aggregateLeadSourceRatings(
    { contacts, memberships, conversations, messages, followUps },
    rangeDays,
    period,
    timeZone,
    labels
  );
}
