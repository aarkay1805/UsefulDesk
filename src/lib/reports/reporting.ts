import type { SupabaseClient } from '@supabase/supabase-js';
import {
  humaniseKey,
  optionLabel,
  resolveFieldOptions,
} from '@/lib/leads/field-options';
import { dayStartInTz, todayInTz } from '@/lib/locale/format';
import type { OwnerReport, ReportRangeDays } from './types';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metric(value: unknown) {
  const row = record(value);
  return {
    current: number(row.current),
    previous: number(row.previous),
  };
}

/**
 * Calendar-safe range math. Dates stay as YYYY-MM-DD values and never pass
 * through local midnight, so the selected account time zone remains the only
 * authority for what counts as a day.
 */
export function reportDateRange(
  end: string,
  days: ReportRangeDays
): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
  if (!match) throw new Error('Report end date must use YYYY-MM-DD');
  const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const start = new Date(at - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

/** Percentage change, or null when a non-zero value has no baseline. */
export function relativeChange(
  current: number,
  previous: number
): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function normalizeOwnerReport(
  payload: unknown,
  sourceLabels: ReadonlyMap<string, string> = new Map()
): OwnerReport {
  const root = record(payload);
  const period = record(root.period);
  const metrics = record(root.metrics);
  const newMembers = record(metrics.newMembers);
  const conversion = record(metrics.conversion);
  const attention = record(root.attention);

  return {
    period: {
      start: text(period.start),
      end: text(period.end),
      days: number(period.days),
    },
    metrics: {
      revenue: metric(metrics.revenue),
      newMembers: {
        ...metric(newMembers),
        activeTotal: number(newMembers.activeTotal),
      },
      visits: metric(metrics.visits),
      conversion: {
        ...metric(conversion),
        acquired: number(conversion.acquired),
        converted: number(conversion.converted),
      },
    },
    attention: {
      renewalsDue: number(attention.renewalsDue),
      outstandingDues: number(attention.outstandingDues),
      outstandingAmount: number(attention.outstandingAmount),
      inactiveMembers: number(attention.inactiveMembers),
      churnRisk: number(attention.churnRisk),
      trialFollowups: number(attention.trialFollowups),
      failedMandates: number(attention.failedMandates),
    },
    trend: rows(root.trend).map((row) => ({
      date: text(row.date),
      revenue: number(row.revenue),
      visits: number(row.visits),
      newMembers: number(row.newMembers),
      acquired: number(row.acquired),
      converted: number(row.converted),
    })),
    plans: rows(root.plans).map((row) => ({
      id: text(row.id),
      name: text(row.name, 'Unassigned plan'),
      activeMembers: number(row.activeMembers),
      newMembers: number(row.newMembers),
      revenue: number(row.revenue),
      visits: number(row.visits),
    })),
    sources: rows(root.sources).map((row) => {
      const source = text(row.source, 'unknown');
      return {
        source,
        label:
          source === 'unknown'
            ? 'Unknown'
            : (sourceLabels.get(source) ?? humaniseKey(source)),
        leads: number(row.leads),
        members: number(row.members),
        conversionRate: number(row.conversionRate),
      };
    }),
    collectionMethods: rows(root.collectionMethods).map((row) => ({
      method: text(row.method, 'other'),
      payments: number(row.payments),
      amount: number(row.amount),
    })),
    collectionSources: rows(root.collectionSources).map((row) => ({
      source: text(row.source, 'manual'),
      payments: number(row.payments),
      amount: number(row.amount),
    })),
  };
}

type NullableNumber = number | string | null;

export interface OwnerReportFallbackRows {
  payments: Array<{
    amount: NullableNumber;
    method: string | null;
    source: string | null;
    paid_at: string;
    plan_id: string | null;
  }>;
  attendance: Array<{
    checked_in_at: string;
    membership_id: string | null;
  }>;
  memberships: Array<{
    id: string;
    contact_id: string;
    plan_id: string | null;
    is_trial: boolean;
    converted_at: string | null;
    created_at: string;
    status: string;
    end_date: string;
  }>;
  contacts: Array<{
    id: string;
    source: string | null;
    churn_risk: boolean | null;
    created_at: string;
  }>;
  plans: Array<{
    id: string;
    name: string;
    is_active: boolean;
    plan_type: string;
  }>;
  dues: Array<{ membership_id: string; balance: NullableNumber }>;
  activity: Array<{
    membership_id: string;
    status: string;
    is_trial: boolean;
    end_date: string;
    last_visit_at: string | null;
  }>;
  mandates: Array<{ membership_id: string; status: string }>;
}

function shiftDate(day: string, offset: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error('Report date must use YYYY-MM-DD');
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset)
  )
    .toISOString()
    .slice(0, 10);
}

function timestampBounds(
  range: { start: string; end: string },
  timeZone: string
) {
  const days =
    Math.round(
      (Date.parse(`${range.end}T00:00:00Z`) -
        Date.parse(`${range.start}T00:00:00Z`)) /
        86_400_000
    ) + 1;
  const currentStart = dayStartInTz(range.start, timeZone);
  const currentEnd = dayStartInTz(shiftDate(range.end, 1), timeZone);
  const previousStart = dayStartInTz(shiftDate(range.start, -days), timeZone);
  if (!currentStart || !currentEnd || !previousStart) {
    throw new Error('Could not resolve report dates in the account time zone');
  }
  return {
    days,
    currentStart: currentStart.getTime(),
    currentEnd: currentEnd.getTime(),
    previousStart: previousStart.getTime(),
  };
}

function inWindow(value: string, start: number, end: number): boolean {
  const at = Date.parse(value);
  return Number.isFinite(at) && at >= start && at < end;
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0
    ? 0
    : Math.round((numerator * 1000) / denominator) / 10;
}

/**
 * Compatibility aggregator for environments that have not applied the RPC
 * migration yet. Its inputs are fetched in stable 1,000-row pages, so it is
 * exact rather than silently inheriting PostgREST's per-request row limit.
 */
export function aggregateOwnerReport(
  data: OwnerReportFallbackRows,
  range: { start: string; end: string },
  timeZone: string,
  sourceLabels: ReadonlyMap<string, string> = new Map(),
  now: Date = new Date()
): OwnerReport {
  const bounds = timestampBounds(range, timeZone);
  const today = todayInTz(timeZone, now);
  const renewalEnd = shiftDate(today, 7);
  const trialEnd = shiftDate(today, 3);
  const inactiveCutoff = shiftDate(today, -10);
  const planById = new Map(data.plans.map((plan) => [plan.id, plan]));
  const memberById = new Map(
    data.memberships.map((membership) => [membership.id, membership])
  );
  const contactById = new Map(
    data.contacts.map((contact) => [contact.id, contact])
  );
  const joinedByContact = new Map<string, string>();
  const joinedMembers = data.memberships.flatMap((membership) => {
    if (membership.is_trial) return [];
    const joinedAt = membership.converted_at ?? membership.created_at;
    joinedByContact.set(membership.contact_id, joinedAt);
    return [{ ...membership, joinedAt }];
  });

  const currentPayments = data.payments.filter((payment) =>
    inWindow(payment.paid_at, bounds.currentStart, bounds.currentEnd)
  );
  const previousPayments = data.payments.filter((payment) =>
    inWindow(payment.paid_at, bounds.previousStart, bounds.currentStart)
  );
  const currentVisits = data.attendance.filter((visit) =>
    inWindow(visit.checked_in_at, bounds.currentStart, bounds.currentEnd)
  );
  const previousVisits = data.attendance.filter((visit) =>
    inWindow(visit.checked_in_at, bounds.previousStart, bounds.currentStart)
  );
  const currentJoins = joinedMembers.filter((member) =>
    inWindow(member.joinedAt, bounds.currentStart, bounds.currentEnd)
  );
  const previousJoins = joinedMembers.filter((member) =>
    inWindow(member.joinedAt, bounds.previousStart, bounds.currentStart)
  );
  const currentCohort = data.contacts.filter((contact) =>
    inWindow(contact.created_at, bounds.currentStart, bounds.currentEnd)
  );
  const previousCohort = data.contacts.filter((contact) =>
    inWindow(contact.created_at, bounds.previousStart, bounds.currentStart)
  );
  const convertedBy = (contactId: string, end: number) => {
    const joinedAt = joinedByContact.get(contactId);
    return joinedAt ? Date.parse(joinedAt) < end : false;
  };
  const currentConverted = currentCohort.filter((contact) =>
    convertedBy(contact.id, bounds.currentEnd)
  ).length;
  const previousConverted = previousCohort.filter((contact) =>
    convertedBy(contact.id, bounds.currentStart)
  ).length;
  const activeMembers = data.memberships.filter(
    (membership) =>
      membership.status === 'active' &&
      !membership.is_trial &&
      membership.end_date >= today
  );

  const daily = new Map<string, OwnerReport['trend'][number]>();
  for (let index = 0; index < bounds.days; index += 1) {
    const date = shiftDate(range.start, index);
    daily.set(date, {
      date,
      revenue: 0,
      visits: 0,
      newMembers: 0,
      acquired: 0,
      converted: 0,
    });
  }
  for (const payment of currentPayments) {
    const bucket = daily.get(todayInTz(timeZone, new Date(payment.paid_at)));
    if (bucket) bucket.revenue += number(payment.amount);
  }
  for (const visit of currentVisits) {
    const bucket = daily.get(
      todayInTz(timeZone, new Date(visit.checked_in_at))
    );
    if (bucket) bucket.visits += 1;
  }
  for (const member of currentJoins) {
    const bucket = daily.get(todayInTz(timeZone, new Date(member.joinedAt)));
    if (bucket) bucket.newMembers += 1;
  }
  for (const contact of currentCohort) {
    const bucket = daily.get(todayInTz(timeZone, new Date(contact.created_at)));
    if (!bucket) continue;
    bucket.acquired += 1;
    if (convertedBy(contact.id, bounds.currentEnd)) bucket.converted += 1;
  }

  const planStats = new Map<string, OwnerReport['plans'][number]>();
  for (const plan of data.plans) {
    planStats.set(plan.id, {
      id: plan.id,
      name: plan.name,
      activeMembers: 0,
      newMembers: 0,
      revenue: 0,
      visits: 0,
    });
  }
  for (const membership of activeMembers) {
    if (membership.plan_id) {
      const stat = planStats.get(membership.plan_id);
      if (stat) stat.activeMembers += 1;
    }
  }
  for (const member of currentJoins) {
    if (member.plan_id) {
      const stat = planStats.get(member.plan_id);
      if (stat) stat.newMembers += 1;
    }
  }
  for (const payment of currentPayments) {
    if (payment.plan_id) {
      const stat = planStats.get(payment.plan_id);
      if (stat) stat.revenue += number(payment.amount);
    }
  }
  for (const visit of currentVisits) {
    const planId = visit.membership_id
      ? memberById.get(visit.membership_id)?.plan_id
      : null;
    if (planId) {
      const stat = planStats.get(planId);
      if (stat) stat.visits += 1;
    }
  }

  const sourceStats = new Map<string, { leads: number; members: number }>();
  for (const contact of currentCohort) {
    const source = contact.source?.trim() || 'unknown';
    const stat = sourceStats.get(source) ?? { leads: 0, members: 0 };
    if (convertedBy(contact.id, bounds.currentEnd)) stat.members += 1;
    else stat.leads += 1;
    sourceStats.set(source, stat);
  }

  const methodStats = new Map<string, { payments: number; amount: number }>();
  const collectionStats = new Map<
    string,
    { payments: number; amount: number }
  >();
  for (const payment of currentPayments) {
    const method = payment.method ?? 'other';
    const methodStat = methodStats.get(method) ?? { payments: 0, amount: 0 };
    methodStat.payments += 1;
    methodStat.amount += number(payment.amount);
    methodStats.set(method, methodStat);

    const source = payment.source ?? 'manual';
    const collectionStat = collectionStats.get(source) ?? {
      payments: 0,
      amount: 0,
    };
    collectionStat.payments += 1;
    collectionStat.amount += number(payment.amount);
    collectionStats.set(source, collectionStat);
  }

  const dueRows = data.dues.filter((due) => number(due.balance) > 0);
  const mandateStatus = new Map<string, Set<string>>();
  for (const mandate of data.mandates) {
    const statuses = mandateStatus.get(mandate.membership_id) ?? new Set();
    statuses.add(mandate.status);
    mandateStatus.set(mandate.membership_id, statuses);
  }

  return {
    period: { ...range, days: bounds.days },
    metrics: {
      revenue: {
        current: currentPayments.reduce(
          (sum, payment) => sum + number(payment.amount),
          0
        ),
        previous: previousPayments.reduce(
          (sum, payment) => sum + number(payment.amount),
          0
        ),
      },
      newMembers: {
        current: currentJoins.length,
        previous: previousJoins.length,
        activeTotal: activeMembers.length,
      },
      visits: {
        current: currentVisits.length,
        previous: previousVisits.length,
      },
      conversion: {
        current: percent(currentConverted, currentCohort.length),
        previous: percent(previousConverted, previousCohort.length),
        acquired: currentCohort.length,
        converted: currentConverted,
      },
    },
    attention: {
      renewalsDue: activeMembers.filter((membership) => {
        const plan = membership.plan_id
          ? planById.get(membership.plan_id)
          : null;
        return (
          plan?.plan_type === 'recurring' &&
          membership.end_date >= today &&
          membership.end_date <= renewalEnd
        );
      }).length,
      outstandingDues: dueRows.length,
      outstandingAmount: dueRows.reduce(
        (sum, due) => sum + number(due.balance),
        0
      ),
      inactiveMembers: data.activity.filter((row) => {
        if (row.status !== 'active' || row.is_trial || row.end_date < today) {
          return false;
        }
        return (
          row.last_visit_at === null ||
          todayInTz(timeZone, new Date(row.last_visit_at)) <= inactiveCutoff
        );
      }).length,
      churnRisk: activeMembers.filter(
        (membership) => contactById.get(membership.contact_id)?.churn_risk
      ).length,
      trialFollowups: data.memberships.filter(
        (membership) =>
          membership.is_trial &&
          membership.status !== 'cancelled' &&
          membership.converted_at === null &&
          membership.end_date <= trialEnd
      ).length,
      failedMandates: Array.from(mandateStatus.values()).filter(
        (statuses) => statuses.has('failed') && !statuses.has('active')
      ).length,
    },
    trend: Array.from(daily.values()),
    plans: Array.from(planStats.values())
      .filter((stat) => {
        const plan = planById.get(stat.id);
        return (
          plan?.is_active ||
          stat.activeMembers > 0 ||
          stat.newMembers > 0 ||
          stat.revenue > 0 ||
          stat.visits > 0
        );
      })
      .sort(
        (a, b) =>
          b.revenue - a.revenue ||
          b.activeMembers - a.activeMembers ||
          a.name.localeCompare(b.name)
      )
      .slice(0, 10),
    sources: Array.from(sourceStats.entries())
      .map(([source, stat]) => ({
        source,
        label:
          source === 'unknown'
            ? 'Unknown'
            : (sourceLabels.get(source) ?? humaniseKey(source)),
        ...stat,
        conversionRate: percent(stat.members, stat.leads + stat.members),
      }))
      .sort(
        (a, b) =>
          b.members - a.members ||
          b.leads - a.leads ||
          a.source.localeCompare(b.source)
      )
      .slice(0, 10),
    collectionMethods: Array.from(methodStats.entries())
      .map(([method, stat]) => ({ method, ...stat }))
      .sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method)),
    collectionSources: Array.from(collectionStats.entries())
      .map(([source, stat]) => ({ source, ...stat }))
      .sort((a, b) => b.amount - a.amount || a.source.localeCompare(b.source)),
  };
}

type PagedResult = PromiseLike<{
  data: unknown[] | null;
  error: unknown;
}>;

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

async function loadFallbackRows(
  db: SupabaseClient,
  range: { start: string; end: string },
  timeZone: string
): Promise<OwnerReportFallbackRows> {
  const bounds = timestampBounds(range, timeZone);
  const previousStart = new Date(bounds.previousStart).toISOString();
  const currentEnd = new Date(bounds.currentEnd).toISOString();

  const [
    payments,
    attendance,
    memberships,
    contacts,
    plans,
    dues,
    activity,
    mandates,
  ] = await Promise.all([
    fetchAll<OwnerReportFallbackRows['payments'][number]>((from, to) =>
      db
        .from('payments')
        .select('id, amount, method, source, paid_at, plan_id')
        .eq('status', 'paid')
        .gte('paid_at', previousStart)
        .lt('paid_at', currentEnd)
        .order('id')
        .range(from, to)
    ),
    fetchAll<OwnerReportFallbackRows['attendance'][number]>((from, to) =>
      db
        .from('attendance')
        .select('id, checked_in_at, membership_id')
        .gte('checked_in_at', previousStart)
        .lt('checked_in_at', currentEnd)
        .order('id')
        .range(from, to)
    ),
    fetchAll<OwnerReportFallbackRows['memberships'][number]>((from, to) =>
      db
        .from('memberships')
        .select(
          'id, contact_id, plan_id, is_trial, converted_at, created_at, status, end_date'
        )
        .order('id')
        .range(from, to)
    ),
    fetchAll<OwnerReportFallbackRows['contacts'][number]>((from, to) =>
      db
        .from('contacts')
        .select('id, source, churn_risk, created_at')
        .order('id')
        .range(from, to)
    ),
    fetchAll<OwnerReportFallbackRows['plans'][number]>((from, to) =>
      db
        .from('membership_plans')
        .select('id, name, is_active, plan_type')
        .order('id')
        .range(from, to)
    ),
    fetchAll<OwnerReportFallbackRows['dues'][number]>((from, to) =>
      db
        .from('membership_dues')
        .select('membership_id, balance')
        .gt('balance', 0)
        .order('membership_id')
        .range(from, to)
    ),
    fetchAll<OwnerReportFallbackRows['activity'][number]>((from, to) =>
      db
        .from('member_activity')
        .select('membership_id, status, is_trial, end_date, last_visit_at')
        .order('membership_id')
        .range(from, to)
    ),
    fetchAll<OwnerReportFallbackRows['mandates'][number]>((from, to) =>
      db
        .from('payment_mandates')
        .select('id, membership_id, status')
        .in('status', ['failed', 'active'])
        .order('id')
        .range(from, to)
    ),
  ]);

  return {
    payments,
    attendance,
    memberships,
    contacts,
    plans,
    dues,
    activity,
    mandates,
  };
}

function missingOwnerReport(error: unknown): boolean {
  const row = record(error);
  const code = text(row.code).toUpperCase();
  const message = text(row.message).toLowerCase();
  return (
    code === 'PGRST202' ||
    message.includes('owner_report') ||
    message.includes('schema cache')
  );
}

export async function loadOwnerReport(
  db: SupabaseClient,
  range: { start: string; end: string },
  timeZone: string
): Promise<OwnerReport> {
  const [reportResult, sourceResult] = await Promise.all([
    db.rpc('owner_report', {
      p_start_date: range.start,
      p_end_date: range.end,
      p_time_zone: timeZone,
    }),
    db
      .from('lead_field_options')
      .select('key, label')
      .eq('field', 'source')
      .order('sort_order', { ascending: true }),
  ]);

  if (sourceResult.error) throw sourceResult.error;

  const sourceOptions = resolveFieldOptions('source', sourceResult.data ?? []);
  const labels = new Map(
    sourceOptions.map((source) => [
      source.key,
      optionLabel(sourceOptions, source.key),
    ])
  );
  if (!reportResult.error) {
    return normalizeOwnerReport(reportResult.data, labels);
  }
  if (!missingOwnerReport(reportResult.error)) throw reportResult.error;

  const fallbackRows = await loadFallbackRows(db, range, timeZone);
  return aggregateOwnerReport(fallbackRows, range, timeZone, labels);
}

function csvCell(value: string | number): string {
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvCell).join(',');
}

/** Full-fidelity export: summary, attention queue, daily data, and breakdowns. */
export function ownerReportCsv(report: OwnerReport): string {
  const lines: string[] = [
    csvRow(['Owner report', `${report.period.start} to ${report.period.end}`]),
    '',
    csvRow(['Summary', 'Current period', 'Previous period']),
    csvRow([
      'Revenue collected',
      report.metrics.revenue.current,
      report.metrics.revenue.previous,
    ]),
    csvRow([
      'New members',
      report.metrics.newMembers.current,
      report.metrics.newMembers.previous,
    ]),
    csvRow([
      'Attendance visits',
      report.metrics.visits.current,
      report.metrics.visits.previous,
    ]),
    csvRow([
      'Lead conversion (%)',
      report.metrics.conversion.current,
      report.metrics.conversion.previous,
    ]),
    '',
    csvRow(['Needs attention', 'Members', 'Amount']),
    csvRow(['Renewals due in 7 days', report.attention.renewalsDue, '']),
    csvRow([
      'Outstanding dues',
      report.attention.outstandingDues,
      report.attention.outstandingAmount,
    ]),
    csvRow(['Inactive 10+ days', report.attention.inactiveMembers, '']),
    csvRow(['Churn risk', report.attention.churnRisk, '']),
    csvRow(['Trial follow-ups', report.attention.trialFollowups, '']),
    csvRow(['Failed mandates', report.attention.failedMandates, '']),
    '',
    csvRow([
      'Date',
      'Revenue',
      'Visits',
      'New members',
      'Acquired leads',
      'Converted leads',
    ]),
    ...report.trend.map((row) =>
      csvRow([
        row.date,
        row.revenue,
        row.visits,
        row.newMembers,
        row.acquired,
        row.converted,
      ])
    ),
    '',
    csvRow(['Plan', 'Active members', 'New members', 'Revenue', 'Visits']),
    ...report.plans.map((plan) =>
      csvRow([
        plan.name,
        plan.activeMembers,
        plan.newMembers,
        plan.revenue,
        plan.visits,
      ])
    ),
    '',
    csvRow(['Lead source', 'Open leads', 'Members', 'Conversion (%)']),
    ...report.sources.map((source) =>
      csvRow([
        source.label,
        source.leads,
        source.members,
        source.conversionRate,
      ])
    ),
    '',
    csvRow(['Collection method', 'Payments', 'Amount']),
    ...report.collectionMethods.map((method) =>
      csvRow([method.method, method.payments, method.amount])
    ),
    '',
    csvRow(['Collection source', 'Payments', 'Amount']),
    ...report.collectionSources.map((source) =>
      csvRow([source.source, source.payments, source.amount])
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
