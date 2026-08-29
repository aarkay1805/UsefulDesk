import type { SupabaseClient } from '@supabase/supabase-js';

import { dayStartInTz } from '@/lib/locale/format';
import { financeMonthRange } from '@/lib/finance/overview';
import { istAddDays } from '@/lib/memberships/expiry';
import type {
  Payment,
  PaymentMethod,
  PaymentPurpose,
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
  purposes: PaymentPurpose[];
  planIds: string[];
  recordedBy: string[];
  paidFrom: string;
  paidTo: string;
}

export const EMPTY_FINANCE_PAYMENT_FILTERS: FinancePaymentFilterState = {
  methods: [],
  statuses: [],
  sources: [],
  purposes: [],
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
  gross_amount?: number;
  processed_refund_amount?: number;
  net_amount?: number;
  gateway_refund_ids?: string[];
  refund_dispositions?: string[];
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
  grossCollected: number;
  processedRefunds: number;
  refundCount: number;
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
  grossCollected: 0,
  processedRefunds: 0,
  refundCount: 0,
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
  value: unknown,
  refundValue: unknown = null
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
  const refundSummary =
    refundValue && typeof refundValue === 'object'
      ? (refundValue as Record<string, unknown>)
      : {};
  const processedRefunds = number(refundSummary.processedRefunds);
  const methodRefunds = new Map(
    Array.isArray(refundSummary.methodRefunds)
      ? refundSummary.methodRefunds.map((row) => {
          const item = row as Record<string, unknown>;
          return [String(item.method), number(item.amount)] as const;
        })
      : []
  );
  const normalizedMethodMix = normalizeMethodMix(summary.methodMix).map(
    (row) => ({
      ...row,
      amount: Math.max(0, row.amount - (methodRefunds.get(row.method) ?? 0)),
    })
  );
  const grossCollected = number(summary.collected);

  return {
    rows: Array.isArray(result.rows)
      ? (result.rows as FinancePaymentRow[])
      : [],
    summary: {
      count: number(summary.count),
      collectedCount: number(summary.collectedCount),
      collected: Math.max(0, grossCollected - processedRefunds),
      grossCollected,
      processedRefunds,
      refundCount: number(refundSummary.refundCount),
      voidedCount: number(summary.voidedCount),
      voidedAmount: number(summary.voidedAmount),
      autopay: Math.max(
        0,
        number(summary.autopay) - number(refundSummary.autopayRefunds)
      ),
      methodMix: normalizedMethodMix,
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
  const params = {
    p_start: bounds.start,
    p_end: bounds.end,
    p_search: query.search.trim() || null,
    p_methods: query.filters.methods.length ? query.filters.methods : null,
    p_statuses: query.filters.statuses.length ? query.filters.statuses : null,
    p_sources: query.filters.sources.length ? query.filters.sources : null,
    p_purposes: query.filters.purposes.length ? query.filters.purposes : null,
    p_plan_ids: query.filters.planIds.length ? query.filters.planIds : null,
    p_recorded_by: query.filters.recordedBy.length
      ? query.filters.recordedBy
      : null,
    p_view: query.quickView,
    p_sort: query.sort.key,
    p_direction: query.sort.dir,
    p_offset: Math.max(0, (query.page - 1) * query.pageSize),
    p_limit: query.pageSize,
  };
  const [{ data, error }, { data: refundSummary, error: refundSummaryError }] =
    await Promise.all([
      db.rpc('finance_payment_ledger', params),
      db.rpc('finance_payment_refund_summary', {
        p_start: bounds.start,
        p_end: bounds.end,
        p_search: params.p_search,
        p_methods: params.p_methods,
        p_statuses: params.p_statuses,
        p_sources: params.p_sources,
        p_purposes: params.p_purposes,
        p_plan_ids: params.p_plan_ids,
        p_recorded_by: params.p_recorded_by,
        p_view: params.p_view,
      }),
    ]);
  if (error) throw error;
  if (refundSummaryError) throw refundSummaryError;
  const page = normalizeFinancePaymentPage(data, refundSummary);
  const ids = page.rows.map((row) => row.id);
  const { data: refundRows, error: refundError } = ids.length
    ? await db
        .from('payment_refunds')
        .select('payment_id, gateway_refund_id, amount, disposition, status')
        .in('payment_id', ids)
    : { data: [], error: null };
  if (refundError) throw refundError;
  const refundsByPayment = new Map<
    string,
    Array<{
      gateway_refund_id: string | null;
      amount: number;
      disposition: string | null;
      status: string;
    }>
  >();
  for (const refund of refundRows ?? []) {
    const rows = refundsByPayment.get(refund.payment_id) ?? [];
    rows.push({
      gateway_refund_id: refund.gateway_refund_id,
      amount: Number(refund.amount),
      disposition: refund.disposition,
      status: refund.status,
    });
    refundsByPayment.set(refund.payment_id, rows);
  }
  page.rows = page.rows.map((row) => {
    const refunds = refundsByPayment.get(row.id) ?? [];
    const processed = refunds.filter((refund) => refund.status === 'processed');
    const processedAmount = processed.reduce(
      (total, refund) => total + refund.amount,
      0
    );
    return {
      ...row,
      gross_amount: number(row.amount),
      processed_refund_amount: processedAmount,
      net_amount: Math.max(0, number(row.amount) - processedAmount),
      gateway_refund_ids: processed
        .map((refund) => refund.gateway_refund_id)
        .filter((id): id is string => Boolean(id)),
      refund_dispositions: processed
        .map((refund) => refund.disposition)
        .filter((value): value is string => Boolean(value)),
    };
  });
  return page;
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
  if (row.source === 'payment_link') return 'Razorpay payment link';
  return row.recorded_by_name?.trim() || 'Staff';
}

function paymentSourceLabel(row: FinancePaymentRow): string {
  if (row.source === 'auto') return 'Auto-pay';
  if (row.source === 'payment_link') return 'Payment link';
  return 'Manual';
}

function csvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? '');
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function financePaymentsCsv(
  rows: FinancePaymentRow[],
  formatDateTime: (value: string) => string,
  formatPhone: (value: string | null | undefined) => string = (value) =>
    value ?? ''
): string {
  const lines: Array<Array<string | number>> = [
    [
      'Payment',
      'Gateway payment ID',
      'Gateway refund IDs',
      'Refund dispositions',
      'Member ID',
      'Name',
      'Phone',
      'Plan',
      'Paid on',
      'Method',
      'Source',
      'Payment purpose',
      'Status',
      'Gross amount',
      'Processed refunds',
      'Net amount',
      'Recorded by',
      'Note',
    ],
    ...rows.map((row) => [
      row.reference || financePaymentReference(row.id),
      row.gateway_payment_id ?? '',
      (row.gateway_refund_ids ?? []).join(' + '),
      (row.refund_dispositions ?? []).join(' + '),
      row.member_number ?? '',
      row.contact_name ?? 'Deleted member',
      formatPhone(row.contact_phone),
      row.plan_name ?? '',
      formatDateTime(row.paid_at),
      row.method,
      paymentSourceLabel(row),
      row.payment_purpose,
      row.status === 'void' ? 'Voided' : row.status === 'due' ? 'Due' : 'Paid',
      number(row.gross_amount ?? row.amount),
      number(row.processed_refund_amount),
      number(row.net_amount ?? row.amount),
      financePaymentRecordedBy(row),
      row.note ?? '',
    ]),
  ];
  return lines.map((line) => line.map(csvCell).join(',')).join('\n');
}
