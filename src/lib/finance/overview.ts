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
  Membership,
  MembershipPeriodInvoice,
  Payment,
  PaymentMethod,
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
  expenses: number | null;
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
}

export interface FinanceOverviewData {
  period: FinanceMonthRange;
  revenue: { current: number; previous: number };
  expenses: { current: number | null; previous: number | null };
  profit: { current: number | null; previous: number | null };
  projection: { amount: number; renewals: number };
  trend: FinanceTrendPoint[];
  invoiceHealth: FinanceInvoiceHealth;
  collectionMethods: FinanceCollectionMethod[];
  recentTransactions: FinanceRecentTransaction[];
  expenseTrackingAvailable: boolean;
}

type PaymentRow = Payment & {
  contact?: Pick<Contact, 'name'> | null;
};

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
  return Array.from(
    { length: currentYear - firstYear + 1 },
    (_, index) => String(currentYear - index)
  );
}

function number(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function paymentMethod(
  method: PaymentMethod
): FinanceCollectionMethod['method'] {
  return method === 'bank' || method === 'other' ? 'bank_other' : method;
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

  const [payments, invoices, projectionMemberships] = await Promise.all([
    fetchAll<PaymentRow>((from, to) =>
      db
        .from('payments')
        .select(
          'id, account_id, membership_id, contact_id, plan_id, user_id, amount, method, status, paid_at, period_start, period_end, note, source, gateway_payment_id, created_at, contact:contacts(name)'
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
          'id, account_id, membership_id, contact_id, plan_id, period_start, period_end, fee_amount, state, created_at, amount_paid, balance'
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

  const daily = new Map<string, FinanceTrendPoint>();
  for (
    let date = period.start;
    date <= period.end;
    date = istAddDays(date, 1)
  ) {
    daily.set(date, { date, income: 0, expenses: null });
  }
  for (const payment of currentPayments) {
    const date = todayInTz(timeZone, new Date(payment.paid_at));
    const point = daily.get(date);
    if (point) point.income += number(payment.amount);
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
    expenses: { current: null, previous: null },
    profit: { current: null, previous: null },
    projection: {
      amount: projectionAmount,
      renewals: projectionRenewals,
    },
    trend: Array.from(daily.values()),
    invoiceHealth,
    collectionMethods,
    recentTransactions: currentPayments.slice(0, 4).map((payment) => ({
      id: payment.id,
      occurredAt: payment.paid_at,
      description: payment.contact?.name?.trim() || 'Deleted member',
      kind: 'membership',
      method: paymentMethod(payment.method),
      amount: number(payment.amount),
    })),
    expenseTrackingAvailable: false,
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
    ['Expenses', data.expenses.current ?? '', data.expenses.previous ?? ''],
    ['Profit', data.profit.current ?? '', data.profit.previous ?? ''],
    ['Next month projected', data.projection.amount, ''],
    ['Projected renewals', data.projection.renewals, ''],
    [],
    ['Date', 'Income', 'Expenses'],
    ...data.trend.map((point) => [
      point.date,
      point.income,
      point.expenses ?? '',
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
