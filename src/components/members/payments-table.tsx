'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  IndianRupee,
  Wallet,
} from 'lucide-react';

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
import { useAuth } from '@/hooks/use-auth';
import { getErrorMessage } from '@/lib/errors';
import {
  bucketForDue,
  daysOverdue,
  DUE_BUCKETS,
  type DueBucket,
} from '@/lib/memberships/dues';
import {
  EMPTY_MEMBER_PAYMENT_DUES_PAGE,
  loadMemberPaymentDues,
  type MemberPaymentTotals,
} from '@/lib/memberships/payment-dues';
import { createClient } from '@/lib/supabase/client';
import type { Membership } from '@/types';
import { FollowUpDialog } from '@/components/follow-ups/follow-up-dialog';
import {
  TableSkeleton,
  type TableSkeletonCellVariant,
} from '@/components/table/table-skeleton';
import { MemberIdentity } from './member-identity';
import { buildMemberAvatarPreview } from './member-avatar-quick-view';
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

type DueColumnKey =
  'name' | 'plan' | 'due_date' | 'status' | 'balance' | 'actions';

interface TableColumn<Key extends string> {
  key: Key;
  label: string;
  sortKey?: string;
  width: number;
  align?: 'right';
}

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
  const { accountId, canSendMessages } = useAuth();
  const { fmt } = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const fetchSeq = useRef(0);

  const [snapshot, setSnapshot] = useState(EMPTY_MEMBER_PAYMENT_DUES_PAGE);
  const [dueLoading, setDueLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [dueError, setDueError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Membership | null>(null);
  const [followUpFor, setFollowUpFor] = useState<Membership | null>(null);
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
  const today = fmt.today();

  const reload = useCallback(() => onChanged(), [onChanged]);

  useEffect(() => {
    const seq = ++fetchSeq.current;
    const controller = new AbortController();

    void (async () => {
      setDueLoading(true);
      setDueError(null);
      try {
        const result = await loadMemberPaymentDues(
          supabase,
          {
            today,
            search,
            filters: dueFilters,
            sort: dueSort,
            page: Math.max(0, duePage - 1),
            pageSize: PAGE_SIZE,
          },
          controller.signal
        );
        if (controller.signal.aborted || seq !== fetchSeq.current) return;
        setSnapshot(result);
        setLoadedOnce(true);
      } catch (error) {
        if (controller.signal.aborted || seq !== fetchSeq.current) return;
        setDueError(getErrorMessage(error, 'Failed to load payment dues'));
      } finally {
        if (!controller.signal.aborted && seq === fetchSeq.current) {
          setDueLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [dueFilters, duePage, dueSort, reloadKey, search, supabase, today]);

  const duePageCount = Math.max(1, Math.ceil(snapshot.totalCount / PAGE_SIZE));
  const currentDuePage = Math.min(snapshot.page + 1, duePageCount);
  const duePageRows = snapshot.rows;
  const dueRangeStart =
    snapshot.totalCount === 0 ? 0 : snapshot.page * PAGE_SIZE + 1;
  const dueRangeEnd = Math.min(
    (snapshot.page + 1) * PAGE_SIZE,
    snapshot.totalCount
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
        options: snapshot.planOptions.map((plan) => ({
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
    <div className="space-y-6">
      <PaymentSummary
        totals={snapshot.summary}
        loading={dueLoading && !loadedOnce}
        error={dueError}
      />
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
              plans={snapshot.planOptions}
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
                  <ChipCount count={snapshot.bucketCounts[key]} />
                </Chip>
              ))}
            </ChipGroup>
          </div>
        </div>

        {dueLoading && !loadedOnce ? (
          <TableSkeleton
            className="min-w-[1040px] table-fixed"
            label="Loading payment dues"
            rows={8}
            columns={DUE_COLUMNS.map((column) => ({
              label: column.label,
              width: column.width,
              variant: (column.key === 'name'
                ? 'identity'
                : column.key === 'status'
                  ? 'badge'
                  : column.key === 'actions'
                    ? 'actions'
                    : 'text') as TableSkeletonCellVariant,
              headClassName:
                column.align === 'right' ? 'text-right' : undefined,
            }))}
          />
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
              {snapshot.outstandingCount === 0
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
                        avatarPreview={buildMemberAvatarPreview({
                          membership,
                          accountId,
                          view: 'payments',
                          readiness,
                          canFollowUp: canSendMessages,
                          onSelect: () => onSelect(membership.id),
                          onFollowUp: () => setFollowUpFor(membership),
                          onReminderSent: reload,
                        })}
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

        {!dueLoading && !dueError && snapshot.totalCount > 0 && (
          <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <p className="text-muted-foreground text-xs tabular-nums">
              Showing {dueRangeStart}–{dueRangeEnd} of {snapshot.totalCount}{' '}
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

      {followUpFor && (
        <FollowUpDialog
          open
          onOpenChange={(open) => !open && setFollowUpFor(null)}
          membership={followUpFor}
          initialReason="payment"
          onSaved={() => {
            setFollowUpFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function PaymentSummary({
  totals,
  loading,
  error,
}: {
  totals: MemberPaymentTotals;
  loading: boolean;
  error: string | null;
}) {
  const { fmt } = useLocale();
  const tiles = [
    {
      label: 'Collected today',
      value: totals.today,
      icon: <IndianRupee className="text-emerald-foreground size-4" />,
    },
    {
      label: 'Last 7 days',
      value: totals.week,
      icon: <CalendarDays className="text-emerald-foreground size-4" />,
    },
    {
      label: 'This month',
      value: totals.month,
      icon: <Wallet className="text-emerald-foreground size-4" />,
    },
    {
      label: 'Outstanding',
      value: totals.outstanding,
      icon: <AlertTriangle className="text-amber-foreground size-4" />,
      accent: true,
    },
  ];

  if (error) {
    return (
      <div
        className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-3 text-sm"
        role="alert"
      >
        Could not load payment totals: {error}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="border-border bg-card rounded-xl border p-4"
        >
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {tile.icon}
            {tile.label}
          </div>
          <div
            className={`mt-2 text-xl font-semibold tabular-nums ${tile.accent && tile.value > 0 ? 'text-amber-foreground' : 'text-foreground'}`}
          >
            {loading ? '—' : fmt.money(tile.value)}
          </div>
        </div>
      ))}
    </div>
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
