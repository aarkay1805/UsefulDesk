import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Invoice, InvoiceLine, InvoiceLineKind } from '@/types';

import { dayStartInTz, todayInTz } from '@/lib/locale/format';
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
export type FinanceInvoiceQueue =
  'all' | 'attention' | 'paid' | 'upcoming' | 'void';

export type FinanceInvoiceSortKey =
  | 'reference'
  | 'name'
  | 'member_id'
  | 'plan'
  | 'period'
  | 'issued_on'
  | 'total'
  | 'paid'
  | 'balance';

export interface FinanceInvoiceRow extends MembershipPeriodInvoice {
  membership: Membership | null;
  contact: Contact | null;
  lifecycle: FinanceInvoiceLifecycle;
  paymentState: InvoicePaymentState;
  overdue: boolean;
  reference: string;
  source?:
    | 'joining'
    | 'membership_renewal'
    | 'sale'
    | 'service_renewal'
    | 'service_adjustment';
  lineKinds?: InvoiceLineKind[];
  gatewayPaymentIds?: string[];
  gatewayRefundIds?: string[];
  refundDispositions?: string[];
}

interface GenericInvoiceRow {
  id: string;
  account_id: string;
  contact_id: string | null;
  membership_id: string | null;
  membership_period_id: string | null;
  source: NonNullable<FinanceInvoiceRow['source']>;
  state: 'open' | 'void';
  issued_at: string;
  created_at: string;
  invoice_sequence: number | null;
  invoice_number: string | null;
  seller_snapshot: Invoice['seller_snapshot'];
  customer_snapshot: Invoice['customer_snapshot'];
  identity_snapshot_version: number | null;
  total: number;
  amount_paid: number;
  credit_applied: number;
  balance: number;
  gross_total: number;
  gross_amount_paid: number;
  processed_refund_amount: number;
  invoice_adjustment_amount: number;
  net_total: number;
  accounting_balance: number;
  collectible_balance: number;
  requires_refund_review: boolean;
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
  grossInvoiced: number;
  adjustments: number;
  invoiced: number;
  grossCollected: number;
  refunds: number;
  collected: number;
  outstanding: number;
  overdue: number;
}

function moneyPaise(value: number): number {
  return Math.round(Number(value) * 100);
}

function moneyDifference(left: number, right: number): number {
  return (moneyPaise(left) - moneyPaise(right)) / 100;
}

function addMoney(total: number, value: number): number {
  return (moneyPaise(total) + moneyPaise(value)) / 100;
}

type SortState = {
  key: FinanceInvoiceSortKey;
  dir: 'asc' | 'desc';
};

const INVOICE_PAGE_SIZE = 1_000;
const MEMBERSHIP_BATCH_SIZE = 200;
const CONTACT_BATCH_SIZE = 200;

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

export function financeInvoiceReference(
  invoice: Pick<MembershipPeriodInvoice, 'id' | 'invoice_number'>
): string {
  return invoice.invoice_number ?? `#${invoice.id.slice(0, 8).toUpperCase()}`;
}

const INVOICE_SOURCE_LABEL: Record<Invoice['source'], string> = {
  joining: 'Joining',
  membership_renewal: 'Membership renewal',
  sale: 'Sale',
  service_renewal: 'Service renewal',
  service_adjustment: 'Service adjustment',
};

export function invoiceSourceLabel(source: Invoice['source']): string {
  return INVOICE_SOURCE_LABEL[source];
}

export function invoiceItemLabel(
  line: Pick<InvoiceLine, 'description' | 'quantity'>
): string {
  return `${line.description}${line.quantity > 1 ? ` × ${line.quantity}` : ''}`;
}

export function invoiceItemsLabel(
  lines: Array<Pick<InvoiceLine, 'description' | 'quantity'>>
): string {
  return lines.length > 0 ? lines.map(invoiceItemLabel).join(' + ') : 'Invoice';
}

export function groupInvoiceLines<T extends Pick<InvoiceLine, 'invoice_id'>>(
  lines: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const line of lines) {
    const invoiceLines = grouped.get(line.invoice_id) ?? [];
    invoiceLines.push(line);
    grouped.set(line.invoice_id, invoiceLines);
  }
  return grouped;
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
  today: string,
  contacts: Contact[] = []
): FinanceInvoiceRow[] {
  const membershipById = new Map(
    memberships.map((membership) => [membership.id, membership])
  );
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  return invoices.map((invoice) => {
    const membership = membershipById.get(invoice.membership_id) ?? null;
    const contact =
      membership?.contact ?? contactById.get(invoice.contact_id) ?? null;
    const paymentState = invoicePaymentState(invoice);
    return {
      ...invoice,
      membership,
      contact,
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
      reference: financeInvoiceReference(invoice),
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
    const contact = row.contact ?? membership?.contact;
    if (term) {
      const searchValues = [
        row.reference,
        row.id,
        contact?.name,
        contact?.phone,
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
      const leftSequence = left.invoice_sequence;
      const rightSequence = right.invoice_sequence;
      const leftHasSequence = leftSequence !== null;
      const rightHasSequence = rightSequence !== null;
      if (leftHasSequence !== rightHasSequence) {
        // Persisted identities always precede migration-safe legacy fallbacks;
        // direction only changes ordering inside either partition.
        return leftHasSequence ? -1 : 1;
      }
      if (leftSequence !== null && rightSequence !== null) {
        comparison = leftSequence - rightSequence;
      }
      if (comparison === 0) {
        // Equal sequences and legacy rows use their existing references as a
        // deterministic tie-break without inventing an identity value.
        comparison = left.reference.localeCompare(right.reference);
      }
    } else if (sort.key === 'name') {
      comparison = (left.membership?.contact?.name ?? '').localeCompare(
        right.membership?.contact?.name ?? ''
      );
    } else if (sort.key === 'member_id') {
      comparison =
        Number(left.membership?.member_number ?? 0) -
        Number(right.membership?.member_number ?? 0);
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
      summary.grossInvoiced = addMoney(
        summary.grossInvoiced,
        Number(row.fee_amount)
      );
      summary.adjustments = addMoney(
        summary.adjustments,
        Number(row.invoice_adjustment_amount ?? 0)
      );
      summary.invoiced = addMoney(
        summary.invoiced,
        moneyDifference(
          Number(row.fee_amount),
          Number(row.invoice_adjustment_amount ?? 0)
        )
      );
      summary.grossCollected = addMoney(
        summary.grossCollected,
        Number(row.gross_amount_paid ?? row.amount_paid)
      );
      summary.refunds = addMoney(
        summary.refunds,
        Number(row.processed_refund_amount ?? 0)
      );
      summary.collected = addMoney(summary.collected, Number(row.amount_paid));
      if (isChargeableAmount(row.balance)) {
        summary.outstanding = addMoney(
          summary.outstanding,
          Number(row.balance)
        );
        if (row.overdue) summary.overdue += 1;
      }
      return summary;
    },
    {
      count: 0,
      grossInvoiced: 0,
      adjustments: 0,
      invoiced: 0,
      grossCollected: 0,
      refunds: 0,
      collected: 0,
      outstanding: 0,
      overdue: 0,
    }
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

export function financeInvoiceMatchesQueue(
  row: FinanceInvoiceRow,
  queue: FinanceInvoiceQueue
): boolean {
  if (queue === 'all') return true;
  if (queue === 'attention') {
    return (
      row.requires_refund_review ||
      row.overdue ||
      (row.state === 'open' &&
        row.paymentState === 'due' &&
        row.lifecycle !== 'upcoming')
    );
  }
  if (queue === 'paid') {
    return (
      row.state === 'open' &&
      !row.requires_refund_review &&
      row.paymentState === 'paid'
    );
  }
  if (queue === 'upcoming') {
    return (
      row.state === 'open' &&
      !row.requires_refund_review &&
      row.lifecycle === 'upcoming'
    );
  }
  return row.state === 'void';
}

async function loadContacts(
  db: SupabaseClient,
  contactIds: string[]
): Promise<Contact[]> {
  const rows: Contact[] = [];
  for (let index = 0; index < contactIds.length; index += CONTACT_BATCH_SIZE) {
    const batch = contactIds.slice(index, index + CONTACT_BATCH_SIZE);
    const { data, error } = await db
      .from('contacts')
      .select('*')
      .in('id', batch);
    if (error) throw error;
    rows.push(...(((data as Contact[]) ?? []) as Contact[]));
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

  const genericInvoices = await fetchAll<GenericInvoiceRow>((from, to) =>
    db
      .from('invoice_balances')
      .select('*')
      .gte('issued_at', start.toISOString())
      .lt('issued_at', next.toISOString())
      .order('issued_at', { ascending: false })
      .range(from, to)
  );

  const periodIds = genericInvoices
    .map((invoice) => invoice.membership_period_id)
    .filter((id): id is string => !!id);
  const { data: periodRows, error: periodError } = periodIds.length
    ? await db
        .from('membership_periods')
        .select('id, plan_id, period_start, period_end')
        .in('id', periodIds)
    : { data: [], error: null };
  if (periodError) throw periodError;
  const invoiceIds = genericInvoices.map((invoice) => invoice.id);
  const [lineResult, paymentResult] = invoiceIds.length
    ? await Promise.all([
        db
          .from('invoice_lines')
          .select('invoice_id, kind')
          .in('invoice_id', invoiceIds)
          .eq('state', 'active'),
        db
          .from('payments')
          .select('id, invoice_id, gateway_payment_id')
          .in('invoice_id', invoiceIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (lineResult.error) throw lineResult.error;
  if (paymentResult.error) throw paymentResult.error;
  const lineRows = lineResult.data;
  const paymentRows = paymentResult.data;
  const paymentIds = (paymentRows ?? []).map((payment) => payment.id);
  const { data: refundRows, error: refundError } = paymentIds.length
    ? await db
        .from('payment_refunds')
        .select('payment_id, gateway_refund_id, disposition, status')
        .in('payment_id', paymentIds)
        .eq('status', 'processed')
    : { data: [], error: null };
  if (refundError) throw refundError;
  const periods = new Map(
    (periodRows ?? []).map((period) => [period.id, period])
  );

  const invoices: MembershipPeriodInvoice[] = genericInvoices.map((invoice) => {
    const period = invoice.membership_period_id
      ? periods.get(invoice.membership_period_id)
      : null;
    const issuedDay = todayInTz(timeZone, new Date(invoice.issued_at));
    return {
      id: invoice.id,
      account_id: invoice.account_id,
      membership_id: invoice.membership_id ?? '',
      contact_id: invoice.contact_id ?? '',
      plan_id: period?.plan_id ?? null,
      period_start: period?.period_start ?? issuedDay,
      period_end: period?.period_end ?? issuedDay,
      fee_amount: Number(invoice.total),
      state: invoice.state,
      created_at: invoice.issued_at,
      amount_paid: Number(invoice.amount_paid),
      credit_applied: Number(invoice.credit_applied),
      balance: Number(invoice.balance),
      invoice_id: invoice.id,
      gross_amount_paid: Number(invoice.gross_amount_paid),
      processed_refund_amount: Number(invoice.processed_refund_amount),
      invoice_adjustment_amount: Number(invoice.invoice_adjustment_amount),
      accounting_balance: Number(invoice.accounting_balance),
      collectible_balance: Number(invoice.collectible_balance),
      requires_refund_review: Boolean(invoice.requires_refund_review),
      invoice_sequence: invoice.invoice_sequence,
      invoice_number: invoice.invoice_number,
      seller_snapshot: invoice.seller_snapshot,
      customer_snapshot: invoice.customer_snapshot,
      identity_snapshot_version: invoice.identity_snapshot_version,
    };
  });

  const membershipIds = Array.from(
    new Set(invoices.map((invoice) => invoice.membership_id).filter(Boolean))
  );
  const memberships =
    membershipIds.length > 0 ? await loadMemberships(db, membershipIds) : [];
  const loadedContactIds = new Set(
    memberships
      .filter((membership) => Boolean(membership.contact))
      .map((membership) => membership.contact_id)
  );
  const standaloneContactIds = Array.from(
    new Set(
      genericInvoices
        .map((invoice) => invoice.contact_id)
        .filter(
          (id): id is string =>
            Boolean(id) && !loadedContactIds.has(id as string)
        )
    )
  );
  const contacts =
    standaloneContactIds.length > 0
      ? await loadContacts(db, standaloneContactIds)
      : [];
  const sourceById = new Map(
    genericInvoices.map((invoice) => [invoice.id, invoice.source])
  );
  const lineKindsByInvoice = new Map<string, Set<InvoiceLineKind>>();
  for (const line of lineRows ?? []) {
    const kinds = lineKindsByInvoice.get(line.invoice_id) ?? new Set();
    kinds.add(line.kind as InvoiceLineKind);
    lineKindsByInvoice.set(line.invoice_id, kinds);
  }
  const invoiceByPayment = new Map(
    (paymentRows ?? []).map((payment) => [payment.id, payment.invoice_id])
  );
  const gatewayPaymentsByInvoice = new Map<string, string[]>();
  for (const payment of paymentRows ?? []) {
    if (!payment.invoice_id || !payment.gateway_payment_id) continue;
    const ids = gatewayPaymentsByInvoice.get(payment.invoice_id) ?? [];
    ids.push(payment.gateway_payment_id);
    gatewayPaymentsByInvoice.set(payment.invoice_id, ids);
  }
  const gatewayRefundsByInvoice = new Map<
    string,
    Array<{ id: string; disposition: string | null }>
  >();
  for (const refund of refundRows ?? []) {
    const invoiceId = invoiceByPayment.get(refund.payment_id);
    if (!invoiceId || !refund.gateway_refund_id) continue;
    const rows = gatewayRefundsByInvoice.get(invoiceId) ?? [];
    rows.push({
      id: refund.gateway_refund_id,
      disposition: refund.disposition,
    });
    gatewayRefundsByInvoice.set(invoiceId, rows);
  }
  return normalizeFinanceInvoiceRows(
    invoices,
    memberships,
    today,
    contacts
  ).map((row) => ({
    ...row,
    source: sourceById.get(row.id),
    lineKinds: [...(lineKindsByInvoice.get(row.id) ?? new Set())],
    gatewayPaymentIds: gatewayPaymentsByInvoice.get(row.id) ?? [],
    gatewayRefundIds: (gatewayRefundsByInvoice.get(row.id) ?? []).map(
      (refund) => refund.id
    ),
    refundDispositions: (gatewayRefundsByInvoice.get(row.id) ?? [])
      .map((refund) => refund.disposition)
      .filter((value): value is string => Boolean(value)),
  }));
}

function csvCell(value: string | number): string {
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function financeInvoicesCsv(rows: FinanceInvoiceRow[]): string {
  const lines: Array<Array<string | number>> = [
    [
      'Invoice number',
      'Member ID',
      'Name',
      'Phone',
      'Plan',
      'Invoice source',
      'Revenue categories',
      'Service / billing start',
      'Service / billing end',
      'Issued on',
      'Lifecycle',
      'Payment status',
      'Invoice total',
      'Invoice adjustments',
      'Net invoice total',
      'Gross collected',
      'Processed refunds',
      'Net collected',
      'Credit applied',
      'Accounting balance',
      'Collectible balance',
      'Refund review',
      'Gateway payment IDs',
      'Gateway refund IDs',
      'Refund dispositions',
      'Collection mode',
    ],
    ...rows.map((row) => [
      row.reference,
      row.membership?.member_number ?? '',
      row.contact?.name ?? 'Deleted customer',
      row.contact?.phone ?? '',
      row.membership?.plan?.name ?? '',
      row.source ?? '',
      (row.lineKinds ?? []).join(' + '),
      row.period_start,
      row.period_end,
      row.created_at,
      row.lifecycle,
      row.paymentState,
      Number(row.fee_amount),
      Number(row.invoice_adjustment_amount ?? 0),
      moneyDifference(
        Number(row.fee_amount),
        Number(row.invoice_adjustment_amount ?? 0)
      ),
      Number(row.gross_amount_paid ?? row.amount_paid),
      Number(row.processed_refund_amount ?? 0),
      Number(row.amount_paid),
      Number(row.credit_applied ?? 0),
      Number(row.accounting_balance ?? row.balance),
      Number(row.collectible_balance ?? row.balance),
      row.requires_refund_review ? 'Yes' : 'No',
      (row.gatewayPaymentIds ?? []).join(' + '),
      (row.gatewayRefundIds ?? []).join(' + '),
      (row.refundDispositions ?? []).join(' + '),
      row.membership?.collection_mode ?? 'manual',
    ]),
  ];
  return `\uFEFF${lines
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\r\n')}\r\n`;
}
