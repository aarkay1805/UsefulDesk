'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  Receipt,
  Wallet,
} from 'lucide-react';

import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import {
  ColumnHeader,
  type ColumnFilterProp,
} from '@/components/table/column-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
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
import { useLocale } from '@/hooks/use-locale';
import {
  bucketForDue,
  daysOverdue,
  DUE_BUCKETS,
  type DueBucket,
} from '@/lib/memberships/dues';
import { isChargeableAmount } from '@/lib/memberships/periods';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type {
  Contact,
  Membership,
  Payment,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
} from '@/types';
import { MemberIdentity } from './member-identity';
import { VoidedPaymentBadge } from './membership-status-badge';
import { PaymentProofLink } from './payment-proof-link';
import {
  EMPTY_PAYMENT_DUE_FILTERS,
  EMPTY_PAYMENT_HISTORY_FILTERS,
  PaymentDueFilters,
  PaymentHistoryFilters,
  type PaymentDueFilterState,
  type PaymentHistoryFilterState,
} from './payment-table-filters';
import { RecordPaymentDialog } from './record-payment-dialog';
import {
  SendReminderButton,
  type ReminderReadiness,
} from './send-reminder-button';
import { useAccountStaff } from './use-account-staff';

interface PaymentsTableProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
  onChanged: () => void;
}

type PaymentTableView = 'due' | 'recent';
type DueMember = Membership & { balance: number };
type LedgerRow = Payment & {
  contact?: Pick<Contact, 'name' | 'phone' | 'avatar_url'> | null;
};

type DueColumnKey =
  'name' | 'plan' | 'due_date' | 'status' | 'balance' | 'actions';
type LedgerColumnKey =
  | 'name'
  | 'paid_on'
  | 'method'
  | 'amount'
  | 'status'
  | 'recorded_by'
  | 'actions';

interface TableColumn<Key extends string> {
  key: Key;
  label: string;
  sortKey?: string;
  width: number;
  align?: 'right';
}

const MEMBERSHIP_SELECT = '*, contact:contacts(*), plan:membership_plans(*)';
const LEDGER_LIMIT = 100;
const PAGE_SIZE = 25;

const DUE_COLUMNS: TableColumn<DueColumnKey>[] = [
  { key: 'name', label: 'Name', sortKey: 'name', width: 220 },
  { key: 'plan', label: 'Plan', sortKey: 'plan', width: 150 },
  { key: 'due_date', label: 'Due date', sortKey: 'due_date', width: 130 },
  { key: 'status', label: 'Status', sortKey: 'status', width: 165 },
  { key: 'balance', label: 'Balance', sortKey: 'balance', width: 130 },
  { key: 'actions', label: 'Actions', width: 230, align: 'right' },
];

const LEDGER_COLUMNS: TableColumn<LedgerColumnKey>[] = [
  { key: 'name', label: 'Name', sortKey: 'name', width: 220 },
  { key: 'paid_on', label: 'Paid on', sortKey: 'paid_on', width: 180 },
  { key: 'method', label: 'Method', sortKey: 'method', width: 110 },
  { key: 'amount', label: 'Amount', sortKey: 'amount', width: 130 },
  { key: 'status', label: 'Status', sortKey: 'status', width: 115 },
  {
    key: 'recorded_by',
    label: 'Recorded by',
    sortKey: 'recorded_by',
    width: 160,
  },
  { key: 'actions', label: 'Actions', width: 150, align: 'right' },
];

const DUE_SORT_COLUMNS = DUE_COLUMNS.filter((column) => column.sortKey).map(
  (column) => ({ key: column.sortKey!, label: column.label })
);
const LEDGER_SORT_COLUMNS = LEDGER_COLUMNS.filter(
  (column) => column.sortKey
).map((column) => ({ key: column.sortKey!, label: column.label }));

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

const PAYMENT_METHODS = (Object.keys(METHOD_LABEL) as PaymentMethod[]).map(
  (value) => ({ value, label: METHOD_LABEL[value] })
);
const PAYMENT_STATUSES: { value: PaymentStatus; label: string }[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Voided' },
];
const PAYMENT_SOURCES: { value: PaymentSource; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto-pay' },
];

export function PaymentsTable({
  readiness,
  onSelect,
  reloadKey,
  onChanged,
}: PaymentsTableProps) {
  const { fmt } = useLocale();
  const { nameById: staffNameById } = useAccountStaff();
  const [view, setView] = useState<PaymentTableView>('due');

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

  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [historyFilters, setHistoryFilters] =
    useState<PaymentHistoryFilterState>(EMPTY_PAYMENT_HISTORY_FILTERS);
  const [ledgerSort, setLedgerSort] = useState<SortState>({
    key: 'paid_on',
    dir: 'desc',
  });
  const [ledgerPage, setLedgerPage] = useState(1);

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

    (async () => {
      setLedgerLoading(true);
      setLedgerError(null);
      const { data, error } = await supabase
        .from('payments')
        .select('*, contact:contacts(name, phone, avatar_url)')
        .order('paid_at', { ascending: false })
        .limit(LEDGER_LIMIT);
      if (cancelled) return;
      if (error) {
        setLedgerError(error.message);
        setLedgerLoading(false);
        return;
      }
      setLedgerRows((data as LedgerRow[]) ?? []);
      setLedgerLoading(false);
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
      if (
        dueFilters.plans.length > 0 &&
        !dueFilters.plans.includes(row.plan_id ?? '')
      ) {
        return false;
      }
      const bucket = bucketForDue(row.start_date, today);
      return (
        dueFilters.buckets.length === 0 || dueFilters.buckets.includes(bucket)
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
  }, [dueFilters, dueRows, dueSort, today]);

  const filteredLedgerRows = useMemo(() => {
    const matching = ledgerRows.filter((row) => {
      const source = paymentSource(row);
      if (methods.length > 0 && !methods.includes(row.method)) return false;
      if (
        historyFilters.statuses.length > 0 &&
        !historyFilters.statuses.includes(row.status)
      ) {
        return false;
      }
      return (
        historyFilters.sources.length === 0 ||
        historyFilters.sources.includes(source)
      );
    });

    return [...matching].sort((a, b) => {
      const direction = ledgerSort.dir === 'asc' ? 1 : -1;
      let result = 0;
      if (ledgerSort.key === 'name') {
        result = (a.contact?.name ?? '').localeCompare(b.contact?.name ?? '');
      } else if (ledgerSort.key === 'method') {
        result = METHOD_LABEL[a.method].localeCompare(METHOD_LABEL[b.method]);
      } else if (ledgerSort.key === 'amount') {
        result = Number(a.amount) - Number(b.amount);
      } else if (ledgerSort.key === 'status') {
        result = a.status.localeCompare(b.status);
      } else if (ledgerSort.key === 'recorded_by') {
        result = recordedBy(a, staffNameById).localeCompare(
          recordedBy(b, staffNameById)
        );
      } else {
        result = a.paid_at.localeCompare(b.paid_at);
      }
      return result * direction;
    });
  }, [historyFilters, ledgerRows, ledgerSort, methods, staffNameById]);

  const collected = useMemo(
    () =>
      filteredLedgerRows.reduce(
        (total, payment) =>
          payment.status === 'paid'
            ? total + (Number(payment.amount) || 0)
            : total,
        0
      ),
    [filteredLedgerRows]
  );

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

  const ledgerPageCount = Math.max(
    1,
    Math.ceil(filteredLedgerRows.length / PAGE_SIZE)
  );
  const currentLedgerPage = Math.min(ledgerPage, ledgerPageCount);
  const ledgerPageRows = filteredLedgerRows.slice(
    (currentLedgerPage - 1) * PAGE_SIZE,
    currentLedgerPage * PAGE_SIZE
  );
  const ledgerRangeStart =
    filteredLedgerRows.length === 0
      ? 0
      : (currentLedgerPage - 1) * PAGE_SIZE + 1;
  const ledgerRangeEnd = Math.min(
    currentLedgerPage * PAGE_SIZE,
    filteredLedgerRows.length
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

  function setMethodFilter(next: PaymentMethod[]) {
    setMethods(next.slice(-1));
    setLedgerPage(1);
  }

  function toggleMethod(method: string) {
    setMethods((current) =>
      current.includes(method as PaymentMethod) ? [] : [method as PaymentMethod]
    );
    setLedgerPage(1);
  }

  function toggleHistoryStatus(status: string) {
    setHistoryFilters((current) => ({
      ...current,
      statuses: current.statuses.includes(status as PaymentStatus)
        ? current.statuses.filter((value) => value !== status)
        : [...current.statuses, status as PaymentStatus],
    }));
    setLedgerPage(1);
  }

  function toggleHistorySource(source: string) {
    setHistoryFilters((current) => ({
      ...current,
      sources: current.sources.includes(source as PaymentSource)
        ? current.sources.filter((value) => value !== source)
        : [...current.sources, source as PaymentSource],
    }));
    setLedgerPage(1);
  }

  function ledgerColumnFilter(
    column: TableColumn<LedgerColumnKey>
  ): ColumnFilterProp | undefined {
    if (column.key === 'method') {
      return {
        options: PAYMENT_METHODS,
        selected: methods,
        onToggle: toggleMethod,
      };
    }
    if (column.key === 'status') {
      return {
        options: PAYMENT_STATUSES,
        selected: historyFilters.statuses,
        onToggle: toggleHistoryStatus,
      };
    }
    if (column.key === 'recorded_by') {
      return {
        options: PAYMENT_SOURCES,
        selected: historyFilters.sources,
        onToggle: toggleHistorySource,
      };
    }
    return undefined;
  }

  function exportCsv() {
    const escape = (value: string | number | null | undefined) => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = [
      'Paid on',
      'Member',
      'Phone',
      'Method',
      'Amount',
      'Status',
      'Recorded by',
      'Note',
    ];
    const lines = filteredLedgerRows.map((payment) =>
      [
        fmt.dateTime(payment.paid_at),
        escape(payment.contact?.name),
        escape(payment.contact?.phone),
        METHOD_LABEL[payment.method],
        Number(payment.amount),
        payment.status,
        escape(recordedBy(payment, staffNameById)),
        escape(payment.note),
      ].join(',')
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `payments-${methods[0] ?? 'all-methods'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const isDue = view === 'due';
  const activeLoading = isDue ? dueLoading : ledgerLoading;
  const activeError = isDue ? dueError : ledgerError;

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          <Toolbar aria-label="Payment table view">
            <ToolbarToggleGroup<PaymentTableView>
              aria-label="Payment table view"
              value={[view]}
              onValueChange={(nextViews) => {
                const nextView = nextViews[0];
                if (nextView) setView(nextView);
              }}
            >
              <ToolbarToggleItem value="due" aria-label="Payments due">
                <Wallet className="size-4" />
                <span>Payment due</span>
                <Badge variant="neutral">
                  <span className="tabular-nums">
                    {dueLoading && dueRows.length === 0 ? '—' : dueRows.length}
                  </span>
                </Badge>
              </ToolbarToggleItem>
              <ToolbarToggleItem value="recent" aria-label="Recent payments">
                <Receipt className="size-4" />
                <span>Recent payments</span>
                <Badge variant="neutral">
                  <span className="tabular-nums">
                    {ledgerLoading && ledgerRows.length === 0
                      ? '—'
                      : ledgerRows.length}
                  </span>
                </Badge>
              </ToolbarToggleItem>
            </ToolbarToggleGroup>
          </Toolbar>

          <div className="flex shrink-0 items-center gap-2">
            {isDue ? (
              <PaymentDueFilters
                value={dueFilters}
                onChange={(next) => {
                  setDueFilters(next);
                  setDuePage(1);
                }}
                plans={planOptions}
              />
            ) : (
              <PaymentHistoryFilters
                value={historyFilters}
                onChange={(next) => {
                  setHistoryFilters(next);
                  setLedgerPage(1);
                }}
              />
            )}

            <LeadsSort
              value={isDue ? dueSort : ledgerSort}
              onChange={(next) => {
                if (!next) return;
                if (isDue) {
                  setDueSort(next);
                  setDuePage(1);
                } else {
                  setLedgerSort(next);
                  setLedgerPage(1);
                }
              }}
              columns={isDue ? DUE_SORT_COLUMNS : LEDGER_SORT_COLUMNS}
            />

            <Separator
              orientation="vertical"
              className="mx-0.5 h-5 data-vertical:self-center"
            />

            {isDue ? (
              <ChipGroup<DueBucket>
                selectionMode="single"
                value={dueFilters.buckets}
                onValueChange={setDueBuckets}
                aria-label="Payment due quick filters"
              >
                {DUE_BUCKETS.map(({ key, label }) => (
                  <Chip key={key} value={key}>
                    {label}
                  </Chip>
                ))}
              </ChipGroup>
            ) : (
              <ChipGroup<PaymentMethod>
                selectionMode="single"
                value={methods}
                onValueChange={setMethodFilter}
                aria-label="Payment method quick filters"
              >
                {PAYMENT_METHODS.map(({ value, label }) => (
                  <Chip key={value} value={value}>
                    {label}
                  </Chip>
                ))}
              </ChipGroup>
            )}
          </div>

          {!isDue && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={exportCsv}
              disabled={
                ledgerLoading ||
                !!ledgerError ||
                filteredLedgerRows.length === 0
              }
            >
              <Download className="size-3.5" /> Export CSV
            </Button>
          )}
        </div>

        {activeLoading &&
        (isDue ? dueRows.length === 0 : ledgerRows.length === 0) ? (
          <div className="text-muted-foreground flex items-center gap-2 px-3 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {isDue ? 'Loading payment dues…' : 'Loading payments…'}
          </div>
        ) : activeError ? (
          <div
            className="border-destructive/30 bg-destructive/10 text-destructive m-3 rounded-lg border px-3 py-3 text-sm"
            role="alert"
          >
            {isDue
              ? `Could not load payment dues: ${activeError}`
              : `Could not load payments: ${activeError}`}
          </div>
        ) : isDue ? (
          duePageRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CheckCircle2 className="size-7 text-emerald-foreground" />
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
                      <TableCell className="font-semibold text-amber-foreground tabular-nums">
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
          )
        ) : ledgerPageRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Receipt className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">
              {ledgerRows.length === 0
                ? 'No payments recorded yet.'
                : 'No payments match your filters.'}
            </p>
          </div>
        ) : (
          <Table className="min-w-[1065px] table-fixed">
            <TableCaption className="sr-only">Recent payments</TableCaption>
            <colgroup>
              {LEDGER_COLUMNS.map((column) => (
                <col key={column.key} style={{ width: column.width }} />
              ))}
            </colgroup>
            <TableHeader>
              <TableRow>
                {LEDGER_COLUMNS.map((column) => (
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
                          column.sortKey === ledgerSort.key
                            ? ledgerSort.dir
                            : null
                        }
                        onSort={(dir) => {
                          if (column.sortKey)
                            setLedgerSort({ key: column.sortKey, dir });
                          setLedgerPage(1);
                        }}
                        filter={ledgerColumnFilter(column)}
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerPageRows.map((payment) => {
                const canOpenMember = Boolean(payment.membership_id);
                const hasProof = Boolean(
                  payment.screenshot_url || payment.screenshot_path
                );
                return (
                  <TableRow
                    key={payment.id}
                    className={cn(canOpenMember && 'cursor-pointer')}
                    onClick={() =>
                      payment.membership_id && onSelect(payment.membership_id)
                    }
                  >
                    <TableCell>
                      <MemberIdentity
                        name={payment.contact?.name}
                        secondary={payment.contact?.phone}
                        src={payment.contact?.avatar_url}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmt.dateTime(payment.paid_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {METHOD_LABEL[payment.method]}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      <span
                        className={
                          payment.status === 'void'
                            ? 'line-through opacity-60'
                            : undefined
                        }
                      >
                        {fmt.money(payment.amount)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge
                        payment={payment}
                        voidedOn={
                          payment.voided_at ? fmt.date(payment.voided_at) : null
                        }
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate">
                      {recordedBy(payment, staffNameById)}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {payment.membership_id && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onSelect(payment.membership_id!)}
                          >
                            <Eye className="size-3.5" /> View
                          </Button>
                        )}
                        {hasProof && <PaymentProofLink payment={payment} />}
                        {!payment.membership_id && !hasProof && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {!activeLoading &&
          !activeError &&
          isDue &&
          filteredDueRows.length > 0 && (
            <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
              <p className="text-muted-foreground text-xs tabular-nums">
                Showing {dueRangeStart}–{dueRangeEnd} of{' '}
                {filteredDueRows.length} payments due
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

        {!activeLoading &&
          !activeError &&
          !isDue &&
          filteredLedgerRows.length > 0 && (
            <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
              <p className="text-muted-foreground text-xs tabular-nums">
                Showing {ledgerRangeStart}–{ledgerRangeEnd} of{' '}
                {filteredLedgerRows.length} payments ·{' '}
                <span className="tabular-nums">{fmt.money(collected)}</span>{' '}
                collected
                {ledgerRows.length === LEDGER_LIMIT
                  ? ` · Latest ${LEDGER_LIMIT} loaded`
                  : ''}
              </p>
              <PaginationControls
                page={currentLedgerPage}
                pageCount={ledgerPageCount}
                onPrevious={() =>
                  setLedgerPage((current) => Math.max(1, current - 1))
                }
                onNext={() =>
                  setLedgerPage((current) =>
                    Math.min(ledgerPageCount, current + 1)
                  )
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

function paymentSource(payment: Payment): PaymentSource {
  if (payment.source) return payment.source;
  return payment.user_id ? 'manual' : 'auto';
}

function recordedBy(payment: Payment, staffNameById: Map<string, string>) {
  if (paymentSource(payment) === 'auto') return 'Auto-pay';
  return payment.user_id
    ? (staffNameById.get(payment.user_id) ?? 'Staff')
    : 'Staff';
}

function PaymentStatusBadge({
  payment,
  voidedOn,
}: {
  payment: Payment;
  voidedOn: string | null;
}) {
  if (payment.status === 'void') {
    return <VoidedPaymentBadge payment={payment} voidedOn={voidedOn} />;
  }
  if (payment.status === 'due') return <Badge variant="warning">Due</Badge>;
  return <Badge variant="success">Paid</Badge>;
}
