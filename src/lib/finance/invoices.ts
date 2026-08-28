import type { Contact, Invoice, InvoiceLine, InvoiceLineKind } from '@/types';

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

export type FinanceInvoiceSort = {
  key: FinanceInvoiceSortKey;
  dir: 'asc' | 'desc';
};

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
    sort: FinanceInvoiceSort;
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

export const FINANCE_INVOICE_PAGE_SIZE = 25;
export const FINANCE_INVOICE_EXPORT_PAGE_SIZE = 200;

export interface FinanceInvoicePlanOption {
  id: string;
  name: string;
}

export type FinanceInvoiceQueueCounts = Record<FinanceInvoiceQueue, number>;

export interface FinanceInvoicePage {
  rows: FinanceInvoiceRow[];
  page: number;
  totalCount: number;
  queueCounts: FinanceInvoiceQueueCounts;
  planOptions: FinanceInvoicePlanOption[];
  summary: FinanceInvoiceSummary;
  snapshotToken: string | null;
}

export interface FinanceInvoiceQuery {
  month: string;
  timeZone: string;
  today: string;
  search: string;
  queue: FinanceInvoiceQueue;
  filters: FinanceInvoiceFilterState;
  sort: FinanceInvoiceSort;
  page: number;
  pageSize: number;
  mode?: 'listing' | 'export';
}

interface RpcResponse {
  data: unknown;
  error: { message?: string } | null;
}

interface AbortableRpcRequest extends PromiseLike<RpcResponse> {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResponse>;
}

export interface FinanceInvoiceRpcClient {
  rpc(name: string, args: Record<string, unknown>): AbortableRpcRequest;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeContact(value: unknown): Contact | null {
  const raw = record(value);
  if (!raw || typeof raw.id !== 'string') return null;
  return raw as unknown as Contact;
}

function normalizeMembership(value: unknown): Membership | null {
  const raw = record(value);
  if (!raw || typeof raw.id !== 'string') return null;
  const contact = normalizeContact(raw.contact);
  const plan = record(raw.plan);
  return {
    ...raw,
    member_number: finiteNumber(raw.member_number),
    fee_amount: finiteNumber(raw.fee_amount),
    contact: contact ?? undefined,
    plan: plan ? (plan as unknown as Membership['plan']) : undefined,
  } as unknown as Membership;
}

function normalizeFinanceInvoiceRow(value: unknown): FinanceInvoiceRow {
  const raw = record(value);
  if (
    !raw ||
    typeof raw.id !== 'string' ||
    typeof raw.reference !== 'string' ||
    typeof raw.period_start !== 'string' ||
    typeof raw.period_end !== 'string' ||
    typeof raw.created_at !== 'string'
  ) {
    throw new Error('Finance invoice ledger returned an invalid row');
  }
  return {
    ...(raw as unknown as FinanceInvoiceRow),
    invoice_id: raw.id,
    fee_amount: finiteNumber(raw.fee_amount),
    amount_paid: finiteNumber(raw.amount_paid),
    credit_applied: finiteNumber(raw.credit_applied),
    balance: finiteNumber(raw.balance),
    gross_amount_paid: finiteNumber(raw.gross_amount_paid),
    processed_refund_amount: finiteNumber(raw.processed_refund_amount),
    invoice_adjustment_amount: finiteNumber(raw.invoice_adjustment_amount),
    accounting_balance: finiteNumber(raw.accounting_balance),
    collectible_balance: finiteNumber(raw.collectible_balance),
    requires_refund_review: Boolean(raw.requires_refund_review),
    overdue: Boolean(raw.overdue),
    membership: normalizeMembership(raw.membership),
    contact: normalizeContact(raw.contact),
    lineKinds: strings(raw.lineKinds) as InvoiceLineKind[],
    gatewayPaymentIds: strings(raw.gatewayPaymentIds),
    gatewayRefundIds: strings(raw.gatewayRefundIds),
    refundDispositions: strings(raw.refundDispositions),
  };
}

export function buildFinanceInvoiceRpcArgs(
  query: FinanceInvoiceQuery
): Record<string, unknown> {
  const period = financeMonthRange(query.month);
  return {
    p_month_start: period.start,
    p_time_zone: query.timeZone,
    p_today: query.today,
    p_search: query.search.trim() || null,
    p_queue: query.queue,
    p_payment_states: query.filters.paymentStates,
    p_plan_ids: query.filters.planIds,
    p_collection_modes: query.filters.collectionModes,
    p_sort_key: query.sort.key,
    p_sort_direction: query.sort.dir,
    p_page: Math.max(0, query.page - 1),
    p_page_size: query.pageSize,
    p_mode: query.mode ?? 'listing',
  };
}

export function normalizeFinanceInvoicePage(
  value: unknown
): FinanceInvoicePage {
  const raw = record(value);
  const queue = record(raw?.queueCounts);
  const summary = record(raw?.summary);
  if (!raw || !queue || !summary || !Array.isArray(raw.rows)) {
    throw new Error('Finance invoice ledger returned an invalid response');
  }
  const page = finiteNumber(raw.page, -1);
  const totalCount = finiteNumber(raw.totalCount, -1);
  if (!Number.isInteger(page) || page < 0 || totalCount < 0) {
    throw new Error('Finance invoice ledger returned invalid pagination');
  }
  return {
    rows: raw.rows.map(normalizeFinanceInvoiceRow),
    page: page + 1,
    totalCount,
    queueCounts: {
      all: finiteNumber(queue.all),
      attention: finiteNumber(queue.attention),
      paid: finiteNumber(queue.paid),
      upcoming: finiteNumber(queue.upcoming),
      void: finiteNumber(queue.void),
    },
    planOptions: Array.isArray(raw.planOptions)
      ? raw.planOptions.flatMap((value) => {
          const option = record(value);
          return option &&
            typeof option.id === 'string' &&
            typeof option.name === 'string'
            ? [{ id: option.id, name: option.name }]
            : [];
        })
      : [],
    summary: {
      count: finiteNumber(summary.count),
      grossInvoiced: finiteNumber(summary.grossInvoiced),
      adjustments: finiteNumber(summary.adjustments),
      invoiced: finiteNumber(summary.invoiced),
      grossCollected: finiteNumber(summary.grossCollected),
      refunds: finiteNumber(summary.refunds),
      collected: finiteNumber(summary.collected),
      outstanding: finiteNumber(summary.outstanding),
      overdue: finiteNumber(summary.overdue),
    },
    snapshotToken:
      typeof raw.snapshotToken === 'string' ? raw.snapshotToken : null,
  };
}

export async function loadFinanceInvoices(
  db: FinanceInvoiceRpcClient,
  query: FinanceInvoiceQuery,
  signal?: AbortSignal
): Promise<FinanceInvoicePage> {
  const request = db.rpc(
    'finance_invoice_ledger_page',
    buildFinanceInvoiceRpcArgs(query)
  );
  const { data, error } = signal
    ? await request.abortSignal(signal)
    : await request;
  if (error) throw new Error(error.message || 'Failed to load invoices');
  return normalizeFinanceInvoicePage(data);
}

export async function loadFinanceInvoiceExportRows(
  db: FinanceInvoiceRpcClient,
  query: Omit<FinanceInvoiceQuery, 'mode' | 'page' | 'pageSize'>,
  pageSize = FINANCE_INVOICE_EXPORT_PAGE_SIZE
): Promise<FinanceInvoiceRow[]> {
  const first = await loadFinanceInvoices(db, {
    ...query,
    mode: 'export',
    page: 1,
    pageSize,
  });
  const token = first.snapshotToken;
  if (!token) throw new Error('Invoice export snapshot could not be verified');

  const rows = [...first.rows];
  const pageCount = Math.ceil(first.totalCount / pageSize);
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await loadFinanceInvoices(db, {
      ...query,
      mode: 'export',
      page,
      pageSize,
    });
    if (
      next.page !== page ||
      next.totalCount !== first.totalCount ||
      next.snapshotToken !== token
    ) {
      throw new Error('Invoices changed during export. Try again.');
    }
    rows.push(...next.rows);
  }

  if (
    rows.length !== first.totalCount ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new Error('Invoice export was incomplete. Try again.');
  }
  return rows;
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
