import type { SupabaseClient } from '@supabase/supabase-js';

import { todayInTz } from '@/lib/locale/format';
import { istAddDays } from '@/lib/memberships/expiry';
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

interface FinanceRefundCashRow {
  amount: number;
  processed_at: string;
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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function financePurpose(value: unknown): PaymentPurpose {
  return value === 'joining' ||
    value === 'renewal' ||
    value === 'sale' ||
    value === 'due'
    ? value
    : 'other';
}

export function normalizeFinanceOverviewSnapshot(
  value: unknown
): FinanceOverviewData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Finance overview returned an invalid response');
  }

  const row = object(value);
  const period = object(row.period);
  const revenue = object(row.revenue);
  const expenses = object(row.expenses);
  const profit = object(row.profit);
  const projection = object(row.projection);
  const breakdown = object(row.revenueBreakdown);
  const health = object(row.invoiceHealth);

  return {
    period: {
      month: string(period.month),
      start: string(period.start),
      end: string(period.end),
      nextStart: string(period.nextStart),
      previousStart: string(period.previousStart),
      previousEnd: string(period.previousEnd),
    },
    revenue: {
      current: number(revenue.current as number | string | null | undefined),
      previous: number(
        revenue.previous as number | string | null | undefined
      ),
      grossCurrent: number(
        revenue.grossCurrent as number | string | null | undefined
      ),
      grossPrevious: number(
        revenue.grossPrevious as number | string | null | undefined
      ),
      refundsCurrent: number(
        revenue.refundsCurrent as number | string | null | undefined
      ),
      refundsPrevious: number(
        revenue.refundsPrevious as number | string | null | undefined
      ),
    },
    expenses: {
      current: number(expenses.current as number | string | null | undefined),
      previous: number(
        expenses.previous as number | string | null | undefined
      ),
    },
    profit: {
      current: number(profit.current as number | string | null | undefined),
      previous: number(profit.previous as number | string | null | undefined),
    },
    projection: {
      amount: number(projection.amount as number | string | null | undefined),
      renewals: number(
        projection.renewals as number | string | null | undefined
      ),
    },
    revenueBreakdown: {
      joining: number(
        breakdown.joining as number | string | null | undefined
      ),
      renewal: number(
        breakdown.renewal as number | string | null | undefined
      ),
      sale: number(breakdown.sale as number | string | null | undefined),
      due: number(breakdown.due as number | string | null | undefined),
      other: number(breakdown.other as number | string | null | undefined),
    },
    revenueStreams: list(row.revenueStreams).map((value) => {
      const stream = object(value);
      return {
        purpose: financePurpose(stream.purpose),
        payments: number(
          stream.payments as number | string | null | undefined
        ),
        amount: number(stream.amount as number | string | null | undefined),
        recentPayments: list(stream.recentPayments).map((value) => {
          const payment = object(value);
          return {
            id: string(payment.id),
            membershipId:
              payment.membershipId === null
                ? null
                : string(payment.membershipId),
            memberNumber:
              payment.memberNumber === null
                ? null
                : number(
                    payment.memberNumber as
                      | number
                      | string
                      | null
                      | undefined
                  ),
            contactName:
              payment.contactName === null
                ? null
                : string(payment.contactName),
            contactAvatarUrl:
              payment.contactAvatarUrl === null
                ? null
                : string(payment.contactAvatarUrl),
            planName:
              payment.planName === null ? null : string(payment.planName),
            paidAt: string(payment.paidAt),
            membershipStartDate:
              payment.membershipStartDate === null
                ? null
                : string(payment.membershipStartDate),
            periodEnd:
              payment.periodEnd === null ? null : string(payment.periodEnd),
            method: string(payment.method) as PaymentMethod,
            source: string(payment.source) as Payment['source'],
            amount: number(
              payment.amount as number | string | null | undefined
            ),
          };
        }),
      };
    }),
    trend: list(row.trend).map((value) => {
      const point = object(value);
      return {
        date: string(point.date),
        income: number(point.income as number | string | null | undefined),
        expenses: number(
          point.expenses as number | string | null | undefined
        ),
      };
    }),
    previousTrend: list(row.previousTrend).map((value) => {
      const point = object(value);
      return {
        date: string(point.date),
        income: number(point.income as number | string | null | undefined),
        expenses: number(
          point.expenses as number | string | null | undefined
        ),
      };
    }),
    comparisonThroughDay:
      row.comparisonThroughDay === null
        ? null
        : number(
            row.comparisonThroughDay as
              | number
              | string
              | null
              | undefined
          ),
    invoiceHealth: {
      paid: number(health.paid as number | string | null | undefined),
      partiallyPaid: number(
        health.partiallyPaid as number | string | null | undefined
      ),
      overdue: number(health.overdue as number | string | null | undefined),
      open: number(health.open as number | string | null | undefined),
      outstanding: number(
        health.outstanding as number | string | null | undefined
      ),
      refundReview: number(
        health.refundReview as number | string | null | undefined
      ),
    },
    collectionMethods: list(row.collectionMethods).map((value) => {
      const method = object(value);
      return {
        method: string(method.method) as FinanceCollectionMethod['method'],
        payments: number(
          method.payments as number | string | null | undefined
        ),
        amount: number(method.amount as number | string | null | undefined),
      };
    }),
    recentTransactions: list(row.recentTransactions).map((value) => {
      const transaction = object(value);
      return {
        id: string(transaction.id),
        occurredAt: string(transaction.occurredAt),
        description: string(transaction.description),
        kind: string(transaction.kind) as FinanceRecentTransaction['kind'],
        method: string(transaction.method),
        amount: number(
          transaction.amount as number | string | null | undefined
        ),
        ...(transaction.paymentPurpose === undefined
          ? {}
          : { paymentPurpose: financePurpose(transaction.paymentPurpose) }),
      };
    }),
  };
}

export async function loadFinanceOverview(
  db: SupabaseClient,
  accountId: string,
  month: string,
  timeZone: string,
  today: string
): Promise<FinanceOverviewData> {
  const { data, error } = await db.rpc('finance_overview_snapshot', {
    p_account_id: accountId,
    p_month_start: `${month}-01`,
    p_time_zone: timeZone,
    p_today: today,
  });
  if (error) throw error;
  return normalizeFinanceOverviewSnapshot(data);
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
