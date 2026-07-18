'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Wallet } from 'lucide-react';

import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
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
  ColumnHeader,
  type ColumnFilterProp,
} from '@/components/table/column-header';
import { useLocale } from '@/hooks/use-locale';
import {
  bucketForDue,
  daysOverdue,
  DUE_BUCKETS,
  type DueBucket,
} from '@/lib/memberships/dues';
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

interface PaymentDueTableProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
  onChanged: () => void;
}

type DueMember = Membership & { balance: number };

type DueColumnKey =
  'name' | 'plan' | 'due_date' | 'status' | 'balance' | 'actions';

interface DueColumn {
  key: DueColumnKey;
  label: string;
  sortKey?: string;
  width: number;
  align?: 'right';
}

const SELECT = '*, contact:contacts(*), plan:membership_plans(*)';
const PAGE_SIZE = 25;

const DUE_COLUMNS: DueColumn[] = [
  { key: 'name', label: 'Name', sortKey: 'name', width: 220 },
  { key: 'plan', label: 'Plan', sortKey: 'plan', width: 150 },
  { key: 'due_date', label: 'Due date', sortKey: 'due_date', width: 130 },
  { key: 'status', label: 'Status', sortKey: 'status', width: 165 },
  { key: 'balance', label: 'Balance', sortKey: 'balance', width: 130 },
  { key: 'actions', label: 'Actions', width: 230, align: 'right' },
];

const SORT_COLUMNS = DUE_COLUMNS.filter((column) => column.sortKey).map(
  (column) => ({
    key: column.sortKey!,
    label: column.label,
  })
);

export function PaymentDueTable({
  readiness,
  onSelect,
  reloadKey,
  onChanged,
}: PaymentDueTableProps) {
  const { fmt } = useLocale();
  const [rows, setRows] = useState<DueMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [payFor, setPayFor] = useState<Membership | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<PaymentDueFilterState>(
    EMPTY_PAYMENT_DUE_FILTERS
  );
  const [sort, setSort] = useState<SortState>({ key: 'due_date', dir: 'asc' });
  const [page, setPage] = useState(1);

  const reload = useCallback(() => {
    setNonce((current) => current + 1);
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      const [membershipsResult, duesResult] = await Promise.all([
        supabase
          .from('memberships')
          .select(SELECT)
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
        setLoadError(error.message);
        setLoading(false);
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

      setRows(merged);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  const today = fmt.today();

  const planOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of rows) {
      if (row.plan_id && row.plan?.name)
        options.set(row.plan_id, row.plan.name);
    }
    return [...options]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const matching = rows.filter((row) => {
      if (
        query &&
        ![row.contact?.name, row.contact?.phone, row.plan?.name]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(query))
      ) {
        return false;
      }
      if (
        filters.plans.length > 0 &&
        !filters.plans.includes(row.plan_id ?? '')
      ) {
        return false;
      }
      const bucket = bucketForDue(row.start_date, today);
      return filters.buckets.length === 0 || filters.buckets.includes(bucket);
    });

    return [...matching].sort((a, b) => {
      const direction = sort.dir === 'asc' ? 1 : -1;
      let result = 0;
      if (sort.key === 'name') {
        result = (a.contact?.name ?? '').localeCompare(b.contact?.name ?? '');
      } else if (sort.key === 'plan') {
        result = (a.plan?.name ?? '').localeCompare(b.plan?.name ?? '');
      } else if (sort.key === 'status') {
        result =
          dueBucketIndex(bucketForDue(a.start_date, today)) -
          dueBucketIndex(bucketForDue(b.start_date, today));
      } else if (sort.key === 'balance') {
        result = a.balance - b.balance;
      } else {
        result = a.start_date.localeCompare(b.start_date);
      }
      return result * direction;
    });
  }, [filters, rows, search, sort, today]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const rangeStart =
    filteredRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredRows.length);

  function setBuckets(next: DueBucket[]) {
    setFilters((current) => ({ ...current, buckets: next.slice(-1) }));
    setPage(1);
  }

  function togglePlan(planId: string) {
    setFilters((current) => ({
      ...current,
      plans: current.plans.includes(planId)
        ? current.plans.filter((id) => id !== planId)
        : [...current.plans, planId],
    }));
    setPage(1);
  }

  function toggleBucket(bucket: string) {
    setFilters((current) => ({
      ...current,
      buckets: current.buckets.includes(bucket as DueBucket)
        ? []
        : [bucket as DueBucket],
    }));
    setPage(1);
  }

  function columnFilter(column: DueColumn): ColumnFilterProp | undefined {
    if (column.key === 'plan') {
      return {
        options: planOptions.map((plan) => ({
          value: plan.id,
          label: plan.name,
        })),
        selected: filters.plans,
        onToggle: togglePlan,
      };
    }
    if (column.key === 'status') {
      return {
        options: DUE_BUCKETS.map(({ key, label }) => ({ value: key, label })),
        selected: filters.buckets,
        onToggle: toggleBucket,
      };
    }
    return undefined;
  }

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          <SearchInput
            containerClassName="min-w-48 w-full max-w-[360px] flex-1 basis-64"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search payment dues…"
          />
          <div className="flex shrink-0 items-center gap-2">
            <PaymentDueFilters
              value={filters}
              onChange={(next) => {
                setFilters(next);
                setPage(1);
              }}
              plans={planOptions}
            />
            <LeadsSort
              value={sort}
              onChange={(next) => {
                if (next) setSort(next);
                setPage(1);
              }}
              columns={SORT_COLUMNS}
            />
            <Separator
              orientation="vertical"
              className="mx-0.5 h-5 data-vertical:self-center"
            />
            <ChipGroup<DueBucket>
              selectionMode="single"
              value={filters.buckets}
              onValueChange={setBuckets}
              aria-label="Payment due quick filters"
            >
              {DUE_BUCKETS.map(({ key, label }) => (
                <Chip key={key} value={key}>
                  {label}
                </Chip>
              ))}
            </ChipGroup>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="text-muted-foreground flex items-center gap-2 px-3 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading payment dues…
          </div>
        ) : loadError ? (
          <div
            className="border-destructive/30 bg-destructive/10 text-destructive m-3 rounded-lg border px-3 py-3 text-sm"
            role="alert"
          >
            Could not load payment dues: {loadError}
          </div>
        ) : pageRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="size-7 text-emerald-700 dark:text-emerald-500/70" />
            <p className="text-muted-foreground text-sm">
              {rows.length === 0
                ? 'No outstanding payments.'
                : 'No payment dues match your search or filters.'}
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
                        sortDir={column.sortKey === sort.key ? sort.dir : null}
                        onSort={(dir) => {
                          if (column.sortKey)
                            setSort({ key: column.sortKey, dir });
                          setPage(1);
                        }}
                        filter={columnFilter(column)}
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((membership) => {
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
                    <TableCell className="font-semibold text-amber-700 tabular-nums dark:text-amber-400">
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

        {!loading && !loadError && filteredRows.length > 0 && (
          <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <p className="text-muted-foreground text-xs tabular-nums">
              Showing {rangeStart}–{rangeEnd} of {filteredRows.length} payments
              due
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
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

function dueBucketIndex(bucket: DueBucket) {
  return DUE_BUCKETS.findIndex(({ key }) => key === bucket);
}

function DueStatusBadge({ bucket, days }: { bucket: DueBucket; days: number }) {
  if (bucket === 'due_soon') return <Badge variant="warning">Due now</Badge>;
  if (bucket === 'overdue_1_7') {
    return <Badge variant="warning">{days}d overdue</Badge>;
  }
  return <Badge variant="danger">{days}d overdue</Badge>;
}
