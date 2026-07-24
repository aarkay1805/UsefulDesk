'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Wallet } from 'lucide-react';

import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import {
  ColumnHeader,
  type ColumnFilterProp,
} from '@/components/table/column-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { Separator } from '@/components/ui/separator';
import { SearchInput } from '@/components/ui/search-input';
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
import {
  bucketForDue,
  daysOverdue,
  DUE_BUCKETS,
  type DueBucket,
} from '@/lib/memberships/dues';
import { memberMatchesSearch } from '@/lib/memberships/search';
import { isChargeableAmount } from '@/lib/memberships/periods';
import { createClient } from '@/lib/supabase/client';
import type { Membership } from '@/types';
import { MemberIdentity } from './member-identity';
import {
  EMPTY_PAYMENT_DUE_FILTERS,
  PaymentDueFilters,
  type PaymentDueFilterState,
} from './payment-table-filters';
import { RecordPaymentDialog } from './record-payment-dialog';
import {
  SendReminderButton,
  type ReminderReadiness,
} from './send-reminder-button';

interface PaymentsTableProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
  onChanged: () => void;
}

type DueMember = Membership & { balance: number };

type DueColumnKey =
  'name' | 'plan' | 'due_date' | 'status' | 'balance' | 'actions';

interface TableColumn<Key extends string> {
  key: Key;
  label: string;
  sortKey?: string;
  width: number;
  align?: 'right';
}

const MEMBERSHIP_SELECT = '*, contact:contacts(*), plan:membership_plans(*)';
const PAGE_SIZE = 25;

const DUE_COLUMNS: TableColumn<DueColumnKey>[] = [
  { key: 'name', label: 'Name', sortKey: 'name', width: 220 },
  { key: 'plan', label: 'Plan', sortKey: 'plan', width: 150 },
  { key: 'due_date', label: 'Due date', sortKey: 'due_date', width: 130 },
  { key: 'status', label: 'Status', sortKey: 'status', width: 165 },
  { key: 'balance', label: 'Balance', sortKey: 'balance', width: 130 },
  { key: 'actions', label: 'Actions', width: 230, align: 'right' },
];

const DUE_SORT_COLUMNS = DUE_COLUMNS.filter((column) => column.sortKey).map(
  (column) => ({ key: column.sortKey!, label: column.label })
);

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

export function PaymentsTable({
  readiness,
  onSelect,
  reloadKey,
  onChanged,
}: PaymentsTableProps) {
  const { fmt } = useLocale();

  const [dueRows, setDueRows] = useState<DueMember[]>([]);
  const [dueLoading, setDueLoading] = useState(true);
  const [dueError, setDueError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Membership | null>(null);
  const [dueFilters, setDueFilters] = useState<PaymentDueFilterState>(
    EMPTY_PAYMENT_DUE_FILTERS
  );
  const [dueSort, setDueSort] = useState<SortState>({
    key: 'due_date',
    dir: 'asc',
  });
  const [duePage, setDuePage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);

  const reload = useCallback(() => onChanged(), [onChanged]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setDueLoading(true);
      setDueError(null);
      const [membershipsResult, duesResult] = await Promise.all([
        supabase
          .from('memberships')
          .select(MEMBERSHIP_SELECT)
          .neq('status', 'cancelled')
          .order('start_date', { ascending: true }),
        supabase
          .from('membership_dues')
          .select('membership_id, balance')
          .gt('balance', 0),
      ]);
      if (cancelled) return;

      const error = membershipsResult.error ?? duesResult.error;
      if (error) {
        setDueError(error.message);
        setDueLoading(false);
        return;
      }

      const balanceById = new Map<string, number>(
        (duesResult.data ?? []).map((due) => [
          due.membership_id as string,
          Number(due.balance) || 0,
        ])
      );
      const merged = (
        ((membershipsResult.data as Membership[]) ?? []).map((membership) => ({
          ...membership,
          balance: balanceById.get(membership.id) ?? 0,
        })) as DueMember[]
      ).filter((membership) => isChargeableAmount(membership.balance));

      setDueRows(merged);
      setDueLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const today = fmt.today();

  const planOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of dueRows) {
      if (row.plan_id && row.plan?.name)
        options.set(row.plan_id, row.plan.name);
    }
    return [...options]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dueRows]);

  const filteredDueRows = useMemo(() => {
    const matching = dueRows.filter((row) => {
      if (!memberMatchesSearch(row, search)) return false;
      if (
        dueFilters.plans.length > 0 &&
        !dueFilters.plans.includes(row.plan_id ?? '')
      ) {
        return false;
      }
      const bucket = bucketForDue(row.start_date, today);
      return (
        dueFilters.buckets.length === 0 ||
        (bucket !== null && dueFilters.buckets.includes(bucket))
      );
    });

    return [...matching].sort((a, b) => {
      const direction = dueSort.dir === 'asc' ? 1 : -1;
      let result = 0;
      if (dueSort.key === 'name') {
        result = (a.contact?.name ?? '').localeCompare(b.contact?.name ?? '');
      } else if (dueSort.key === 'plan') {
        result = (a.plan?.name ?? '').localeCompare(b.plan?.name ?? '');
      } else if (dueSort.key === 'status') {
        result =
          dueBucketIndex(bucketForDue(a.start_date, today)) -
          dueBucketIndex(bucketForDue(b.start_date, today));
      } else if (dueSort.key === 'balance') {
        result = a.balance - b.balance;
      } else {
        result = a.start_date.localeCompare(b.start_date);
      }
      return result * direction;
    });
  }, [dueFilters, dueRows, dueSort, search, today]);

  const dueBucketCounts = useMemo(() => {
    const counts = Object.fromEntries(
      DUE_BUCKETS.map(({ key }) => [key, 0])
    ) as Record<DueBucket, number>;
    for (const row of dueRows) {
      if (
        dueFilters.plans.length > 0 &&
        !dueFilters.plans.includes(row.plan_id ?? '')
      ) {
        continue;
      }
      const bucket = bucketForDue(row.start_date, today);
      if (bucket) counts[bucket] += 1;
    }
    return counts;
  }, [dueFilters.plans, dueRows, today]);

  const duePageCount = Math.max(
    1,
    Math.ceil(filteredDueRows.length / PAGE_SIZE)
  );
  const currentDuePage = Math.min(duePage, duePageCount);
  const duePageRows = filteredDueRows.slice(
    (currentDuePage - 1) * PAGE_SIZE,
    currentDuePage * PAGE_SIZE
  );
  const dueRangeStart =
    filteredDueRows.length === 0 ? 0 : (currentDuePage - 1) * PAGE_SIZE + 1;
  const dueRangeEnd = Math.min(
    currentDuePage * PAGE_SIZE,
    filteredDueRows.length
  );

  function setDueBuckets(next: DueBucket[]) {
    setDueFilters((current) => ({
      ...current,
      buckets: next.slice(-1),
    }));
    setDuePage(1);
  }

  function toggleDuePlan(planId: string) {
    setDueFilters((current) => ({
      ...current,
      plans: current.plans.includes(planId)
        ? current.plans.filter((id) => id !== planId)
        : [...current.plans, planId],
    }));
    setDuePage(1);
  }

  function toggleDueBucket(bucket: string) {
    setDueFilters((current) => ({
      ...current,
      buckets: current.buckets.includes(bucket as DueBucket)
        ? []
        : [bucket as DueBucket],
    }));
    setDuePage(1);
  }

  function dueColumnFilter(
    column: TableColumn<DueColumnKey>
  ): ColumnFilterProp | undefined {
    if (column.key === 'plan') {
      return {
        options: planOptions.map((plan) => ({
          value: plan.id,
          label: plan.name,
        })),
        selected: dueFilters.plans,
        onToggle: toggleDuePlan,
      };
    }
    if (column.key === 'status') {
      return {
        options: DUE_BUCKETS.map(({ key, label }) => ({ value: key, label })),
        selected: dueFilters.buckets,
        onToggle: toggleDueBucket,
      };
    }
    return undefined;
  }

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          <SearchInput
            value={searchInput}
            onValueChange={(value) => {
              setSearchInput(value);
              setDuePage(1);
            }}
            placeholder="Search by name or ID"
            aria-label="Search payment dues by name or Member ID"
          />

          <div className="flex shrink-0 items-center gap-2">
            <PaymentDueFilters
              value={dueFilters}
              onChange={(next) => {
                setDueFilters(next);
                setDuePage(1);
              }}
              plans={planOptions}
            />

            <LeadsSort
              value={dueSort}
              onChange={(next) => {
                if (!next) return;
                setDueSort(next);
                setDuePage(1);
              }}
              columns={DUE_SORT_COLUMNS}
            />

            <Separator
              orientation="vertical"
              className="mx-0.5 h-5 data-vertical:self-center"
            />

            <ChipGroup<DueBucket>
              selectionMode="single"
              value={dueFilters.buckets}
              onValueChange={setDueBuckets}
              aria-label="Payment due quick filters"
            >
              {DUE_BUCKETS.map(({ key, label }) => (
                <Chip key={key} value={key}>
                  {label}
                  <ChipCount count={dueBucketCounts[key]} />
                </Chip>
              ))}
            </ChipGroup>
          </div>
        </div>

        {dueLoading && dueRows.length === 0 ? (
          <div className="text-muted-foreground flex items-center gap-2 px-3 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading payment dues…
          </div>
        ) : dueError ? (
          <div
            className="border-destructive/30 bg-destructive/10 text-destructive m-3 rounded-lg border px-3 py-3 text-sm"
            role="alert"
          >
            Could not load payment dues: {dueError}
          </div>
        ) : duePageRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="text-emerald-foreground size-7" />
            <p className="text-muted-foreground text-sm">
              {dueRows.length === 0
                ? 'No outstanding payments.'
                : 'No payment dues match your filters.'}
            </p>
          </div>
        ) : (
          <Table className="min-w-[1040px] table-fixed">
            <TableCaption className="sr-only">
              Outstanding member payments
            </TableCaption>
            <colgroup>
              {DUE_COLUMNS.map((column) => (
                <col key={column.key} style={{ width: column.width }} />
              ))}
            </colgroup>
            <TableHeader>
              <TableRow>
                {DUE_COLUMNS.map((column) => (
                  <TableHead
                    key={column.key}
                    className={
                      column.align === 'right'
                        ? 'text-muted-foreground text-right'
                        : 'text-muted-foreground'
                    }
                  >
                    {column.key === 'actions' ? (
                      column.label
                    ) : (
                      <ColumnHeader
                        label={column.label}
                        sortable={Boolean(column.sortKey)}
                        sortDir={
                          column.sortKey === dueSort.key ? dueSort.dir : null
                        }
                        onSort={(dir) => {
                          if (column.sortKey)
                            setDueSort({ key: column.sortKey, dir });
                          setDuePage(1);
                        }}
                        filter={dueColumnFilter(column)}
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {duePageRows.map((membership) => {
                const bucket = bucketForDue(membership.start_date, today);
                return (
                  <TableRow
                    key={membership.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(membership.id)}
                  >
                    <TableCell>
                      <MemberIdentity
                        name={membership.contact?.name}
                        secondary={membership.contact?.phone}
                        src={membership.contact?.avatar_url}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate">
                      {membership.plan?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmt.date(membership.start_date)}
                    </TableCell>
                    <TableCell>
                      <DueStatusBadge
                        bucket={bucket}
                        days={daysOverdue(membership.start_date, today)}
                      />
                    </TableCell>
                    <TableCell className="text-amber-foreground font-semibold tabular-nums">
                      {fmt.money(membership.balance)}
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
                          onClick={() => setPayFor(membership)}
                        >
                          <Wallet className="size-3.5" /> Record
                        </Button>
                        <SendReminderButton
                          membership={membership}
                          readiness={readiness}
                          onSent={reload}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {!dueLoading && !dueError && filteredDueRows.length > 0 && (
          <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <p className="text-muted-foreground text-xs tabular-nums">
              Showing {dueRangeStart}–{dueRangeEnd} of {filteredDueRows.length}{' '}
              payments due
            </p>
            <PaginationControls
              page={currentDuePage}
              pageCount={duePageCount}
              onPrevious={() =>
                setDuePage((current) => Math.max(1, current - 1))
              }
              onNext={() =>
                setDuePage((current) => Math.min(duePageCount, current + 1))
              }
            />
          </div>
        )}
      </section>

      {payFor && (
        <RecordPaymentDialog
          open
          onOpenChange={(open) => !open && setPayFor(null)}
          membership={payFor}
          onSaved={reload}
        />
      )}
    </>
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

function dueBucketIndex(bucket: DueBucket | null) {
  if (bucket === null) return DUE_BUCKETS.length;
  return DUE_BUCKETS.findIndex(({ key }) => key === bucket);
}

function DueStatusBadge({
  bucket,
  days,
}: {
  bucket: DueBucket | null;
  days: number;
}) {
  if (bucket === null) return <Badge variant="neutral">Upcoming</Badge>;
  if (bucket === 'due_today') return <Badge variant="warning">Due today</Badge>;
  return <Badge variant="danger">{days}d overdue</Badge>;
}
