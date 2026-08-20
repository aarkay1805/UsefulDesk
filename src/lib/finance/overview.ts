import type { SupabaseClient } from '@supabase/supabase-js';

import { dayStartInTz, todayInTz } from '@/lib/locale/format';
import { istAddDays } from '@/lib/memberships/expiry';
import {
  invoicePaymentState,
  isChargeableAmount,
  projectNextInvoice,
} from '@/lib/memberships/periods';
import type {
  Contact,
  Expense,
  Membership,
  MembershipPlan,
  Payment,
  PaymentMethod,
  PaymentPurpose,
} from '@/types';

export interface FinanceMonthRange {
  month: string;
  start: string;
  end: string;
  nextStart: string;
  previousStart: string;
  previousEnd: string;
}

export interface FinanceTrendPoint {
  date: string;
  income: number;
  expenses: number;
}

export type FinanceCashFlowGrouping = 'daily' | 'weekly';

export interface FinanceCashFlowComparisonPoint {
  ordinal: number;
  currentStart: string | null;
  currentEnd: string | null;
  previousStart: string | null;
  previousEnd: string | null;
  currentIncome: number;
  currentExpenses: number;
  previousIncome: number;
  previousExpenses: number;
}

export interface FinanceInvoiceHealth {
  paid: number;
  partiallyPaid: number;
  overdue: number;
  open: number;
  outstanding: number;
  refundReview?: number;
}

export interface FinanceCollectionMethod {
  method: 'upi' | 'cash' | 'card' | 'bank_other';
  payments: number;
  amount: number;
}

export interface FinanceRecentTransaction {
  id: string;
  occurredAt: string;
  description: string;
  kind: 'membership' | 'refund' | 'expense';
  method: string;
  amount: number;
  paymentPurpose?: PaymentPurpose;
}

export type FinanceRevenueBreakdown = Record<PaymentPurpose, number>;

export interface FinanceRevenuePayment {
  id: string;
  membershipId: string | null;
  memberNumber: number | null;
  contactName: string | null;
  contactAvatarUrl: string | null;
  planName: string | null;
  paidAt: string;
  membershipStartDate: string | null;
  periodEnd: string | null;
  method: PaymentMethod;
  source: Payment['source'];
  amount: number;
}

export interface FinanceRevenueStream {
  purpose: PaymentPurpose;
  payments: number;
  amount: number;
  recentPayments: FinanceRevenuePayment[];
}

export type FinanceRevenuePaymentRow = Pick<
  Payment,
  'amount' | 'payment_purpose' | 'status'
>;

export type FinanceRevenueStreamPaymentRow = FinanceRevenuePaymentRow &
  Pick<
    Payment,
    'id' | 'membership_id' | 'paid_at' | 'period_end' | 'method' | 'source'
  > & {
    contact?: Pick<Contact, 'name' | 'avatar_url'> | null;
    plan?: Pick<MembershipPlan, 'name'> | null;
    membership?: Pick<Membership, 'member_number' | 'start_date'> | null;
  };

export interface FinanceAdPerformance {
  adSpend: number;
  leads: number;
  convertedMembers: number;
  joiningRevenue: number;
  conversionRate: number | null;
  returnOnAdSpend: number | null;
}

export interface FinanceOverviewData {
  period: FinanceMonthRange;
  revenue: {
    current: number;
    previous: number;
    grossCurrent?: number;
    grossPrevious?: number;
    refundsCurrent?: number;
    refundsPrevious?: number;
  };
  expenses: { current: number; previous: number };
  profit: { current: number; previous: number };
  projection: { amount: number; renewals: number };
  revenueBreakdown: FinanceRevenueBreakdown;
  revenueStreams: FinanceRevenueStream[];
  trend: FinanceTrendPoint[];
  previousTrend: FinanceTrendPoint[];
  comparisonThroughDay: number | null;
  invoiceHealth: FinanceInvoiceHealth;
  collectionMethods: FinanceCollectionMethod[];
  recentTransactions: FinanceRecentTransaction[];
}

export interface FinanceExpenseTotals {
  current: number;
  previous: number;
}

type PaymentRow = Payment & {
  contact?: Pick<Contact, 'name' | 'avatar_url'> | null;
  plan?: Pick<MembershipPlan, 'name'> | null;
  membership?: Pick<Membership, 'member_number' | 'start_date'> | null;
};

interface FinanceRefundCashRow {
  id: string;
  amount: number;
  processed_at: string;
  payment: Pick<Payment, 'method' | 'source' | 'payment_purpose'> | null;
}

interface GenericFinanceInvoice {
  id: string;
  state: 'open' | 'void';
  issued_at: string;
  total: number;
  amount_paid: number;
  credit_applied: number;
  balance: number;
  requires_refund_review: boolean;
}

export type FinanceOverviewExpenseRow = Pick<
  Expense,
  | 'id'
  | 'occurred_on'
  | 'amount'
  | 'description'
  | 'method'
  | 'status'
  | 'created_at'
>;

export type FinanceCashFlowPaymentRow = Pick<
  Payment,
  'paid_at' | 'amount' | 'status'
>;

type ProjectionMembership = Membership & {
  plan: NonNullable<Membership['plan']>;
  pricing_option: NonNullable<Membership['pricing_option']>;
};

function monthParts(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Finance month must use YYYY-MM');
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
  };
}

function monthKey(year: number, monthIndex: number): string {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    '0'
  )}`;
}

export function shiftFinanceMonth(month: string, offset: number): string {
  const parts = monthParts(month);
  return monthKey(parts.year, parts.monthIndex + offset);
}

export function financeMonthRange(month: string): FinanceMonthRange {
  const nextMonth = shiftFinanceMonth(month, 1);
  const previousMonth = shiftFinanceMonth(month, -1);
  return {
    month,
    start: `${month}-01`,
    end: istAddDays(`${nextMonth}-01`, -1),
    nextStart: `${nextMonth}-01`,
    previousStart: `${previousMonth}-01`,
    previousEnd: istAddDays(`${month}-01`, -1),
  };
}

export function financeComparisonThroughDay(
  selectedMonth: string,
  today: string
): number | null {
  if (today.slice(0, 7) !== selectedMonth) return null;
  const match = /^\d{4}-\d{2}-(\d{2})$/.exec(today);
  if (!match) return null;
  const day = Number(match[1]);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function yearFrom(value: string | null | undefined): number | null {
  const match = value ? /^(\d{4})/.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : null;
}

export function financeYearOptions(
  currentMonth: string,
  accountCreatedAt: string | null | undefined,
  selectedMonth: string
): string[] {
  const currentYear = yearFrom(currentMonth);
  const selectedYear = yearFrom(selectedMonth);
  if (currentYear === null || selectedYear === null) {
    throw new Error('Finance months must use YYYY-MM');
  }
  const createdYear = yearFrom(accountCreatedAt) ?? currentYear;
  const firstYear = Math.min(currentYear, createdYear, selectedYear);
  return Array.from({ length: currentYear - firstYear + 1 }, (_, index) =>
    String(currentYear - index)
  );
}

function number(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeFinanceAdPerformance(
  value: unknown
): FinanceAdPerformance {
  const row =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    adSpend: number(row.adSpend as number | string | null | undefined),
    leads: number(row.leads as number | string | null | undefined),
    convertedMembers: number(
      row.convertedMembers as number | string | null | undefined
    ),
    joiningRevenue: number(
      row.joiningRevenue as number | string | null | undefined
    ),
    conversionRate: nullableNumber(row.conversionRate),
    returnOnAdSpend: nullableNumber(row.returnOnAdSpend),
  };
}

export function summarizeFinanceRevenue(
  rows: FinanceRevenuePaymentRow[]
): FinanceRevenueBreakdown {
  const breakdown: FinanceRevenueBreakdown = {
    joining: 0,
    renewal: 0,
    sale: 0,
    due: 0,
    other: 0,
  };
  for (const payment of rows) {
    if (payment.status !== 'paid') continue;
    const purpose = payment.payment_purpose ?? 'other';
    breakdown[purpose] += number(payment.amount);
  }
  return breakdown;
}

export function summarizeFinanceRevenueStreams(
  rows: FinanceRevenueStreamPaymentRow[]
): FinanceRevenueStream[] {
  const purposes: PaymentPurpose[] = [
    'joining',
    'renewal',
    'sale',
    'due',
    'other',
  ];
  const streams = new Map<
    PaymentPurpose,
    {
      payments: number;
      amount: number;
      recentPayments: FinanceRevenuePayment[];
    }
  >(
    purposes.map((purpose) => [
      purpose,
      { payments: 0, amount: 0, recentPayments: [] },
    ])
  );

  for (const payment of rows) {
    if (payment.status !== 'paid') continue;
    const purpose = payment.payment_purpose ?? 'other';
    const stream = streams.get(purpose);
    if (!stream) continue;

    const amount = number(payment.amount);
    const recentPayment: FinanceRevenuePayment = {
      id: payment.id,
      membershipId: payment.membership_id,
      memberNumber: payment.membership?.member_number ?? null,
      contactName: payment.contact?.name?.trim() || null,
      contactAvatarUrl: payment.contact?.avatar_url ?? null,
      planName: payment.plan?.name?.trim() || null,
      paidAt: payment.paid_at,
      membershipStartDate: payment.membership?.start_date ?? null,
      periodEnd: payment.period_end ?? null,
      method: payment.method,
      source: payment.source,
      amount,
    };

    stream.payments += 1;
    stream.amount += amount;
    stream.recentPayments.push(recentPayment);
  }

  return purposes.map((purpose) => {
    const stream = streams.get(purpose)!;
    return {
      purpose,
      payments: stream.payments,
      amount: stream.amount,
      recentPayments: stream.recentPayments
        .slice()
        .sort(
          (left, right) =>
            right.paidAt.localeCompare(left.paidAt) ||
            right.id.localeCompare(left.id)
        )
        .slice(0, 5),
    };
  });
}

export async function loadFinanceAdPerformance(
  db: SupabaseClient,
  period: Pick<FinanceMonthRange, 'start' | 'end'>,
  timeZone: string
): Promise<FinanceAdPerformance> {
  const { data, error } = await db.rpc('finance_overview_ad_performance', {
    p_start_date: period.start,
    p_end_date: period.end,
    p_time_zone: timeZone,
  });
  if (error) throw error;
  return normalizeFinanceAdPerformance(data);
}

function paymentMethod(
  method: PaymentMethod
): FinanceCollectionMethod['method'] {
  return method === 'bank' || method === 'other' ? 'bank_other' : method;
}

export function summarizeFinanceExpenses(
  rows: FinanceOverviewExpenseRow[],
  period: FinanceMonthRange
): {
  current: number;
  previous: number;
  daily: Array<{ date: string; amount: number }>;
  previousDaily: Array<{ date: string; amount: number }>;
  transactions: FinanceRecentTransaction[];
} {
  const posted = rows.filter((expense) => expense.status === 'posted');
  const currentRows = posted.filter(
    (expense) =>
      expense.occurred_on >= period.start &&
      expense.occurred_on < period.nextStart
  );
  const previousRows = posted.filter(
    (expense) =>
      expense.occurred_on >= period.previousStart &&
      expense.occurred_on < period.start
  );
  const daily = new Map<string, number>();
  for (const expense of currentRows) {
    daily.set(
      expense.occurred_on,
      (daily.get(expense.occurred_on) ?? 0) + number(expense.amount)
    );
  }
  const previousDaily = new Map<string, number>();
  for (const expense of previousRows) {
    previousDaily.set(
      expense.occurred_on,
      (previousDaily.get(expense.occurred_on) ?? 0) + number(expense.amount)
    );
  }

  return {
    current: currentRows.reduce(
      (sum, expense) => sum + number(expense.amount),
      0
    ),
    previous: previousRows.reduce(
      (sum, expense) => sum + number(expense.amount),
      0
    ),
    daily: Array.from(daily, ([date, amount]) => ({ date, amount })).sort(
      (left, right) => left.date.localeCompare(right.date)
    ),
    previousDaily: Array.from(previousDaily, ([date, amount]) => ({
      date,
      amount,
    })).sort((left, right) => left.date.localeCompare(right.date)),
    transactions: [...currentRows]
      .sort(
        (left, right) =>
          right.occurred_on.localeCompare(left.occurred_on) ||
          right.created_at.localeCompare(left.created_at)
      )
      .map((expense) => ({
        id: expense.id,
        occurredAt: expense.occurred_on,
        description: expense.description,
        kind: 'expense' as const,
        method: paymentMethod(expense.method),
        amount: number(expense.amount),
      })),
  };
}

export async function loadFinanceExpenseTotals(
  db: SupabaseClient,
  month: string
): Promise<FinanceExpenseTotals> {
  const period = financeMonthRange(month);
  const { data, error } = await db
    .from('expenses')
    .select('id, occurred_on, amount, description, method, status, created_at')
    .eq('status', 'posted')
    .gte('occurred_on', period.previousStart)
    .lt('occurred_on', period.nextStart);
  if (error) throw error;

  const summary = summarizeFinanceExpenses(
    (data ?? []) as FinanceOverviewExpenseRow[],
    period
  );
  return { current: summary.current, previous: summary.previous };
}

function emptyFinanceTrend(start: string, end: string): FinanceTrendPoint[] {
  const result: FinanceTrendPoint[] = [];
  for (let date = start; date <= end; date = istAddDays(date, 1)) {
    result.push({ date, income: 0, expenses: 0 });
  }
  return result;
}

export function summarizeFinanceCashFlow(
  payments: FinanceCashFlowPaymentRow[],
  expenses: FinanceOverviewExpenseRow[],
  period: FinanceMonthRange,
  timeZone: string,
  refunds: Array<Pick<FinanceRefundCashRow, 'amount' | 'processed_at'>> = []
): { current: FinanceTrendPoint[]; previous: FinanceTrendPoint[] } {
  const current = emptyFinanceTrend(period.start, period.end);
  const previous = emptyFinanceTrend(period.previousStart, period.previousEnd);
  const currentByDate = new Map(current.map((point) => [point.date, point]));
  const previousByDate = new Map(previous.map((point) => [point.date, point]));

  for (const payment of payments) {
    if (payment.status !== 'paid') continue;
    const date = todayInTz(timeZone, new Date(payment.paid_at));
    const point = currentByDate.get(date) ?? previousByDate.get(date);
    if (point) point.income += number(payment.amount);
  }

  for (const refund of refunds) {
    const date = todayInTz(timeZone, new Date(refund.processed_at));
    const point = currentByDate.get(date) ?? previousByDate.get(date);
    if (point) point.income -= number(refund.amount);
  }

  for (const expense of expenses) {
    if (expense.status !== 'posted') continue;
    const point =
      currentByDate.get(expense.occurred_on) ??
      previousByDate.get(expense.occurred_on);
    if (point) point.expenses += number(expense.amount);
  }

  return { current, previous };
}

function trendDay(point: FinanceTrendPoint): number | null {
  const match = /^\d{4}-\d{2}-(\d{2})$/.exec(point.date);
  if (!match) return null;
  const day = Number(match[1]);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function sumTrend(points: FinanceTrendPoint[]): {
  income: number;
  expenses: number;
} {
  return points.reduce(
    (total, point) => ({
      income: total.income + point.income,
      expenses: total.expenses + point.expenses,
    }),
    { income: 0, expenses: 0 }
  );
}

export function alignFinanceCashFlowTrends(
  current: FinanceTrendPoint[],
  previous: FinanceTrendPoint[],
  grouping: FinanceCashFlowGrouping,
  throughDay: number | null = null
): FinanceCashFlowComparisonPoint[] {
  const currentByDay = new Map<number, FinanceTrendPoint>();
  const previousByDay = new Map<number, FinanceTrendPoint>();
  for (const point of current) {
    const day = trendDay(point);
    if (day !== null) currentByDay.set(day, point);
  }
  for (const point of previous) {
    const day = trendDay(point);
    if (day !== null) previousByDay.set(day, point);
  }

  const lastAvailableDay = Math.max(
    0,
    ...currentByDay.keys(),
    ...previousByDay.keys()
  );
  const lastDay =
    throughDay === null
      ? lastAvailableDay
      : Math.min(Math.max(throughDay, 0), lastAvailableDay);
  const bucketSize = grouping === 'weekly' ? 7 : 1;
  const result: FinanceCashFlowComparisonPoint[] = [];

  for (let startDay = 1; startDay <= lastDay; startDay += bucketSize) {
    const endDay = Math.min(startDay + bucketSize - 1, lastDay);
    const currentPoints: FinanceTrendPoint[] = [];
    const previousPoints: FinanceTrendPoint[] = [];
    for (let day = startDay; day <= endDay; day += 1) {
      const currentPoint = currentByDay.get(day);
      const previousPoint = previousByDay.get(day);
      if (currentPoint) currentPoints.push(currentPoint);
      if (previousPoint) previousPoints.push(previousPoint);
    }
    const currentTotal = sumTrend(currentPoints);
    const previousTotal = sumTrend(previousPoints);
    result.push({
      ordinal: startDay,
      currentStart: currentPoints[0]?.date ?? null,
      currentEnd: currentPoints.at(-1)?.date ?? null,
      previousStart: previousPoints[0]?.date ?? null,
      previousEnd: previousPoints.at(-1)?.date ?? null,
      currentIncome: currentTotal.income,
      currentExpenses: currentTotal.expenses,
      previousIncome: previousTotal.income,
      previousExpenses: previousTotal.expenses,
    });
  }

  return result;
}

export function financeCashFlowHasMovement(
  current: FinanceTrendPoint[],
  previous: FinanceTrendPoint[]
): boolean {
  return [...current, ...previous].some(
    (point) => point.income !== 0 || point.expenses !== 0
  );
}

function instantBounds(
  range: FinanceMonthRange,
  timeZone: string
): { previousStart: string; currentStart: string; nextStart: string } {
  const previousStart = dayStartInTz(range.previousStart, timeZone);
  const currentStart = dayStartInTz(range.start, timeZone);
  const nextStart = dayStartInTz(range.nextStart, timeZone);
  if (!previousStart || !currentStart || !nextStart) {
    throw new Error('Could not resolve Finance dates in the account time zone');
  }
  return {
    previousStart: previousStart.toISOString(),
    currentStart: currentStart.toISOString(),
    nextStart: nextStart.toISOString(),
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
    const rows = (response.data ?? []) as T[];
    result.push(...rows);
    if (rows.length < pageSize) return result;
  }
}

export async function loadFinanceOverview(
  db: SupabaseClient,
  month: string,
  timeZone: string,
  today: string
): Promise<FinanceOverviewData> {
  const period = financeMonthRange(month);
  const bounds = instantBounds(period, timeZone);
  const projectionStart = period.nextStart;
  const projectionEnd = `${shiftFinanceMonth(month, 2)}-01`;

  const [payments, refunds, invoices, projectionMemberships, expenseRows] =
    await Promise.all([
      fetchAll<PaymentRow>((from, to) =>
        db
          .from('payments')
          .select(
            'id, account_id, membership_id, contact_id, plan_id, user_id, amount, method, status, paid_at, period_start, period_end, note, source, payment_purpose, gateway_payment_id, created_at, contact:contacts(name, avatar_url), plan:membership_plans(name), membership:memberships(member_number, start_date)'
          )
          .eq('status', 'paid')
          .gte('paid_at', bounds.previousStart)
          .lt('paid_at', bounds.nextStart)
          .order('paid_at', { ascending: false })
          .range(from, to)
      ),
      fetchAll<FinanceRefundCashRow>((from, to) =>
        db
          .from('payment_refunds')
          .select(
            'id, amount, processed_at, payment:payments!payment_refunds_payment_id_fkey(method, source, payment_purpose)'
          )
          .eq('status', 'processed')
          .gte('processed_at', bounds.previousStart)
          .lt('processed_at', bounds.nextStart)
          .order('processed_at', { ascending: false })
          .range(from, to)
      ),
      fetchAll<GenericFinanceInvoice>((from, to) =>
        db
          .from('invoice_balances')
          .select(
            'id, state, issued_at, total, amount_paid, credit_applied, balance, requires_refund_review'
          )
          .gte('issued_at', bounds.currentStart)
          .lt('issued_at', bounds.nextStart)
          .order('issued_at', { ascending: false })
          .range(from, to)
      ),
      fetchAll<ProjectionMembership>((from, to) =>
        db
          .from('memberships')
          .select(
            'id, account_id, contact_id, user_id, plan_id, pricing_option_id, start_date, end_date, status, fee_amount, fee_status, is_trial, collection_mode, created_at, updated_at, plan:membership_plans(*), pricing_option:plan_pricing_options(*)'
          )
          .eq('status', 'active')
          .eq('is_trial', false)
          .gte('end_date', projectionStart)
          .lt('end_date', projectionEnd)
          .order('id')
          .range(from, to)
      ),
      fetchAll<FinanceOverviewExpenseRow>((from, to) =>
        db
          .from('expenses')
          .select(
            'id, occurred_on, amount, description, method, status, created_at'
          )
          .eq('status', 'posted')
          .gte('occurred_on', period.previousStart)
          .lt('occurred_on', period.nextStart)
          .order('occurred_on', { ascending: false })
          .order('created_at', { ascending: false })
          .range(from, to)
      ),
    ]);

  const currentPayments = payments.filter(
    (payment) =>
      payment.paid_at >= bounds.currentStart &&
      payment.paid_at < bounds.nextStart
  );
  const previousPayments = payments.filter(
    (payment) =>
      payment.paid_at >= bounds.previousStart &&
      payment.paid_at < bounds.currentStart
  );
  const currentRefunds = refunds.filter(
    (refund) =>
      refund.processed_at >= bounds.currentStart &&
      refund.processed_at < bounds.nextStart
  );
  const previousRefunds = refunds.filter(
    (refund) =>
      refund.processed_at >= bounds.previousStart &&
      refund.processed_at < bounds.currentStart
  );
  const currentGross = currentPayments.reduce(
    (sum, payment) => sum + number(payment.amount),
    0
  );
  const previousGross = previousPayments.reduce(
    (sum, payment) => sum + number(payment.amount),
    0
  );
  const currentRefundAmount = currentRefunds.reduce(
    (sum, refund) => sum + number(refund.amount),
    0
  );
  const previousRefundAmount = previousRefunds.reduce(
    (sum, refund) => sum + number(refund.amount),
    0
  );

  const revenue = {
    current: currentGross - currentRefundAmount,
    previous: previousGross - previousRefundAmount,
    grossCurrent: currentGross,
    grossPrevious: previousGross,
    refundsCurrent: currentRefundAmount,
    refundsPrevious: previousRefundAmount,
  };
  const revenueBreakdown = summarizeFinanceRevenue(currentPayments);
  const revenueStreams = summarizeFinanceRevenueStreams(currentPayments);
  for (const refund of currentRefunds) {
    const purpose = refund.payment?.payment_purpose ?? 'other';
    revenueBreakdown[purpose] -= number(refund.amount);
    const stream = revenueStreams.find(
      (candidate) => candidate.purpose === purpose
    );
    if (stream) stream.amount -= number(refund.amount);
  }
  const expenseSnapshot = summarizeFinanceExpenses(expenseRows, period);
  const cashFlow = summarizeFinanceCashFlow(
    payments,
    expenseRows,
    period,
    timeZone,
    refunds
  );
  const expenses = {
    current: expenseSnapshot.current,
    previous: expenseSnapshot.previous,
  };
  const profit = {
    current: revenue.current - expenses.current,
    previous: revenue.previous - expenses.previous,
  };

  const invoiceHealth: FinanceInvoiceHealth = {
    paid: 0,
    partiallyPaid: 0,
    overdue: 0,
    open: 0,
    outstanding: 0,
    refundReview: 0,
  };
  const healthDay = period.end < today ? period.end : today;
  for (const invoice of invoices) {
    if (invoice.state === 'void') continue;
    if (invoice.requires_refund_review) {
      invoiceHealth.refundReview = (invoiceHealth.refundReview ?? 0) + 1;
      continue;
    }
    const paymentState = invoicePaymentState({
      fee_amount: invoice.total,
      amount_paid: Number(invoice.amount_paid) + Number(invoice.credit_applied),
      balance: invoice.balance,
    });
    if (paymentState === 'paid') {
      invoiceHealth.paid += 1;
      continue;
    }
    if (paymentState === 'no_charge') continue;
    const balance = number(invoice.balance);
    if (isChargeableAmount(balance)) invoiceHealth.outstanding += balance;
    if (isChargeableAmount(invoice.amount_paid)) {
      invoiceHealth.partiallyPaid += 1;
    } else if (todayInTz(timeZone, new Date(invoice.issued_at)) < healthDay) {
      invoiceHealth.overdue += 1;
    } else {
      invoiceHealth.open += 1;
    }
  }

  const methodStats = new Map<
    FinanceCollectionMethod['method'],
    FinanceCollectionMethod
  >();
  for (const payment of currentPayments) {
    const method = paymentMethod(payment.method);
    const stat = methodStats.get(method) ?? {
      method,
      payments: 0,
      amount: 0,
    };
    stat.payments += 1;
    stat.amount += number(payment.amount);
    methodStats.set(method, stat);
  }
  for (const refund of currentRefunds) {
    const method = paymentMethod(refund.payment?.method ?? 'other');
    const stat = methodStats.get(method) ?? {
      method,
      payments: 0,
      amount: 0,
    };
    stat.amount -= number(refund.amount);
    methodStats.set(method, stat);
  }
  const collectionMethods = Array.from(methodStats.values()).sort(
    (left, right) => right.amount - left.amount
  );

  let projectionAmount = 0;
  let projectionRenewals = 0;
  for (const membership of projectionMemberships) {
    const projected = projectNextInvoice(membership, today);
    if (!projected || !isChargeableAmount(projected.fee_amount)) continue;
    projectionAmount += number(projected.fee_amount);
    projectionRenewals += 1;
  }

  return {
    period,
    revenue,
    expenses,
    profit,
    projection: {
      amount: projectionAmount,
      renewals: projectionRenewals,
    },
    revenueBreakdown,
    revenueStreams,
    trend: cashFlow.current,
    previousTrend: cashFlow.previous,
    comparisonThroughDay: financeComparisonThroughDay(month, today),
    invoiceHealth,
    collectionMethods,
    recentTransactions: [
      ...currentPayments.map((payment) => ({
        id: payment.id,
        occurredAt: payment.paid_at,
        description: payment.contact?.name?.trim() || 'Deleted member',
        kind: 'membership' as const,
        method: paymentMethod(payment.method),
        amount: number(payment.amount),
        paymentPurpose: payment.payment_purpose ?? 'other',
      })),
      ...currentRefunds.map((refund) => ({
        id: refund.id,
        occurredAt: refund.processed_at,
        description: 'Razorpay refund',
        kind: 'refund' as const,
        method: paymentMethod(refund.payment?.method ?? 'other'),
        amount: number(refund.amount),
        paymentPurpose: refund.payment?.payment_purpose ?? 'other',
      })),
      ...expenseSnapshot.transactions,
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 4),
  };
}

function csvCell(value: string | number): string {
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function financeOverviewCsv(data: FinanceOverviewData): string {
  const comparison = alignFinanceCashFlowTrends(
    data.trend,
    data.previousTrend,
    'daily',
    data.comparisonThroughDay
  );
  const lines = [
    ['Business overview', `${data.period.start} to ${data.period.end}`],
    [],
    ['Summary', 'Current month', 'Previous month'],
    ['Revenue', data.revenue.current, data.revenue.previous],
    [
      'Gross collections',
      data.revenue.grossCurrent ?? data.revenue.current,
      data.revenue.grossPrevious ?? data.revenue.previous,
    ],
    [
      'Processed refunds',
      data.revenue.refundsCurrent ?? 0,
      data.revenue.refundsPrevious ?? 0,
    ],
    ['Expenses', data.expenses.current, data.expenses.previous],
    ['Profit', data.profit.current, data.profit.previous],
    ['Next month projected', data.projection.amount, ''],
    ['Projected renewals', data.projection.renewals, ''],
    [],
    ['Revenue breakdown', 'Amount'],
    ['New memberships', data.revenueBreakdown.joining],
    ['Renewals', data.revenueBreakdown.renewal],
    ['Products & services', data.revenueBreakdown.sale],
    ['Due payments recovered', data.revenueBreakdown.due],
    ...(data.revenueBreakdown.other > 0
      ? [['Other collections', data.revenueBreakdown.other]]
      : []),
    [],
    [
      'Date',
      'Income',
      'Expenses',
      'Previous date',
      'Previous income',
      'Previous expenses',
    ],
    ...comparison.map((point) => [
      point.currentStart ?? '',
      point.currentIncome,
      point.currentExpenses,
      point.previousStart ?? '',
      point.previousIncome,
      point.previousExpenses,
    ]),
    [],
    ['Payment method', 'Payments', 'Amount'],
    ...data.collectionMethods.map((method) => [
      method.method,
      method.payments,
      method.amount,
    ]),
  ];
  return `\uFEFF${lines
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\r\n')}\r\n`;
}
