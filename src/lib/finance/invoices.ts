import type { SupabaseClient } from '@supabase/supabase-js';

import { dayStartInTz } from '@/lib/locale/format';
import {
  invoicePaymentState,
  isChargeableAmount,
  type InvoicePaymentState,
} from '@/lib/memberships/periods';
import type {
  Membership,
  MembershipCollectionMode,
  MembershipPeriodInvoice,
} from '@/types';
import { financeMonthRange } from './overview';

export type FinanceInvoiceLifecycle = 'current' | 'past' | 'upcoming' | 'void';

export type FinanceInvoiceSortKey =
  | 'reference'
  | 'name'
  | 'plan'
  | 'period'
  | 'issued_on'
  | 'total'
  | 'paid'
  | 'balance';

export interface FinanceInvoiceRow extends MembershipPeriodInvoice {
  membership: Membership | null;
  lifecycle: FinanceInvoiceLifecycle;
  paymentState: InvoicePaymentState;
  overdue: boolean;
  reference: string;
}

export interface FinanceInvoiceFilterState {
  paymentStates: InvoicePaymentState[];
  planIds: string[];
  collectionModes: MembershipCollectionMode[];
}

export const EMPTY_FINANCE_INVOICE_FILTERS: FinanceInvoiceFilterState = {
  paymentStates: [],
  planIds: [],
  collectionModes: [],
};

export interface FinanceInvoiceSummary {
  count: number;
  invoiced: number;
  collected: number;
  outstanding: number;
  overdue: number;
}

type SortState = {
  key: FinanceInvoiceSortKey;
  dir: 'asc' | 'desc';
};

const INVOICE_PAGE_SIZE = 1_000;
const MEMBERSHIP_BATCH_SIZE = 200;

type PagedResult = PromiseLike<{
  data: unknown[] | null;
  error: unknown;
}>;

async function fetchAll<T>(
  page: (from: number, to: number) => PagedResult
): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += INVOICE_PAGE_SIZE) {
    const response = await page(from, from + INVOICE_PAGE_SIZE - 1);
    if (response.error) throw response.error;
    const rows = (response.data ?? []) as T[];
    result.push(...rows);
    if (rows.length < INVOICE_PAGE_SIZE) return result;
  }
}

export function financeInvoiceReference(id: string): string {
  return `#${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

export function financeInvoiceLifecycle(
  invoice: Pick<
    MembershipPeriodInvoice,
    'state' | 'period_start' | 'period_end'
  >,
  membershipEndDate: string | null,
  today: string
): FinanceInvoiceLifecycle {
  if (invoice.state === 'void') return 'void';
  if (invoice.period_start > today) return 'upcoming';
  if (membershipEndDate && invoice.period_end === membershipEndDate) {
    return 'current';
  }
  return 'past';
}

export function normalizeFinanceInvoiceRows(
  invoices: MembershipPeriodInvoice[],
  memberships: Membership[],
  today: string
): FinanceInvoiceRow[] {
  const membershipById = new Map(
    memberships.map((membership) => [membership.id, membership])
  );
  return invoices.map((invoice) => {
    const membership = membershipById.get(invoice.membership_id) ?? null;
    const paymentState = invoicePaymentState(invoice);
    return {
      ...invoice,
      membership,
      lifecycle: financeInvoiceLifecycle(
        invoice,
        membership?.end_date ?? null,
        today
      ),
      paymentState,
      overdue:
        invoice.state === 'open' &&
        paymentState === 'due' &&
        invoice.period_end < today,
      reference: financeInvoiceReference(invoice.id),
    };
  });
}

export function filterFinanceInvoices(
  rows: FinanceInvoiceRow[],
  {
    search,
    lifecycle,
    filters,
    sort,
  }: {
    search: string;
    lifecycle: 'all' | FinanceInvoiceLifecycle;
    filters: FinanceInvoiceFilterState;
    sort: SortState;
  }
): FinanceInvoiceRow[] {
  const term = search.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    const membership = row.membership;
    if (term) {
      const searchValues = [
        row.reference,
        row.id,
        membership?.contact?.name,
        membership?.contact?.phone,
        membership?.member_number,
      ];
      if (
        !searchValues.some((value) =>
          String(value ?? '')
            .toLocaleLowerCase()
            .includes(term)
        )
      ) {
        return false;
      }
    }
    if (lifecycle !== 'all' && row.lifecycle !== lifecycle) return false;
    if (
      filters.paymentStates.length > 0 &&
      !filters.paymentStates.includes(row.paymentState)
    ) {
      return false;
    }
    if (
      filters.planIds.length > 0 &&
      !filters.planIds.includes(row.plan_id ?? '')
    ) {
      return false;
    }
    if (
      filters.collectionModes.length > 0 &&
      !filters.collectionModes.includes(membership?.collection_mode ?? 'manual')
    ) {
      return false;
    }
    return true;
  });

  const direction = sort.dir === 'asc' ? 1 : -1;
  return [...filtered].sort((left, right) => {
    let comparison = 0;
    if (sort.key === 'reference') {
      comparison = left.reference.localeCompare(right.reference);
    } else if (sort.key === 'name') {
      comparison = (left.membership?.contact?.name ?? '').localeCompare(
        right.membership?.contact?.name ?? ''
      );
    } else if (sort.key === 'plan') {
      comparison = (left.membership?.plan?.name ?? '').localeCompare(
        right.membership?.plan?.name ?? ''
      );
    } else if (sort.key === 'period') {
      comparison = left.period_start.localeCompare(right.period_start);
    } else if (sort.key === 'total') {
      comparison = Number(left.fee_amount) - Number(right.fee_amount);
    } else if (sort.key === 'paid') {
      comparison = Number(left.amount_paid) - Number(right.amount_paid);
    } else if (sort.key === 'balance') {
      comparison = Number(left.balance) - Number(right.balance);
    } else {
      comparison = left.created_at.localeCompare(right.created_at);
    }
    return comparison * direction;
  });
}

export function financeInvoiceSummary(
  rows: FinanceInvoiceRow[]
): FinanceInvoiceSummary {
  return rows.reduce<FinanceInvoiceSummary>(
    (summary, row) => {
      summary.count += 1;
      if (row.state === 'void') return summary;
      summary.invoiced += Number(row.fee_amount);
      summary.collected += Number(row.amount_paid);
      if (isChargeableAmount(row.balance)) {
        summary.outstanding += Number(row.balance);
        if (row.overdue) summary.overdue += 1;
      }
      return summary;
    },
    { count: 0, invoiced: 0, collected: 0, outstanding: 0, overdue: 0 }
  );
}

async function loadMemberships(
  db: SupabaseClient,
  membershipIds: string[]
): Promise<Membership[]> {
  const rows: Membership[] = [];
  for (
    let index = 0;
    index < membershipIds.length;
    index += MEMBERSHIP_BATCH_SIZE
  ) {
    const batch = membershipIds.slice(index, index + MEMBERSHIP_BATCH_SIZE);
    const { data, error } = await db
      .from('memberships')
      .select(
        '*, contact:contacts(*), plan:membership_plans(*), pricing_option:plan_pricing_options(*)'
      )
      .in('id', batch);
    if (error) throw error;
    rows.push(...(((data as Membership[]) ?? []) as Membership[]));
  }
  return rows;
}

export async function loadFinanceInvoices(
  db: SupabaseClient,
  month: string,
  timeZone: string,
  today: string
): Promise<FinanceInvoiceRow[]> {
  const period = financeMonthRange(month);
  const start = dayStartInTz(period.start, timeZone);
  const next = dayStartInTz(period.nextStart, timeZone);
  if (!start || !next) {
    throw new Error('Could not resolve invoice dates in the account time zone');
  }

  const invoices = await fetchAll<MembershipPeriodInvoice>((from, to) =>
    db
      .from('membership_period_invoices')
      .select(
        'id, account_id, membership_id, contact_id, plan_id, period_start, period_end, fee_amount, state, created_at, amount_paid, balance, list_price, discount_type, discount_value, discount_amount'
      )
      .gte('created_at', start.toISOString())
      .lt('created_at', next.toISOString())
      .order('created_at', { ascending: false })
      .range(from, to)
  );

  const membershipIds = Array.from(
    new Set(invoices.map((invoice) => invoice.membership_id))
  );
  const memberships =
    membershipIds.length > 0 ? await loadMemberships(db, membershipIds) : [];
  return normalizeFinanceInvoiceRows(invoices, memberships, today);
}

function csvCell(value: string | number): string {
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function financeInvoicesCsv(rows: FinanceInvoiceRow[]): string {
  const lines: Array<Array<string | number>> = [
    [
      'Invoice record',
      'Member ID',
      'Name',
      'Phone',
      'Plan',
      'Billing period start',
      'Billing period end',
      'Issued on',
      'Lifecycle',
      'Payment status',
      'Invoice total',
      'Paid',
      'Balance',
      'Collection mode',
    ],
    ...rows.map((row) => [
      row.reference,
      row.membership?.member_number ?? '',
      row.membership?.contact?.name ?? 'Deleted member',
      row.membership?.contact?.phone ?? '',
      row.membership?.plan?.name ?? '',
      row.period_start,
      row.period_end,
      row.created_at,
      row.lifecycle,
      row.paymentState,
      Number(row.fee_amount),
      Number(row.amount_paid),
      Number(row.balance),
      row.membership?.collection_mode ?? 'manual',
    ]),
  ];
  return `\uFEFF${lines
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\r\n')}\r\n`;
}
