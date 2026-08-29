'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  FileText,
  ReceiptText,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';

import { MetricCard } from '@/components/dashboard/metric-card';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton';
import { FinanceInvoiceFilters } from '@/components/finance/finance-invoice-filters';
import { FinanceMonthActions } from '@/components/finance/finance-month-actions';
import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import { MemberIdentity } from '@/components/members/member-identity';
import { FinanceInvoiceStatusBadge } from '@/components/members/membership-status-badge';
import {
  InvoiceDetailDialog,
  InvoiceRecordPaymentAction,
} from '@/components/finance/invoice-detail-dialog';
import { RecordInvoicePaymentDialog } from '@/components/finance/record-invoice-payment-dialog';
import { VoidInvoicePaymentDialog } from '@/components/finance/void-invoice-payment-dialog';
import { ColumnHeader } from '@/components/table/column-header';
import { TableSkeleton } from '@/components/table/table-skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canCorrectPayments, canRecordPayments } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import {
  EMPTY_FINANCE_INVOICE_FILTERS,
  FINANCE_INVOICE_PAGE_SIZE,
  financeInvoicesCsv,
  invoiceSourceLabel,
  loadFinanceInvoiceExportRows,
  loadFinanceInvoices,
  type FinanceInvoiceFilterState,
  type FinanceInvoicePage,
  type FinanceInvoiceQueue,
  type FinanceInvoiceRow,
  type FinanceInvoiceSortKey,
} from '@/lib/finance/invoices';
import { isChargeableAmount } from '@/lib/memberships/periods';
import { createClient } from '@/lib/supabase/client';
import type { Payment } from '@/types';

const SORT_COLUMNS: {
  key: FinanceInvoiceSortKey;
  label: string;
}[] = [
  { key: 'issued_on', label: 'Issued on' },
  { key: 'period', label: 'Billing period' },
  { key: 'name', label: 'Name' },
  { key: 'member_id', label: 'Member ID' },
  { key: 'plan', label: 'Membership' },
  { key: 'total', label: 'Total' },
  { key: 'paid', label: 'Paid' },
  { key: 'balance', label: 'Balance' },
  { key: 'reference', label: 'Invoice' },
];

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

export function FinanceInvoiceListRecordAction({
  invoice,
  canRecord,
  canResolveRefundReview,
  onRecord,
  onOpenRefundReview,
  compact = false,
}: {
  invoice: FinanceInvoiceRow;
  canRecord: boolean;
  canResolveRefundReview: boolean;
  onRecord: (invoice: FinanceInvoiceRow) => void;
  onOpenRefundReview: (invoice: FinanceInvoiceRow) => void;
  compact?: boolean;
}) {
  return (
    <InvoiceRecordPaymentAction
      invoice={invoice}
      canRecord={canRecord}
      canResolveRefundReview={canResolveRefundReview}
      onRecord={() => onRecord(invoice)}
      onResolveRefundReview={() => onOpenRefundReview(invoice)}
      variant={compact ? 'ghost' : 'default'}
      size="sm"
      compact={compact}
    />
  );
}

export function FinanceInvoices({
  reloadKey,
  month,
  onMonthChange,
}: {
  reloadKey: number;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { accountRole } = useAuth();
  const { fmt, locale } = useLocale();
  const mayRecordPayments = accountRole
    ? canRecordPayments(accountRole)
    : false;
  const mayCorrectPayments = accountRole
    ? canCorrectPayments(accountRole)
    : false;
  const [snapshot, setSnapshot] = useState<FinanceInvoicePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [localReloadKey, setLocalReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const [queue, setQueue] = useState<FinanceInvoiceQueue>('all');
  const [filters, setFilters] = useState<FinanceInvoiceFilterState>(
    EMPTY_FINANCE_INVOICE_FILTERS
  );
  const [sort, setSort] = useState<SortState>({
    key: 'issued_on',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] =
    useState<FinanceInvoiceRow | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<FinanceInvoiceRow | null>(
    null
  );
  const [paymentToVoid, setPaymentToVoid] = useState<Payment | null>(null);
  const [refundReviewFocusInvoiceId, setRefundReviewFocusInvoiceId] = useState<
    string | null
  >(null);
  const [exporting, setExporting] = useState(false);
  const today = fmt.today();

  const querySignature = JSON.stringify({
    search: debouncedSearch,
    queue,
    filters,
    sort,
  });
  const [previousQuerySignature, setPreviousQuerySignature] =
    useState(querySignature);
  if (querySignature !== previousQuerySignature) {
    setPreviousQuerySignature(querySignature);
    setPage(1);
  }

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadFinanceInvoices(
          createClient(),
          {
            month,
            timeZone: locale.timeZone,
            today,
            search: debouncedSearch,
            queue,
            filters,
            sort: {
              key: sort.key as FinanceInvoiceSortKey,
              dir: sort.dir,
            },
            page,
            pageSize: FINANCE_INVOICE_PAGE_SIZE,
          },
          controller.signal
        );
        if (cancelled) return;
        setSnapshot(result);
      } catch (reason) {
        if (cancelled || controller.signal.aborted) return;
        setError(getErrorMessage(reason, 'Invoices could not be loaded'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    debouncedSearch,
    filters,
    locale.timeZone,
    localReloadKey,
    month,
    page,
    queue,
    reloadKey,
    retryKey,
    sort,
    today,
  ]);

  const rows = snapshot?.rows ?? [];
  const totalCount = snapshot?.totalCount ?? 0;
  const summary = snapshot?.summary ?? {
    count: 0,
    grossInvoiced: 0,
    adjustments: 0,
    invoiced: 0,
    grossCollected: 0,
    refunds: 0,
    collected: 0,
    outstanding: 0,
    overdue: 0,
  };
  const queueCounts = snapshot?.queueCounts ?? {
    all: 0,
    attention: 0,
    paid: 0,
    upcoming: 0,
    void: 0,
  };
  const planOptions = snapshot?.planOptions ?? [];
  const pageCount = Math.max(
    1,
    Math.ceil(totalCount / FINANCE_INVOICE_PAGE_SIZE)
  );
  const currentPage = snapshot?.page ?? page;
  const pageRows = rows;
  const rangeStart =
    totalCount === 0 ? 0 : (currentPage - 1) * FINANCE_INVOICE_PAGE_SIZE + 1;
  const rangeEnd = Math.min(
    currentPage * FINANCE_INVOICE_PAGE_SIZE,
    totalCount
  );
  const hasQuery =
    Boolean(search.trim()) ||
    queue !== 'all' ||
    filters.paymentStates.length > 0 ||
    filters.planIds.length > 0 ||
    filters.collectionModes.length > 0;

  function openInvoice(row: FinanceInvoiceRow) {
    setRefundReviewFocusInvoiceId(null);
    setSelectedInvoice(row);
    setInvoiceOpen(true);
  }

  function openRefundReview(row: FinanceInvoiceRow) {
    setRefundReviewFocusInvoiceId(row.id);
    setSelectedInvoice(row);
    setInvoiceOpen(true);
  }

  function recordInvoice(row: FinanceInvoiceRow) {
    setInvoiceOpen(false);
    setPaymentTarget(row);
  }

  async function exportInvoices() {
    if (totalCount === 0) return;
    setExporting(true);
    try {
      const exportRows = await loadFinanceInvoiceExportRows(createClient(), {
        month,
        timeZone: locale.timeZone,
        today,
        search: debouncedSearch,
        queue,
        filters,
        sort: {
          key: sort.key as FinanceInvoiceSortKey,
          dir: sort.dir,
        },
      });
      const blob = new Blob([financeInvoicesCsv(exportRows, fmt.phone)], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `finance-invoices-${month}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      toast.error(getErrorMessage(reason, 'Invoices could not be exported'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <FinanceMonthActions
        month={month}
        onMonthChange={onMonthChange}
        onExport={exportInvoices}
        exportDisabled={loading || totalCount === 0}
        exporting={exporting}
      />

      {error ? (
        <Alert variant="destructive">
          <RefreshCw />
          <AlertTitle>Could not load invoices</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button
            type="button"
            size="sm"
            variant="destructive-ghost"
            className="mt-2 w-fit"
            onClick={() => setRetryKey((key) => key + 1)}
          >
            <RefreshCw /> Retry
          </Button>
        </Alert>
      ) : null}

      {loading ? (
        <FinanceInvoicesSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Outstanding"
              value={fmt.money(summary.outstanding)}
              icon={Wallet}
              subtitle={`${fmt.number(summary.count)} ${summary.count === 1 ? 'invoice' : 'invoices'} in this view`}
            />
            <MetricCard
              title="Overdue"
              value={fmt.number(summary.overdue)}
              icon={AlertTriangle}
              subtitle="Need collection follow-up"
            />
            <MetricCard
              title="Net collected"
              value={fmt.money(summary.collected)}
              icon={CircleCheck}
              subtitle={`${fmt.money(summary.grossCollected)} gross − ${fmt.money(summary.refunds)} refunds`}
            />
            <MetricCard
              title="Net invoiced"
              value={fmt.money(summary.invoiced)}
              icon={ReceiptText}
              subtitle={`${fmt.money(summary.grossInvoiced)} gross − ${fmt.money(summary.adjustments)} adjustments`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search invoices"
              aria-label="Search invoices"
            />
            <FinanceInvoiceFilters
              value={filters}
              onChange={setFilters}
              plans={planOptions}
            />
            <LeadsSort
              value={sort}
              onChange={(next) =>
                setSort(next ?? { key: 'issued_on', dir: 'desc' })
              }
              columns={SORT_COLUMNS}
            />
            <Separator orientation="vertical" className="h-5" />
            <ChipGroup
              selectionMode="single"
              value={[queue]}
              onValueChange={(values) => {
                const next = values[0] as FinanceInvoiceQueue | undefined;
                if (next) setQueue(next);
              }}
            >
              {(
                [
                  ['all', 'All'],
                  ['attention', 'Needs attention'],
                  ['paid', 'Paid'],
                  ['upcoming', 'Upcoming'],
                  ['void', 'Void'],
                ] as const
              ).map(([value, label]) => (
                <Chip key={value} value={value}>
                  {label}
                  <ChipCount count={queueCounts[value]} />
                </Chip>
              ))}
            </ChipGroup>
          </div>

          <section className="border-border overflow-hidden rounded-lg border">
            {pageRows.length === 0 ? (
              <EmptyState
                icon={FileText}
                className="min-h-80"
                title={
                  hasQuery
                    ? 'No invoices match these filters'
                    : 'No invoices were issued in this month'
                }
                hint={
                  hasQuery
                    ? 'Clear a filter or search term to see more invoice records.'
                    : 'A new membership, renewal, service, or merchandise checkout will appear here.'
                }
              />
            ) : (
              <>
                <div className="space-y-2 p-2 lg:hidden">
                  {pageRows.map((row) => {
                    const contact = row.contact ?? row.membership?.contact;
                    return (
                      <Card
                        key={row.id}
                        size="sm"
                        className="hover:ring-border-hover cursor-pointer transition-[box-shadow]"
                        onClick={() => openInvoice(row)}
                      >
                        <CardContent className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium tabular-nums">
                                {row.reference}
                              </p>
                              <p className="text-muted-foreground mt-0.5 text-xs">
                                {row.source
                                  ? invoiceSourceLabel(row.source)
                                  : 'Invoice'}{' '}
                                · {fmt.date(row.created_at)}
                              </p>
                            </div>
                            <FinanceInvoiceStatusBadge
                              state={row.state}
                              paymentState={row.paymentState}
                              lifecycle={row.lifecycle}
                              overdue={row.overdue}
                              requiresRefundReview={row.requires_refund_review}
                            />
                          </div>

                          <MemberIdentity
                            name={contact?.name}
                            secondary={contact?.phone}
                            src={contact?.avatar_url}
                            meta={
                              row.membership?.member_number ? (
                                <p className="text-muted-foreground mt-0.5 font-mono text-xs tabular-nums">
                                  Member ID {row.membership.member_number}
                                </p>
                              ) : null
                            }
                          />

                          <div className="border-border grid grid-cols-2 gap-3 border-t pt-3">
                            <div className="min-w-0">
                              <p className="text-muted-foreground text-xs">
                                For
                              </p>
                              <p className="truncate font-medium">
                                {row.membership?.plan?.name ??
                                  (row.source
                                    ? invoiceSourceLabel(row.source)
                                    : 'Invoice')}
                              </p>
                              {row.period_start !== row.period_end ? (
                                <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                                  {fmt.date(row.period_start)} –{' '}
                                  {fmt.date(row.period_end)}
                                </p>
                              ) : null}
                            </div>
                            <div className="text-right">
                              <p className="text-muted-foreground text-xs">
                                Balance due
                              </p>
                              <p className="font-semibold tabular-nums">
                                {fmt.money(row.balance)}
                              </p>
                              <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                                Total {fmt.money(row.fee_amount)}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                        <CardFooter
                          className="justify-between gap-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            onClick={() => openInvoice(row)}
                          >
                            View details
                          </Button>
                          <FinanceInvoiceListRecordAction
                            invoice={row}
                            canRecord={mayRecordPayments}
                            canResolveRefundReview={mayCorrectPayments}
                            onRecord={recordInvoice}
                            onOpenRefundReview={openRefundReview}
                          />
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>

                <div className="hidden lg:block">
                  <Table className="table-fixed">
                    <TableCaption className="sr-only">
                      Account-wide invoices
                    </TableCaption>
                    <colgroup>
                      <col className="w-36" />
                      <col className="w-56" />
                      <col className="hidden w-56 xl:table-column" />
                      <col className="w-40" />
                      <col className="w-32" />
                      <col className="w-32" />
                      <col className="w-44" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <InvoiceHeader
                          label="Invoice"
                          sortKey="reference"
                          sort={sort}
                          onSort={setSort}
                        />
                        <InvoiceHeader
                          label="Customer"
                          sortKey="name"
                          sort={sort}
                          onSort={setSort}
                        />
                        <InvoiceHeader
                          label="For"
                          sortKey="plan"
                          sort={sort}
                          onSort={setSort}
                          className="hidden xl:table-cell"
                        />
                        <TableHead>Status</TableHead>
                        <InvoiceHeader
                          label="Total"
                          sortKey="total"
                          sort={sort}
                          onSort={setSort}
                          align="right"
                        />
                        <InvoiceHeader
                          label="Balance"
                          sortKey="balance"
                          sort={sort}
                          onSort={setSort}
                          align="right"
                        />
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.map((row) => {
                        const contact = row.contact ?? row.membership?.contact;
                        return (
                          <TableRow
                            key={row.id}
                            className="cursor-pointer"
                            onClick={() => openInvoice(row)}
                          >
                            <TableCell>
                              <div className="min-w-0">
                                <span className="font-medium tabular-nums">
                                  {row.reference}
                                </span>
                                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                                  {row.source
                                    ? invoiceSourceLabel(row.source)
                                    : 'Invoice'}{' '}
                                  · {fmt.date(row.created_at)}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <MemberIdentity
                                name={contact?.name}
                                secondary={contact?.phone}
                                src={contact?.avatar_url}
                                meta={
                                  row.membership?.member_number ? (
                                    <p className="text-muted-foreground mt-0.5 font-mono text-xs tabular-nums">
                                      Member ID {row.membership.member_number}
                                    </p>
                                  ) : null
                                }
                              />
                            </TableCell>
                            <TableCell className="hidden xl:table-cell">
                              <div className="min-w-0">
                                <p className="truncate font-medium">
                                  {row.membership?.plan?.name ??
                                    (row.source
                                      ? invoiceSourceLabel(row.source)
                                      : 'Invoice')}
                                </p>
                                {row.period_start !== row.period_end ? (
                                  <p className="text-muted-foreground text-xs tabular-nums">
                                    {fmt.date(row.period_start)} –{' '}
                                    {fmt.date(row.period_end)}
                                  </p>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="grid justify-items-start gap-1.5">
                                <FinanceInvoiceStatusBadge
                                  state={row.state}
                                  paymentState={row.paymentState}
                                  lifecycle={row.lifecycle}
                                  overdue={row.overdue}
                                  requiresRefundReview={
                                    row.requires_refund_review
                                  }
                                />
                                <p className="text-muted-foreground text-xs tabular-nums">
                                  {row.requires_refund_review
                                    ? 'Collection paused'
                                    : row.lifecycle === 'upcoming'
                                      ? `Starts ${fmt.date(row.period_start)}`
                                      : row.overdue
                                        ? `Since ${fmt.date(row.period_end)}`
                                        : row.paymentState === 'due'
                                          ? `By ${fmt.date(row.period_end)}`
                                          : row.paymentState === 'paid'
                                            ? 'Settled'
                                            : 'Nothing to collect'}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {fmt.money(row.fee_amount)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium tabular-nums ${
                                isChargeableAmount(row.balance)
                                  ? 'text-amber-foreground'
                                  : ''
                              }`}
                            >
                              {fmt.money(row.balance)}
                            </TableCell>
                            <TableCell
                              className="text-right"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openInvoice(row)}
                                >
                                  View
                                </Button>
                                <FinanceInvoiceListRecordAction
                                  invoice={row}
                                  canRecord={mayRecordPayments}
                                  canResolveRefundReview={mayCorrectPayments}
                                  onRecord={recordInvoice}
                                  onOpenRefundReview={openRefundReview}
                                  compact
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {totalCount > 0 ? (
              <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
                <p className="text-muted-foreground text-xs tabular-nums">
                  Showing {rangeStart}–{rangeEnd} of {totalCount} invoices
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentPage === pageCount}
                    onClick={() =>
                      setPage(Math.min(pageCount, currentPage + 1))
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </>
      )}

      <InvoiceDetailDialog
        open={invoiceOpen}
        onOpenChange={(nextOpen) => {
          setInvoiceOpen(nextOpen);
          if (!nextOpen) setRefundReviewFocusInvoiceId(null);
        }}
        invoice={selectedInvoice}
        canRecord={mayRecordPayments}
        canVoid={mayCorrectPayments}
        onVoidPayment={setPaymentToVoid}
        focusRefundReview={selectedInvoice?.id === refundReviewFocusInvoiceId}
        onRefundReviewFocusConsumed={() =>
          setRefundReviewFocusInvoiceId((current) =>
            current === selectedInvoice?.id ? null : current
          )
        }
        onRecord={() => {
          if (selectedInvoice) recordInvoice(selectedInvoice);
        }}
      />

      {paymentTarget ? (
        <RecordInvoicePaymentDialog
          key={paymentTarget.id}
          invoice={paymentTarget}
          open
          onOpenChange={(open) => {
            if (!open) setPaymentTarget(null);
          }}
          onSaved={() => {
            setPaymentTarget(null);
            setLocalReloadKey((key) => key + 1);
          }}
        />
      ) : null}

      <VoidInvoicePaymentDialog
        key={paymentToVoid?.id ?? 'no-payment'}
        payment={paymentToVoid}
        open={!!paymentToVoid}
        onOpenChange={(open) => {
          if (!open) setPaymentToVoid(null);
        }}
        onVoided={() => {
          setPaymentToVoid(null);
          setLocalReloadKey((key) => key + 1);
        }}
      />
    </div>
  );
}

function InvoiceHeader({
  label,
  sortKey,
  sort,
  onSort,
  align,
  className,
}: {
  label: string;
  sortKey: FinanceInvoiceSortKey;
  sort: SortState;
  onSort: (sort: SortState) => void;
  align?: 'right';
  className?: string;
}) {
  return (
    <TableHead
      className={[align === 'right' ? 'text-right' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <ColumnHeader
        label={label}
        sortable
        sortDir={sort.key === sortKey ? sort.dir : null}
        onSort={(dir) => onSort({ key: sortKey, dir })}
      />
    </TableHead>
  );
}

function FinanceInvoicesSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
      <Skeleton className="h-8 w-full max-w-4xl" />
      <div className="border-border overflow-hidden rounded-lg border">
        <TableSkeleton
          className="table-fixed"
          label="Loading invoices"
          rows={8}
          columns={[
            { label: 'Invoice', variant: 'stacked' },
            { label: 'Name', variant: 'identity' },
            { label: 'Membership', variant: 'stacked' },
            { label: 'Status', variant: 'badge' },
            { label: 'Total' },
            { label: 'Balance' },
            {
              label: 'Actions',
              variant: 'actions',
              headClassName: 'text-right',
            },
          ]}
        />
      </div>
    </div>
  );
}
