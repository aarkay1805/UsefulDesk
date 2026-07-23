import type { SupabaseClient } from '@supabase/supabase-js';

import { dayStartInTz } from '@/lib/locale/format';
import { financeMonthRange } from '@/lib/finance/overview';
import { istAddDays } from '@/lib/memberships/expiry';
import type {
  Payment,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
} from '@/types';

export type FinancePaymentQuickView =
  'all' | 'collected' | 'autopay' | 'voided';

export type FinancePaymentSortKey =
  | 'payment'
  | 'name'
  | 'plan'
  | 'paid_on'
  | 'method'
  | 'source'
  | 'amount'
  | 'status'
  | 'recorded_by';

export interface FinancePaymentFilterState {
  methods: PaymentMethod[];
  statuses: PaymentStatus[];
  sources: PaymentSource[];
  planIds: string[];
  recordedBy: string[];
  paidFrom: string;
  paidTo: string;
}

export const EMPTY_FINANCE_PAYMENT_FILTERS: FinancePaymentFilterState = {
  methods: [],
  statuses: [],
  sources: [],
  planIds: [],
  recordedBy: [],
  paidFrom: '',
  paidTo: '',
};

export type FinancePaymentRow = Payment & {
  reference: string;
  member_number: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_avatar_url: string | null;
  plan_name: string | null;
  recorded_by_name: string | null;
};

export interface FinancePaymentMethodSummary {
  method: 'upi' | 'cash' | 'card' | 'bank_other';
  payments: number;
  amount: number;
}

export interface FinancePaymentSummary {
  count: number;
  collectedCount: number;
  collected: number;
  voidedCount: number;
  voidedAmount: number;
  autopay: number;
  methodMix: FinancePaymentMethodSummary[];
}

export type FinancePaymentFacets = Record<FinancePaymentQuickView, number>;

export interface FinancePaymentPage {
  rows: FinancePaymentRow[];
  summary: FinancePaymentSummary;
  facets: FinancePaymentFacets;
}

export interface FinancePaymentQuery {
  month: string;
  timeZone: string;
  search: string;
  quickView: FinancePaymentQuickView;
  filters: FinancePaymentFilterState;
  sort: { key: FinancePaymentSortKey; dir: 'asc' | 'desc' };
  page: number;
  pageSize: number;
}

const EMPTY_SUMMARY: FinancePaymentSummary = {
  count: 0,
  collectedCount: 0,
  collected: 0,
  voidedCount: 0,
  voidedAmount: 0,
  autopay: 0,
  methodMix: [
    { method: 'upi', payments: 0, amount: 0 },
    { method: 'cash', payments: 0, amount: 0 },
    { method: 'card', payments: 0, amount: 0 },
    { method: 'bank_other', payments: 0, amount: 0 },
  ],
};

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMethodMix(value: unknown): FinancePaymentMethodSummary[] {
  if (!Array.isArray(value)) return EMPTY_SUMMARY.methodMix;
  const byMethod = new Map(
    value
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object'
      )
      .map((row) => [
        row.method,
        {
          method: row.method,
          payments: number(row.payments),
          amount: number(row.amount),
        },
      ])
  );
  return EMPTY_SUMMARY.methodMix.map(
    (fallback) =>
      (byMethod.get(fallback.method) as FinancePaymentMethodSummary) ?? fallback
  );
}

export function normalizeFinancePaymentPage(
  value: unknown
): FinancePaymentPage {
  const result =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const summary =
    result.summary && typeof result.summary === 'object'
      ? (result.summary as Record<string, unknown>)
      : {};
  const facets =
    result.facets && typeof result.facets === 'object'
      ? (result.facets as Record<string, unknown>)
      : {};

  return {
    rows: Array.isArray(result.rows)
      ? (result.rows as FinancePaymentRow[])
      : [],
    summary: {
      count: number(summary.count),
      collectedCount: number(summary.collectedCount),
      collected: number(summary.collected),
      voidedCount: number(summary.voidedCount),
      voidedAmount: number(summary.voidedAmount),
      autopay: number(summary.autopay),
      methodMix: normalizeMethodMix(summary.methodMix),
    },
    facets: {
      all: number(facets.all),
      collected: number(facets.collected),
      autopay: number(facets.autopay),
      voided: number(facets.voided),
    },
  };
}

function paymentBounds(
  query: Pick<FinancePaymentQuery, 'month' | 'timeZone' | 'filters'>
): { start: string; end: string } {
  const month = financeMonthRange(query.month);
  const fromDate = query.filters.paidFrom || month.start;
  const toDate = query.filters.paidTo || month.end;
  const start = dayStartInTz(fromDate, query.timeZone);
  const end = dayStartInTz(istAddDays(toDate, 1), query.timeZone);
  if (!start || !end) {
    throw new Error('Could not resolve payment dates in the account time zone');
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function loadFinancePayments(
  db: SupabaseClient,
  query: FinancePaymentQuery
): Promise<FinancePaymentPage> {
  const bounds = paymentBounds(query);
  const { data, error } = await db.rpc('finance_payment_ledger', {
    p_start: bounds.start,
    p_end: bounds.end,
    p_search: query.search.trim() || null,
    p_methods: query.filters.methods.length ? query.filters.methods : null,
    p_statuses: query.filters.statuses.length ? query.filters.statuses : null,
    p_sources: query.filters.sources.length ? query.filters.sources : null,
    p_plan_ids: query.filters.planIds.length ? query.filters.planIds : null,
    p_recorded_by: query.filters.recordedBy.length
      ? query.filters.recordedBy
      : null,
    p_view: query.quickView,
    p_sort: query.sort.key,
    p_direction: query.sort.dir,
    p_offset: Math.max(0, (query.page - 1) * query.pageSize),
    p_limit: query.pageSize,
  });
  if (error) throw error;
  return normalizeFinancePaymentPage(data);
}

export async function loadAllFinancePayments(
  db: SupabaseClient,
  query: Omit<FinancePaymentQuery, 'page' | 'pageSize'>
): Promise<FinancePaymentRow[]> {
  const rows: FinancePaymentRow[] = [];
  const pageSize = 500;
  for (let page = 1; ; page += 1) {
    const result = await loadFinancePayments(db, {
      ...query,
      page,
      pageSize,
    });
    rows.push(...result.rows);
    if (result.rows.length < pageSize) return rows;
  }
}

export function financePaymentReference(id: string): string {
  return `#${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

export function financePaymentRecordedBy(row: FinancePaymentRow): string {
  if (row.source === 'auto') return 'Auto-pay';
  return row.recorded_by_name?.trim() || 'Staff';
}

function csvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? '');
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function financePaymentsCsv(
  rows: FinancePaymentRow[],
  formatDateTime: (value: string) => string
): string {
  const lines: Array<Array<string | number>> = [
    [
      'Payment',
      'Gateway reference',
      'Member ID',
      'Name',
      'Phone',
      'Plan',
      'Paid on',
      'Method',
      'Source',
      'Status',
      'Amount',
      'Recorded by',
      'Note',
    ],
    ...rows.map((row) => [
      row.reference || financePaymentReference(row.id),
      row.gateway_payment_id ?? '',
      row.member_number ?? '',
      row.contact_name ?? 'Deleted member',
      row.contact_phone ?? '',
      row.plan_name ?? '',
      formatDateTime(row.paid_at),
      row.method,
      row.source === 'auto' ? 'Auto-pay' : 'Manual',
      row.status === 'void' ? 'Voided' : row.status === 'due' ? 'Due' : 'Paid',
      number(row.amount),
      financePaymentRecordedBy(row),
      row.note ?? '',
    ]),
  ];
  return lines.map((line) => line.map(csvCell).join(',')).join('\n');
}
