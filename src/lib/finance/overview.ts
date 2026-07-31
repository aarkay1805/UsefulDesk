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
  MembershipPeriodInvoice,
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

export interface FinanceInvoiceHealth {
  paid: number;
  partiallyPaid: number;
  overdue: number;
  open: number;
  outstanding: number;
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
  kind: 'membership' | 'expense';
  method: string;
  amount: number;
  paymentPurpose?: PaymentPurpose;
}

export type FinanceRevenueBreakdown = Record<PaymentPurpose, number>;

export interface FinanceRevenuePlanBreakdown {
  id: string | null;
  name: string;
  payments: number;
  amount: number;
}

export interface FinanceRevenueStream {
  purpose: PaymentPurpose;
  payments: number;
  amount: number;
  plans: FinanceRevenuePlanBreakdown[];
}

export type FinanceRevenuePaymentRow = Pick<
  Payment,
  'amount' | 'payment_purpose' | 'status'
>;

export type FinanceRevenueStreamPaymentRow = FinanceRevenuePaymentRow &
  Pick<Payment, 'plan_id'> & {
    plan?: Pick<MembershipPlan, 'name'> | null;
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
  revenue: { current: number; previous: number };
  expenses: { current: number; previous: number };
  profit: { current: number; previous: number };
  projection: { amount: number; renewals: number };
  revenueBreakdown: FinanceRevenueBreakdown;
  revenueStreams: FinanceRevenueStream[];
  adPerformance: FinanceAdPerformance;
  trend: FinanceTrendPoint[];
  invoiceHealth: FinanceInvoiceHealth;
  collectionMethods: FinanceCollectionMethod[];
  recentTransactions: FinanceRecentTransaction[];
}

type PaymentRow = Payment & {
  contact?: Pick<Contact, 'name'> | null;
  plan?: Pick<MembershipPlan, 'name'> | null;
};

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
  const purposes: PaymentPurpose[] = ['joining', 'renewal', 'due', 'other'];
  const streams = new Map<
    PaymentPurpose,
    {
      payments: number;
      amount: number;
      plans: Map<string, FinanceRevenuePlanBreakdown>;
    }
  >(
    purposes.map((purpose) => [
      purpose,
      { payments: 0, amount: 0, plans: new Map() },
    ])
  );

  for (const payment of rows) {
    if (payment.status !== 'paid') continue;
    const purpose = payment.payment_purpose ?? 'other';
    const stream = streams.get(purpose);
    if (!stream) continue;

    const amount = number(payment.amount);
    const planKey = payment.plan_id ?? 'unassigned';
    const plan = stream.plans.get(planKey) ?? {
      id: payment.plan_id,
      name: payment.plan?.name?.trim() || 'Unassigned plan',
      payments: 0,
      amount: 0,
    };

    stream.payments += 1;
    stream.amount += amount;
    plan.payments += 1;
    plan.amount += amount;
    stream.plans.set(planKey, plan);
  }

  return purposes.map((purpose) => {
    const stream = streams.get(purpose)!;
    return {
      purpose,
      payments: stream.payments,
      amount: stream.amount,
      plans: Array.from(stream.plans.values()).sort(
        (left, right) =>
          right.amount - left.amount || left.name.localeCompare(right.name)
      ),
    };
  });
}

async function loadFinanceAdPerformance(
  db: SupabaseClient,
  period: FinanceMonthRange,
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

  const [
    payments,
    invoices,
    projectionMemberships,
    expenseRows,
    adPerformance,
  ] = await Promise.all([
    fetchAll<PaymentRow>((from, to) =>
      db
        .from('payments')
        .select(
          'id, account_id, membership_id, contact_id, plan_id, user_id, amount, method, status, paid_at, period_start, period_end, note, source, payment_purpose, gateway_payment_id, created_at, contact:contacts(name), plan:membership_plans(name)'
        )
        .eq('status', 'paid')
        .gte('paid_at', bounds.previousStart)
        .lt('paid_at', bounds.nextStart)
        .order('paid_at', { ascending: false })
        .range(from, to)
    ),
    fetchAll<MembershipPeriodInvoice>((from, to) =>
      db
        .from('membership_period_invoices')
        .select(
          'id, account_id, membership_id, contact_id, plan_id, period_start, period_end, fee_amount, state, created_at, amount_paid, balance, standard_period_end, bonus_months'
        )
        .gte('created_at', bounds.currentStart)
        .lt('created_at', bounds.nextStart)
        .order('created_at', { ascending: false })
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
    loadFinanceAdPerformance(db, period, timeZone),
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

  const revenue = {
    current: currentPayments.reduce(
      (sum, payment) => sum + number(payment.amount),
      0
    ),
    previous: previousPayments.reduce(
      (sum, payment) => sum + number(payment.amount),
      0
    ),
  };
  const revenueBreakdown = summarizeFinanceRevenue(currentPayments);
  const revenueStreams = summarizeFinanceRevenueStreams(currentPayments);
  const expenseSnapshot = summarizeFinanceExpenses(expenseRows, period);
  const expenses = {
    current: expenseSnapshot.current,
    previous: expenseSnapshot.previous,
  };
  const profit = {
    current: revenue.current - expenses.current,
    previous: revenue.previous - expenses.previous,
  };

  const daily = new Map<string, FinanceTrendPoint>();
  for (
    let date = period.start;
    date <= period.end;
    date = istAddDays(date, 1)
  ) {
    daily.set(date, { date, income: 0, expenses: 0 });
  }
  for (const payment of currentPayments) {
    const date = todayInTz(timeZone, new Date(payment.paid_at));
    const point = daily.get(date);
    if (point) point.income += number(payment.amount);
  }
  for (const expense of expenseSnapshot.daily) {
    const point = daily.get(expense.date);
    if (point) point.expenses += expense.amount;
  }

  const invoiceHealth: FinanceInvoiceHealth = {
    paid: 0,
    partiallyPaid: 0,
    overdue: 0,
    open: 0,
    outstanding: 0,
  };
  const healthDay = period.end < today ? period.end : today;
  for (const invoice of invoices) {
    if (invoice.state === 'void') continue;
    const paymentState = invoicePaymentState(invoice);
    if (paymentState === 'paid') {
      invoiceHealth.paid += 1;
      continue;
    }
    if (paymentState === 'no_charge') continue;
    const balance = number(invoice.balance);
    if (isChargeableAmount(balance)) invoiceHealth.outstanding += balance;
    if (isChargeableAmount(invoice.amount_paid)) {
      invoiceHealth.partiallyPaid += 1;
    } else if (invoice.period_end < healthDay) {
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
    adPerformance,
    trend: Array.from(daily.values()),
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
  const lines = [
    ['Finance overview', `${data.period.start} to ${data.period.end}`],
    [],
    ['Summary', 'Current month', 'Previous month'],
    ['Revenue', data.revenue.current, data.revenue.previous],
    ['Expenses', data.expenses.current, data.expenses.previous],
    ['Profit', data.profit.current, data.profit.previous],
    ['Next month projected', data.projection.amount, ''],
    ['Projected renewals', data.projection.renewals, ''],
    [],
    ['Revenue breakdown', 'Amount'],
    ['New memberships', data.revenueBreakdown.joining],
    ['Renewals', data.revenueBreakdown.renewal],
    ['Due payments recovered', data.revenueBreakdown.due],
    ...(data.revenueBreakdown.other > 0
      ? [['Other collections', data.revenueBreakdown.other]]
      : []),
    [],
    ['Ad performance', 'Value'],
    ['Marketing spend', data.adPerformance.adSpend],
    ['Ad-source leads', data.adPerformance.leads],
    ['Converted members to date', data.adPerformance.convertedMembers],
    ['Joining revenue to date', data.adPerformance.joiningRevenue],
    [
      'Conversion rate',
      data.adPerformance.conversionRate === null
        ? ''
        : data.adPerformance.conversionRate,
    ],
    [
      'Return on ad spend',
      data.adPerformance.returnOnAdSpend === null
        ? ''
        : data.adPerformance.returnOnAdSpend,
    ],
    [],
    ['Date', 'Income', 'Expenses'],
    ...data.trend.map((point) => [point.date, point.income, point.expenses]),
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
