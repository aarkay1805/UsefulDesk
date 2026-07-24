'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  CircleDot,
  MoreHorizontal,
  Plus,
  ReceiptIndianRupee,
  ReceiptText,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Tags,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';

import { EmptyState } from '@/components/dashboard/empty-state';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton';
import { AddExpenseDialog } from '@/components/finance/add-expense-dialog';
import { ExpenseReceiptLink } from '@/components/finance/expense-receipt-link';
import { ExpenseStatusBadge } from '@/components/finance/expense-status-badge';
import { FinanceExpenseFilters } from '@/components/finance/finance-expense-filters';
import { FinanceMonthActions } from '@/components/finance/finance-month-actions';
import { VoidExpenseDialog } from '@/components/finance/void-expense-dialog';
import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import { useAccountStaff } from '@/components/members/use-account-staff';
import { ColumnHeader } from '@/components/table/column-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GatedButton } from '@/components/ui/gated-button';
import { Progress } from '@/components/ui/progress';
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
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canRecordExpenses, canVoidExpenses } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import {
  EMPTY_FINANCE_EXPENSE_FILTERS,
  financeExpenseDailyTrend,
  financeExpenseReference,
  financeExpensesCsv,
  loadAllFinanceExpenses,
  loadExpenseCategories,
  loadFinanceExpenses,
  normalizeFinanceExpensePage,
  type FinanceExpenseCategoryTotal,
  type FinanceExpenseFilterState,
  type FinanceExpenseQuickView,
  type FinanceExpenseRow,
  type FinanceExpenseSortKey,
  type FinanceExpenseTrendPoint,
} from '@/lib/finance/expenses';
import { financeMonthRange } from '@/lib/finance/overview';
import type { LocaleFormatters } from '@/lib/locale/format';
import { createClient } from '@/lib/supabase/client';
import type { ExpenseCategory, PaymentMethod } from '@/types';

const PAGE_SIZE = 25;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

const SORT_COLUMNS: { key: FinanceExpenseSortKey; label: string }[] = [
  { key: 'occurred_on', label: 'Date' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'method', label: 'Payment method' },
  { key: 'expense_kind', label: 'Expense type' },
  { key: 'amount', label: 'Amount' },
  { key: 'recorded_by', label: 'Recorded by' },
  { key: 'status', label: 'Status' },
  { key: 'expense', label: 'Expense' },
];

const QUICK_VIEWS: { value: FinanceExpenseQuickView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'one_time', label: 'One-time' },
];

const expenseChartInitialDimension = { width: 720, height: 256 };

export function FinanceExpenses({
  reloadKey,
  month,
  onMonthChange,
}: {
  reloadKey: number;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { accountRole } = useAuth();
  const { fmt } = useLocale();
  const { staff } = useAccountStaff();
  const mayRecord = accountRole ? canRecordExpenses(accountRole) : false;
  const mayVoid = accountRole ? canVoidExpenses(accountRole) : false;
  const period = financeMonthRange(month);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [result, setResult] = useState(() => normalizeFinanceExpensePage(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [localReloadKey, setLocalReloadKey] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const search = useDeferredValue(searchInput);
  const [quickView, setQuickView] = useState<FinanceExpenseQuickView>('all');
  const [filters, setFilters] = useState<FinanceExpenseFilterState>(
    EMPTY_FINANCE_EXPENSE_FILTERS
  );
  const [sort, setSort] = useState<SortState>({
    key: 'occurred_on',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<FinanceExpenseRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setCategoryError(null);
      try {
        const next = await loadExpenseCategories(createClient());
        if (!cancelled) setCategories(next);
      } catch (reason) {
        if (!cancelled) {
          setCategoryError(
            getErrorMessage(reason, 'Expense categories could not be loaded')
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localReloadKey, reloadKey, retryKey]);

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
        const next = await loadFinanceExpenses(createClient(), {
          month,
          search,
          quickView,
          filters,
          sort: {
            key: sort.key as FinanceExpenseSortKey,
            dir: sort.dir,
          },
          page,
          pageSize: PAGE_SIZE,
        });
        if (!cancelled) setResult(next);
      } catch (reason) {
        if (!cancelled) {
          setError(getErrorMessage(reason, 'Expenses could not be loaded'));
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
    localReloadKey,
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
  const hasQuery =
    Boolean(search.trim()) ||
    quickView !== 'all' ||
    filters.categoryIds.length > 0 ||
    filters.methods.length > 0 ||
    filters.statuses.length > 0 ||
    filters.recordedBy.length > 0 ||
    Boolean(filters.occurredFrom) ||
    Boolean(filters.occurredTo);
  const staffOptions = useMemo(
    () =>
      staff.map((member) => ({
        value: member.user_id,
        label: member.full_name,
      })),
    [staff]
  );
  const largestCategory = result.analysis.categoryTotals[0] ?? null;
  const recurringShare =
    result.summary.postedAmount > 0
      ? Math.round(
          (result.summary.recurringAmount / result.summary.postedAmount) * 100
        )
      : 0;
  const oneTimeShare =
    result.summary.postedAmount > 0
      ? Math.round(
          (result.summary.oneTimeAmount / result.summary.postedAmount) * 100
        )
      : 0;

  function refreshExpenses() {
    setLocalReloadKey((key) => key + 1);
  }

  async function exportExpenses() {
    if (result.summary.count === 0) return;
    setExporting(true);
    try {
      const rows = await loadAllFinanceExpenses(createClient(), {
        month,
        search,
        quickView,
        filters,
        sort: {
          key: sort.key as FinanceExpenseSortKey,
          dir: sort.dir,
        },
      });
      const blob = new Blob([financeExpensesCsv(rows, fmt.date)], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `finance-expenses-${month}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      toast.error(getErrorMessage(reason, 'Expense export failed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <FinanceMonthActions
        month={month}
        onMonthChange={onMonthChange}
        onExport={() => void exportExpenses()}
        exportDisabled={loading || result.summary.count === 0}
        exporting={exporting}
        primaryAction={
          <GatedButton
            canAct={mayRecord}
            gateReason="record expenses"
            title={
              categories.length === 0
                ? 'Expense categories are loading or unavailable'
                : undefined
            }
            onClick={() => setAddOpen(true)}
            disabled={categories.length === 0}
          >
            <Plus />
            Add expense
          </GatedButton>
        }
      />

      {error || categoryError ? (
        <Alert variant="destructive">
          <RefreshCw />
          <AlertTitle>Could not load expenses</AlertTitle>
          <AlertDescription>{error ?? categoryError}</AlertDescription>
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
        <FinanceExpensesSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Total expenses"
              value={fmt.money(result.summary.postedAmount)}
              icon={ReceiptIndianRupee}
              subtitle="Posted cash-out in this view"
            />
            <MetricCard
              title="Recurring"
              value={fmt.money(result.summary.recurringAmount)}
              icon={Repeat2}
              subtitle={`${fmt.number(result.summary.recurringCount)} ${
                result.summary.recurringCount === 1 ? 'record' : 'records'
              } · ${fmt.number(recurringShare)}% of spend`}
            />
            <MetricCard
              title="One-time"
              value={fmt.money(result.summary.oneTimeAmount)}
              icon={CircleDot}
              subtitle={`${fmt.number(result.summary.oneTimeCount)} ${
                result.summary.oneTimeCount === 1 ? 'record' : 'records'
              } · ${fmt.number(oneTimeShare)}% of spend`}
            />
            <MetricCard
              title="Largest category"
              value={largestCategory ? fmt.money(largestCategory.amount) : '—'}
              icon={Tags}
              subtitle={largestCategory?.categoryName ?? 'No posted spend'}
            />
          </div>

          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)]">
            <ExpenseTrendCard
              month={month}
              points={result.analysis.dailyTrend}
              fmt={fmt}
            />
            <ExpenseCategoryCard
              totals={result.analysis.categoryTotals}
              postedAmount={result.summary.postedAmount}
              fmt={fmt}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={searchInput}
              onValueChange={setSearchInput}
              placeholder="Search expenses"
              aria-label="Search expenses"
            />
            <FinanceExpenseFilters
              value={filters}
              onChange={setFilters}
              categories={categories}
              staff={staffOptions}
              range={{ start: period.start, end: period.end }}
            />
            <LeadsSort
              value={sort}
              onChange={(next) =>
                setSort(next ?? { key: 'occurred_on', dir: 'desc' })
              }
              columns={SORT_COLUMNS}
            />
            <Separator orientation="vertical" className="h-5" />
            <ChipGroup
              selectionMode="single"
              value={[quickView]}
              onValueChange={(values) => {
                const next = values[0] as FinanceExpenseQuickView | undefined;
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
                icon={ReceiptText}
                className="min-h-80"
                title={
                  hasQuery
                    ? 'No expenses match these filters'
                    : 'No expenses were recorded in this month'
                }
                hint={
                  hasQuery
                    ? 'Clear a filter or search term to see more ledger records.'
                    : 'Use Add expense to record the first auditable cash-out entry.'
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[1320px] table-fixed">
                  <TableCaption className="sr-only">
                    Account-wide expense ledger
                  </TableCaption>
                  <colgroup>
                    <col className="w-36" />
                    <col className="w-64" />
                    <col className="w-52" />
                    <col className="w-36" />
                    <col className="w-36" />
                    <col className="w-48" />
                    <col className="w-24" />
                    <col className="w-28" />
                    <col className="w-24" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <ExpenseHeader
                        label="Date"
                        sortKey="occurred_on"
                        sort={sort}
                        onSort={setSort}
                      />
                      <ExpenseHeader
                        label="Description"
                        sortKey="description"
                        sort={sort}
                        onSort={setSort}
                      />
                      <ExpenseHeader
                        label="Category"
                        sortKey="category"
                        sort={sort}
                        onSort={setSort}
                      />
                      <ExpenseHeader
                        label="Payment method"
                        sortKey="method"
                        sort={sort}
                        onSort={setSort}
                      />
                      <ExpenseHeader
                        label="Amount"
                        sortKey="amount"
                        sort={sort}
                        onSort={setSort}
                        align="right"
                      />
                      <ExpenseHeader
                        label="Recorded by"
                        sortKey="recorded_by"
                        sort={sort}
                        onSort={setSort}
                      />
                      <TableHead>Receipt</TableHead>
                      <ExpenseHeader
                        label="Status"
                        sortKey="status"
                        sort={sort}
                        onSort={setSort}
                      />
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {fmt.date(row.occurred_on)}
                        </TableCell>
                        <TableCell>
                          <p className="truncate font-medium">
                            {row.description}
                          </p>
                          <p className="text-muted-foreground font-mono text-xs">
                            {row.reference || financeExpenseReference(row.id)}
                          </p>
                        </TableCell>
                        <TableCell className="truncate">
                          {row.category_name}
                        </TableCell>
                        <TableCell>{METHOD_LABEL[row.method]}</TableCell>
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
                        <TableCell className="text-muted-foreground truncate">
                          {row.recorded_by_name?.trim() || 'Staff'}
                        </TableCell>
                        <TableCell>
                          {row.receipt_path ? (
                            <ExpenseReceiptLink expense={row} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ExpenseStatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Actions for ${row.description}`}
                                />
                              }
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={!mayVoid || row.status === 'void'}
                                title={
                                  !mayVoid
                                    ? "Read-only — your role can't void expenses"
                                    : undefined
                                }
                                onClick={() => setVoidTarget(row)}
                              >
                                <RotateCcw />
                                {row.status === 'void'
                                  ? 'Already voided'
                                  : 'Void expense'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {result.summary.count > 0 ? (
              <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
                <p className="text-muted-foreground text-xs tabular-nums">
                  Showing {rangeStart}–{rangeEnd} of {result.summary.count}{' '}
                  expenses
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((current) => Math.min(pageCount, current + 1))
                    }
                    disabled={currentPage === pageCount}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </>
      )}

      <AddExpenseDialog
        key={`add-expense-${addOpen ? 'open' : 'closed'}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        categories={categories}
        onSaved={refreshExpenses}
      />
      <VoidExpenseDialog
        key={`void-expense-${voidTarget?.id ?? 'closed'}`}
        expense={voidTarget}
        open={Boolean(voidTarget)}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
        onVoided={refreshExpenses}
      />
    </div>
  );
}

function ExpenseHeader({
  label,
  sortKey,
  sort,
  onSort,
  align,
}: {
  label: string;
  sortKey: FinanceExpenseSortKey;
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

type ExpenseTrendGrouping = 'daily' | 'weekly';

function weeklyExpenseTrend(
  data: FinanceExpenseTrendPoint[]
): FinanceExpenseTrendPoint[] {
  const result: FinanceExpenseTrendPoint[] = [];
  for (let index = 0; index < data.length; index += 7) {
    const days = data.slice(index, index + 7);
    result.push({
      date: days[0].date,
      amount: days.reduce((sum, day) => sum + day.amount, 0),
    });
  }
  return result;
}

const expenseChartTooltipStyle = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow:
    '0 10px 25px color-mix(in oklch, var(--foreground) 12%, transparent)',
  color: 'var(--popover-foreground)',
  fontSize: 12,
};

function ExpenseTrendCard({
  month,
  points,
  fmt,
}: {
  month: string;
  points: FinanceExpenseTrendPoint[];
  fmt: LocaleFormatters;
}) {
  const [grouping, setGrouping] = useState<ExpenseTrendGrouping>('daily');
  const daily = financeExpenseDailyTrend(month, points);
  const data = grouping === 'daily' ? daily : weeklyExpenseTrend(daily);
  const hasData = daily.some((point) => point.amount > 0);

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>Expense trend · {fmt.month(`${month}-01`)}</CardTitle>
        <CardAction>
          <Toolbar aria-label="Expense trend grouping">
            <ToolbarToggleGroup<ExpenseTrendGrouping>
              value={[grouping]}
              onValueChange={(values) => values[0] && setGrouping(values[0])}
            >
              <ToolbarToggleItem value="daily">Daily</ToolbarToggleItem>
              <ToolbarToggleItem value="weekly">Weekly</ToolbarToggleItem>
            </ToolbarToggleGroup>
          </Toolbar>
        </CardAction>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div
            className="h-64 w-full"
            role="group"
            aria-label={`${grouping === 'daily' ? 'Daily' : 'Weekly'} expense trend chart`}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={expenseChartInitialDimension}
            >
              <BarChart
                accessibilityLayer
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={18}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) =>
                    grouping === 'daily'
                      ? String(Number(String(value).slice(-2)))
                      : fmt.dateShort(String(value))
                  }
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) => fmt.moneyShort(Number(value))}
                />
                <Tooltip
                  contentStyle={expenseChartTooltipStyle}
                  labelFormatter={(value) =>
                    grouping === 'daily'
                      ? fmt.date(String(value))
                      : `Week of ${fmt.date(String(value))}`
                  }
                  formatter={(value) => [fmt.money(Number(value)), 'Expenses']}
                />
                <Bar
                  dataKey="amount"
                  name="expenses"
                  fill="var(--color-red-500)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            icon={ReceiptIndianRupee}
            className="h-64"
            title="No posted expense trend"
            hint="Posted expenses will appear here by day."
          />
        )}
      </CardContent>
    </Card>
  );
}

function ExpenseCategoryCard({
  totals,
  postedAmount,
  fmt,
}: {
  totals: FinanceExpenseCategoryTotal[];
  postedAmount: number;
  fmt: LocaleFormatters;
}) {
  const visibleTotals = totals.slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>By category</CardTitle>
      </CardHeader>
      <CardContent>
        {visibleTotals.length > 0 ? (
          <div className="space-y-4">
            {visibleTotals.map((category) => {
              const share =
                postedAmount > 0 ? (category.amount / postedAmount) * 100 : 0;
              return (
                <div key={category.categoryId} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      {category.categoryName}
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {fmt.money(category.amount)} · {Math.round(share)}%
                    </span>
                  </div>
                  <Progress value={category.amount} max={postedAmount} />
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Tags}
            className="h-64"
            title="No category spend yet"
            hint="Posted expenses will be grouped here automatically."
          />
        )}
      </CardContent>
    </Card>
  );
}

function FinanceExpensesSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading expenses">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <Skeleton className="h-10 w-full max-w-4xl" />
      <Skeleton className="h-80 rounded-lg" />
    </div>
  );
}
