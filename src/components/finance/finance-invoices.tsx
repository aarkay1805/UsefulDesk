'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CircleCheck,
  Eye,
  FileText,
  IndianRupee,
  ReceiptText,
  RefreshCw,
  Wallet,
} from 'lucide-react';

import { MetricCard } from '@/components/dashboard/metric-card';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton';
import { FinanceInvoiceFilters } from '@/components/finance/finance-invoice-filters';
import { FinanceMonthActions } from '@/components/finance/finance-month-actions';
import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import { InvoiceDetailDialog } from '@/components/members/invoice-detail-dialog';
import { MemberIdentity } from '@/components/members/member-identity';
import { RecordPaymentDialog } from '@/components/members/record-payment-dialog';
import { ColumnHeader } from '@/components/table/column-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { GatedButton } from '@/components/ui/gated-button';
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
import { canRecordPayments } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import {
  EMPTY_FINANCE_INVOICE_FILTERS,
  filterFinanceInvoices,
  financeInvoicesCsv,
  financeInvoiceSummary,
  loadFinanceInvoices,
  type FinanceInvoiceFilterState,
  type FinanceInvoiceLifecycle,
  type FinanceInvoiceRow,
  type FinanceInvoiceSortKey,
} from '@/lib/finance/invoices';
import { isChargeableAmount } from '@/lib/memberships/periods';
import { createClient } from '@/lib/supabase/client';

const PAGE_SIZE = 25;

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

type LifecycleChoice = 'all' | FinanceInvoiceLifecycle;

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
  const [rows, setRows] = useState<FinanceInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [localReloadKey, setLocalReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [lifecycle, setLifecycle] = useState<LifecycleChoice>('all');
  const [filters, setFilters] = useState<FinanceInvoiceFilterState>(
    EMPTY_FINANCE_INVOICE_FILTERS
  );
  const [sort, setSort] = useState<SortState>({
    key: 'issued_on',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    null
  );
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentTargetId, setPaymentTargetId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadFinanceInvoices(
          createClient(),
          month,
          locale.timeZone,
          fmt.today()
        );
        if (cancelled) return;
        setRows(result);
      } catch (reason) {
        if (cancelled) return;
        setError(getErrorMessage(reason, 'Invoices could not be loaded'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fmt, locale.timeZone, localReloadKey, month, reloadKey, retryKey]);

  const querySignature = JSON.stringify({ search, lifecycle, filters, sort });
  const [previousQuerySignature, setPreviousQuerySignature] =
    useState(querySignature);
  if (querySignature !== previousQuerySignature) {
    setPreviousQuerySignature(querySignature);
    setPage(1);
  }

  const filteredRows = useMemo(
    () =>
      filterFinanceInvoices(rows, {
        search,
        lifecycle,
        filters,
        sort: {
          key: sort.key as FinanceInvoiceSortKey,
          dir: sort.dir,
        },
      }),
    [filters, lifecycle, rows, search, sort]
  );
  const summary = useMemo(
    () => financeInvoiceSummary(filteredRows),
    [filteredRows]
  );
  const lifecycleCounts = useMemo(() => {
    const available = filterFinanceInvoices(rows, {
      search,
      lifecycle: 'all',
      filters,
      sort: { key: 'issued_on', dir: 'desc' },
    });
    return available.reduce<Record<LifecycleChoice, number>>(
      (counts, row) => {
        counts.all += 1;
        counts[row.lifecycle] += 1;
        return counts;
      },
      { all: 0, current: 0, past: 0, upcoming: 0, void: 0 }
    );
  }, [filters, rows, search]);
  const planOptions = useMemo(() => {
    const plans = new Map<string, string>();
    for (const row of rows) {
      if (row.plan_id && row.membership?.plan?.name) {
        plans.set(row.plan_id, row.membership.plan.name);
      }
    }
    return [...plans]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const rangeStart =
    filteredRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredRows.length);
  const selectedInvoice =
    rows.find((row) => row.id === selectedInvoiceId) ?? null;
  const paymentTarget = rows.find((row) => row.id === paymentTargetId) ?? null;
  const hasQuery =
    Boolean(search.trim()) ||
    lifecycle !== 'all' ||
    filters.paymentStates.length > 0 ||
    filters.planIds.length > 0 ||
    filters.collectionModes.length > 0;

  function openInvoice(row: FinanceInvoiceRow) {
    setSelectedInvoiceId(row.id);
    setInvoiceOpen(true);
  }

  function recordInvoice(row: FinanceInvoiceRow) {
    setInvoiceOpen(false);
    setPaymentTargetId(row.id);
  }

  function exportInvoices() {
    if (filteredRows.length === 0) return;
    setExporting(true);
    try {
      const blob = new Blob([financeInvoicesCsv(filteredRows)], {
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
        exportDisabled={loading || filteredRows.length === 0}
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
              title="Invoices"
              value={fmt.number(summary.count)}
              icon={FileText}
              subtitle="Issued records in this view"
            />
            <MetricCard
              title="Invoiced"
              value={fmt.money(summary.invoiced)}
              icon={ReceiptText}
              subtitle="Void invoices excluded"
            />
            <MetricCard
              title="Collected"
              value={fmt.money(summary.collected)}
              icon={CircleCheck}
              subtitle="Reconciled payment total"
            />
            <MetricCard
              title="Outstanding"
              value={fmt.money(summary.outstanding)}
              icon={IndianRupee}
              subtitle={`${fmt.number(summary.overdue)} overdue ${
                summary.overdue === 1 ? 'invoice' : 'invoices'
              }`}
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
              value={[lifecycle]}
              onValueChange={(values) => {
                const next = values[0] as LifecycleChoice | undefined;
                if (next) setLifecycle(next);
              }}
            >
              {(
                [
                  ['all', 'All'],
                  ['current', 'Current'],
                  ['past', 'Past'],
                  ['upcoming', 'Upcoming'],
                  ['void', 'Void'],
                ] as const
              ).map(([value, label]) => (
                <Chip key={value} value={value}>
                  {label}
                  <ChipCount count={lifecycleCounts[value]} />
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
                    : 'A persisted billing cycle will appear here when a membership is created or renewed.'
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[1120px] table-fixed">
                  <TableCaption className="sr-only">
                    Account-wide invoices
                  </TableCaption>
                  <colgroup>
                    <col className="w-32" />
                    <col className="w-52" />
                    <col className="w-32" />
                    <col className="w-56" />
                    <col className="w-36" />
                    <col className="w-32" />
                    <col className="w-32" />
                    <col className="w-32" />
                    <col className="w-52" />
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
                        label="Name"
                        sortKey="name"
                        sort={sort}
                        onSort={setSort}
                      />
                      <InvoiceHeader
                        label="Member ID"
                        sortKey="member_id"
                        sort={sort}
                        onSort={setSort}
                      />
                      <InvoiceHeader
                        label="Membership"
                        sortKey="plan"
                        sort={sort}
                        onSort={setSort}
                      />
                      <InvoiceHeader
                        label="Issued on"
                        sortKey="issued_on"
                        sort={sort}
                        onSort={setSort}
                      />
                      <InvoiceHeader
                        label="Total"
                        sortKey="total"
                        sort={sort}
                        onSort={setSort}
                        align="right"
                      />
                      <InvoiceHeader
                        label="Paid"
                        sortKey="paid"
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
                      const collectible =
                        row.membership &&
                        row.state === 'open' &&
                        isChargeableAmount(row.balance);
                      return (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer"
                          onClick={() => openInvoice(row)}
                        >
                          <TableCell>
                            <div className="grid justify-items-start gap-1.5">
                              <span
                                className="text-muted-foreground text-xs font-medium tabular-nums"
                                title="Internal billing record reference"
                              >
                                {row.reference}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <MemberIdentity
                              name={row.membership?.contact?.name}
                              secondary={row.membership?.contact?.phone}
                              src={row.membership?.contact?.avatar_url}
                            />
                          </TableCell>
                          <TableCell>
                            <span className="text-foreground font-mono text-sm tabular-nums">
                              {row.membership?.member_number ?? '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {row.membership?.plan?.name ?? '—'}
                              </p>
                              <p className="text-muted-foreground text-xs tabular-nums">
                                {fmt.date(row.period_start)} –{' '}
                                {fmt.date(row.period_end)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {fmt.date(row.created_at)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {fmt.money(row.fee_amount)}
                          </TableCell>
                          <TableCell className="text-emerald-foreground text-right tabular-nums">
                            {fmt.money(row.amount_paid)}
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
                                <Eye /> View
                              </Button>
                              {collectible ? (
                                <GatedButton
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  canAct={mayRecordPayments}
                                  gateReason="record payments"
                                  onClick={() => recordInvoice(row)}
                                >
                                  <Wallet /> Record
                                </GatedButton>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {filteredRows.length > 0 ? (
              <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
                <p className="text-muted-foreground text-xs tabular-nums">
                  Showing {rangeStart}–{rangeEnd} of {filteredRows.length}{' '}
                  invoices
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentPage === pageCount}
                    onClick={() =>
                      setPage((current) => Math.min(pageCount, current + 1))
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
        onOpenChange={setInvoiceOpen}
        invoice={selectedInvoice}
        canAct={mayRecordPayments}
        membershipEndDate={selectedInvoice?.membership?.end_date}
        onRecord={(invoice) => {
          const row = rows.find((candidate) => candidate.id === invoice.id);
          if (row) recordInvoice(row);
        }}
        onRenew={() => undefined}
      />

      {paymentTarget?.membership ? (
        <RecordPaymentDialog
          open
          onOpenChange={(open) => {
            if (!open) setPaymentTargetId(null);
          }}
          membership={paymentTarget.membership}
          period={{
            period_start: paymentTarget.period_start,
            period_end: paymentTarget.period_end,
            fee_amount: paymentTarget.fee_amount,
            balance: paymentTarget.balance,
          }}
          onSaved={() => {
            setPaymentTargetId(null);
            setLocalReloadKey((key) => key + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function InvoiceHeader({
  label,
  sortKey,
  sort,
  onSort,
  align,
}: {
  label: string;
  sortKey: FinanceInvoiceSortKey;
  sort: SortState;
  onSort: (sort: SortState) => void;
  align?: 'right';
}) {
  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
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
      <Skeleton className="h-[28rem] w-full" />
    </div>
  );
}
