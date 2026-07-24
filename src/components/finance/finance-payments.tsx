'use client';

import {
  CircleCheck,
  Eye,
  Receipt,
  RefreshCw,
  Repeat2,
  RotateCcw,
  WalletCards,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { EmptyState } from '@/components/dashboard/empty-state';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton';
import { FinanceMonthActions } from '@/components/finance/finance-month-actions';
import { FinancePaymentFilters } from '@/components/finance/finance-payment-filters';
import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import { MemberIdentity } from '@/components/members/member-identity';
import { PaymentStatusBadge } from '@/components/members/membership-status-badge';
import { PaymentProofLink } from '@/components/members/payment-proof-link';
import { useAccountStaff } from '@/components/members/use-account-staff';
import { ColumnHeader } from '@/components/table/column-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import {
  EMPTY_FINANCE_PAYMENT_FILTERS,
  financePaymentRecordedBy,
  financePaymentReference,
  financePaymentsCsv,
  loadAllFinancePayments,
  loadFinancePayments,
  normalizeFinancePaymentPage,
  type FinancePaymentFilterState,
  type FinancePaymentQuickView,
  type FinancePaymentRow,
  type FinancePaymentSortKey,
} from '@/lib/finance/payments';
import { financeMonthRange } from '@/lib/finance/overview';
import { createClient } from '@/lib/supabase/client';
import type { MembershipPlan, PaymentMethod } from '@/types';

const PAGE_SIZE = 25;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

const SORT_COLUMNS: {
  key: FinancePaymentSortKey;
  label: string;
}[] = [
  { key: 'paid_on', label: 'Paid on' },
  { key: 'name', label: 'Name' },
  { key: 'plan', label: 'Plan' },
  { key: 'method', label: 'Method' },
  { key: 'source', label: 'Source' },
  { key: 'amount', label: 'Amount' },
  { key: 'status', label: 'Status' },
  { key: 'recorded_by', label: 'Recorded by' },
  { key: 'payment', label: 'Payment' },
];

const QUICK_VIEWS: {
  value: FinancePaymentQuickView;
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'collected', label: 'Collected' },
  { value: 'autopay', label: 'Auto-pay' },
  { value: 'voided', label: 'Voided' },
];

export function FinancePayments({
  reloadKey,
  month,
  onMonthChange,
}: {
  reloadKey: number;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const router = useRouter();
  const { fmt, locale } = useLocale();
  const { staff } = useAccountStaff();
  const period = financeMonthRange(month);
  const [plans, setPlans] = useState<Pick<MembershipPlan, 'id' | 'name'>[]>([]);
  const [result, setResult] = useState(() => normalizeFinancePaymentPage(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const search = useDeferredValue(searchInput);
  const [quickView, setQuickView] = useState<FinancePaymentQuickView>('all');
  const [filters, setFilters] = useState<FinancePaymentFilterState>(
    EMPTY_FINANCE_PAYMENT_FILTERS
  );
  const [sort, setSort] = useState<SortState>({
    key: 'paid_on',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await createClient()
        .from('membership_plans')
        .select('id, name')
        .order('name', { ascending: true });
      if (!cancelled) {
        setPlans(
          ((data as Pick<MembershipPlan, 'id' | 'name'>[]) ?? []).map(
            (plan) => ({ id: plan.id, name: plan.name })
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const querySignature = JSON.stringify({
    search,
    quickView,
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
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await loadFinancePayments(createClient(), {
          month,
          timeZone: locale.timeZone,
          search,
          quickView,
          filters,
          sort: {
            key: sort.key as FinancePaymentSortKey,
            dir: sort.dir,
          },
          page,
          pageSize: PAGE_SIZE,
        });
        if (!cancelled) setResult(next);
      } catch (reason) {
        if (!cancelled) {
          setError(getErrorMessage(reason, 'Payments could not be loaded'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    filters,
    locale.timeZone,
    month,
    page,
    quickView,
    reloadKey,
    retryKey,
    search,
    sort,
  ]);

  const pageCount = Math.max(1, Math.ceil(result.summary.count / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rangeStart =
    result.summary.count === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, result.summary.count);
  const displayedRange = {
    start: filters.paidFrom || period.start,
    end: filters.paidTo || period.end,
  };
  const hasQuery =
    Boolean(search.trim()) ||
    quickView !== 'all' ||
    filters.methods.length > 0 ||
    filters.statuses.length > 0 ||
    filters.sources.length > 0 ||
    filters.planIds.length > 0 ||
    filters.recordedBy.length > 0 ||
    Boolean(filters.paidFrom) ||
    Boolean(filters.paidTo);
  const staffOptions = useMemo(
    () =>
      staff.map((member) => ({
        value: member.user_id,
        label: member.full_name,
      })),
    [staff]
  );

  function openMember(row: FinancePaymentRow) {
    if (!row.membership_id) return;
    const params = new URLSearchParams({
      view: 'all',
      member: row.membership_id,
    });
    router.push(`/members?${params.toString()}`);
  }

  async function exportPayments() {
    if (result.summary.count === 0) return;
    setExporting(true);
    try {
      const rows = await loadAllFinancePayments(createClient(), {
        month,
        timeZone: locale.timeZone,
        search,
        quickView,
        filters,
        sort: {
          key: sort.key as FinancePaymentSortKey,
          dir: sort.dir,
        },
      });
      const blob = new Blob([financePaymentsCsv(rows, fmt.dateTime)], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `finance-payments-${month}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      toast.error(getErrorMessage(reason, 'Payment export failed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <FinanceMonthActions
        month={month}
        onMonthChange={onMonthChange}
        onExport={() => void exportPayments()}
        exportDisabled={loading || result.summary.count === 0}
        exporting={exporting}
      />

      <p className="text-muted-foreground text-sm tabular-nums">
        Payments received {fmt.date(displayedRange.start)} –{' '}
        {fmt.date(displayedRange.end)}
      </p>

      {error ? (
        <Alert variant="destructive">
          <RefreshCw />
          <AlertTitle>Could not load payments</AlertTitle>
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
        <FinancePaymentsSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Collected"
              value={fmt.money(result.summary.collected)}
              icon={CircleCheck}
              subtitle={`${fmt.number(result.summary.collectedCount)} settled ${
                result.summary.collectedCount === 1 ? 'payment' : 'payments'
              }`}
            />
            <MetricCard
              title="Payments"
              value={fmt.number(result.summary.count)}
              icon={WalletCards}
              subtitle="Records in this filtered view"
            />
            <MetricCard
              title="Auto-pay"
              value={fmt.money(result.summary.autopay)}
              icon={Repeat2}
              subtitle="Successful gateway collections"
            />
            <MetricCard
              title="Voided"
              value={fmt.money(result.summary.voidedAmount)}
              icon={RotateCcw}
              subtitle={`${fmt.number(result.summary.voidedCount)} audit ${
                result.summary.voidedCount === 1 ? 'record' : 'records'
              }`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={searchInput}
              onValueChange={setSearchInput}
              placeholder="Search payments"
              aria-label="Search payments"
            />
            <FinancePaymentFilters
              value={filters}
              onChange={setFilters}
              plans={plans}
              staff={staffOptions}
              range={{ start: period.start, end: period.end }}
            />
            <LeadsSort
              value={sort}
              onChange={(next) =>
                setSort(next ?? { key: 'paid_on', dir: 'desc' })
              }
              columns={SORT_COLUMNS}
            />
            <Separator orientation="vertical" className="h-5" />
            <ChipGroup
              selectionMode="single"
              value={[quickView]}
              onValueChange={(values) => {
                const next = values[0] as FinancePaymentQuickView | undefined;
                if (next) setQuickView(next);
              }}
            >
              {QUICK_VIEWS.map((option) => (
                <Chip key={option.value} value={option.value}>
                  {option.label}
                  <ChipCount count={result.facets[option.value]} />
                </Chip>
              ))}
            </ChipGroup>
          </div>

          <section className="border-border overflow-hidden rounded-lg border">
            {result.rows.length === 0 ? (
              <EmptyState
                icon={Receipt}
                className="min-h-80"
                title={
                  hasQuery
                    ? 'No payments match these filters'
                    : 'No payments were received in this month'
                }
                hint={
                  hasQuery
                    ? 'Clear a filter or search term to see more ledger records.'
                    : 'Recorded and AutoPay collections will appear here without moving payment work out of Members.'
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[1430px] table-fixed">
                  <TableCaption className="sr-only">
                    Account-wide payment ledger
                  </TableCaption>
                  <colgroup>
                    <col className="w-36" />
                    <col className="w-56" />
                    <col className="w-40" />
                    <col className="w-44" />
                    <col className="w-28" />
                    <col className="w-28" />
                    <col className="w-32" />
                    <col className="w-28" />
                    <col className="w-40" />
                    <col className="w-28" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <PaymentHeader
                        label="Payment"
                        sortKey="payment"
                        sort={sort}
                        onSort={setSort}
                      />
                      <PaymentHeader
                        label="Name"
                        sortKey="name"
                        sort={sort}
                        onSort={setSort}
                      />
                      <PaymentHeader
                        label="Plan"
                        sortKey="plan"
                        sort={sort}
                        onSort={setSort}
                      />
                      <PaymentHeader
                        label="Paid on"
                        sortKey="paid_on"
                        sort={sort}
                        onSort={setSort}
                      />
                      <PaymentHeader
                        label="Method"
                        sortKey="method"
                        sort={sort}
                        onSort={setSort}
                      />
                      <PaymentHeader
                        label="Source"
                        sortKey="source"
                        sort={sort}
                        onSort={setSort}
                      />
                      <PaymentHeader
                        label="Amount"
                        sortKey="amount"
                        sort={sort}
                        onSort={setSort}
                        align="right"
                      />
                      <PaymentHeader
                        label="Status"
                        sortKey="status"
                        sort={sort}
                        onSort={setSort}
                      />
                      <PaymentHeader
                        label="Recorded by"
                        sortKey="recorded_by"
                        sort={sort}
                        onSort={setSort}
                      />
                      <TableHead className="text-right">Receipt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((row) => {
                      const canOpenMember = Boolean(row.membership_id);
                      return (
                        <TableRow
                          key={row.id}
                          className={
                            canOpenMember ? 'cursor-pointer' : undefined
                          }
                          onClick={() => openMember(row)}
                        >
                          <TableCell>
                            <div className="min-w-0">
                              <p className="font-mono text-sm font-medium">
                                {row.reference ||
                                  financePaymentReference(row.id)}
                              </p>
                              {row.gateway_payment_id ? (
                                <p className="text-muted-foreground truncate font-mono text-xs">
                                  {row.gateway_payment_id}
                                </p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <MemberIdentity
                              name={row.contact_name}
                              secondary={row.contact_phone}
                              src={row.contact_avatar_url}
                              meta={
                                row.member_number
                                  ? `Member ID ${row.member_number}`
                                  : undefined
                              }
                            />
                          </TableCell>
                          <TableCell className="text-muted-foreground truncate">
                            {row.plan_name ?? '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {fmt.dateTime(row.paid_at)}
                          </TableCell>
                          <TableCell>{METHOD_LABEL[row.method]}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                row.source === 'auto' ? 'info' : 'neutral'
                              }
                            >
                              {row.source === 'auto' ? 'Auto-pay' : 'Manual'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            <span
                              className={
                                row.status === 'void'
                                  ? 'line-through opacity-60'
                                  : undefined
                              }
                            >
                              {fmt.money(row.amount)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <PaymentStatusBadge
                              payment={row}
                              voidedOn={
                                row.voided_at ? fmt.date(row.voided_at) : null
                              }
                            />
                          </TableCell>
                          <TableCell className="text-muted-foreground truncate">
                            {financePaymentRecordedBy(row)}
                          </TableCell>
                          <TableCell
                            className="text-right"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              {canOpenMember ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Open member"
                                  title="Open member"
                                  onClick={() => openMember(row)}
                                >
                                  <Eye />
                                </Button>
                              ) : null}
                              <PaymentProofLink payment={row} />
                              {!canOpenMember &&
                              !row.screenshot_url &&
                              !row.screenshot_path ? (
                                <span className="text-muted-foreground">—</span>
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

            {result.summary.count > 0 ? (
              <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
                <p className="text-muted-foreground text-xs tabular-nums">
                  Showing {rangeStart}–{rangeEnd} of {result.summary.count}{' '}
                  payments
                </p>
                <PaginationControls
                  page={currentPage}
                  pageCount={pageCount}
                  onPrevious={() =>
                    setPage((current) => Math.max(1, current - 1))
                  }
                  onNext={() =>
                    setPage((current) => Math.min(pageCount, current + 1))
                  }
                />
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function PaymentHeader({
  label,
  sortKey,
  sort,
  onSort,
  align,
}: {
  label: string;
  sortKey: FinancePaymentSortKey;
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

function PaginationControls({
  page,
  pageCount,
  onPrevious,
  onNext,
}: {
  page: number;
  pageCount: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onPrevious}
        disabled={page === 1}
      >
        Previous
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={page === pageCount}
      >
        Next
      </Button>
    </div>
  );
}

function FinancePaymentsSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading payments">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-10 w-full max-w-4xl" />
      <Skeleton className="h-80 rounded-lg" />
    </div>
  );
}
