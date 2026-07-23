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
import { toast } from 'sonner';

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
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import { dayStartInTz } from '@/lib/locale/format';
import {
  bucketForDue,
  daysOverdue,
  DUE_BUCKETS,
  type DueBucket,
} from '@/lib/memberships/dues';
import { istAddDays } from '@/lib/memberships/expiry';
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
  initialView?: PaymentTableView;
  onViewChange?: (view: PaymentTableView) => void;
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
const PAGE_SIZE = 25;
const EXPORT_PAGE_SIZE = 500;

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
  initialView = 'due',
  onViewChange,
}: PaymentsTableProps) {
  const { locale, fmt } = useLocale();
  const { staff, nameById: staffNameById } = useAccountStaff();
  const [view, setView] = useState<PaymentTableView>(initialView);
  const [syncedInitialView, setSyncedInitialView] = useState(initialView);
  if (initialView !== syncedInitialView) {
    setSyncedInitialView(initialView);
    setView(initialView);
  }

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
  const [ledgerTotalCount, setLedgerTotalCount] = useState(0);
  const [methodCounts, setMethodCounts] = useState<
    Record<PaymentMethod, number>
  >(
    Object.fromEntries(
      PAYMENT_METHODS.map(({ value }) => [value, 0])
    ) as Record<PaymentMethod, number>
  );
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [historyFilters, setHistoryFilters] =
    useState<PaymentHistoryFilterState>(EMPTY_PAYMENT_HISTORY_FILTERS);
  const [ledgerSort, setLedgerSort] = useState<SortState>({
    key: 'paid_on',
    dir: 'desc',
  });
  const [ledgerPage, setLedgerPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);
  const [exporting, setExporting] = useState(false);

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

  const ledgerQuerySignature = JSON.stringify({
    search,
    methods,
    historyFilters,
    ledgerSort,
  });
  const [previousLedgerQuerySignature, setPreviousLedgerQuerySignature] =
    useState(ledgerQuerySignature);
  if (ledgerQuerySignature !== previousLedgerQuerySignature) {
    setPreviousLedgerQuerySignature(ledgerQuerySignature);
    setLedgerPage(1);
    setDuePage(1);
  }

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    void (async () => {
      setLedgerLoading(true);
      setLedgerError(null);

      const term = search.trim();
      const contactJoin = term
        ? 'contact:contacts!inner(name, phone, avatar_url)'
        : 'contact:contacts(name, phone, avatar_url)';
      let query = supabase
        .from('payments')
        .select(`*, ${contactJoin}`, { count: 'exact' });

      if (term) {
        const like = `%${term}%`;
        query = query.or(`name.ilike.${like},phone.ilike.${like}`, {
          referencedTable: 'contact',
        });
      }
      if (methods.length) query = query.in('method', methods);
      if (historyFilters.statuses.length) {
        query = query.in('status', historyFilters.statuses);
      }
      if (historyFilters.sources.length) {
        query = query.in('source', historyFilters.sources);
      }
      if (historyFilters.staff.length) {
        query = query.in('user_id', historyFilters.staff);
      }
      if (historyFilters.paidFrom) {
        const from = dayStartInTz(
          historyFilters.paidFrom,
          locale.timeZone
        )?.toISOString();
        if (from) query = query.gte('paid_at', from);
      }
      if (historyFilters.paidTo) {
        const until = dayStartInTz(
          istAddDays(historyFilters.paidTo, 1),
          locale.timeZone
        )?.toISOString();
        if (until) query = query.lt('paid_at', until);
      }

      const ascending = ledgerSort.dir === 'asc';
      if (ledgerSort.key === 'name') {
        query = query.order('name', {
          ascending,
          referencedTable: 'contact',
        });
      } else {
        const sortColumn =
          ledgerSort.key === 'paid_on'
            ? 'paid_at'
            : ledgerSort.key === 'recorded_by'
              ? 'user_id'
              : ledgerSort.key;
        query = query.order(sortColumn, { ascending });
      }

      const from = (ledgerPage - 1) * PAGE_SIZE;
      const [pageResult, counts] = await Promise.all([
        query.range(from, from + PAGE_SIZE - 1),
        Promise.all(
          PAYMENT_METHODS.map(async ({ value }) => {
            const countContactJoin = term
              ? 'id, contact:contacts!inner(id)'
              : 'id';
            let countQuery = supabase
              .from('payments')
              .select(countContactJoin, { count: 'exact', head: true })
              .eq('method', value);
            if (term) {
              const like = `%${term}%`;
              countQuery = countQuery.or(
                `name.ilike.${like},phone.ilike.${like}`,
                { referencedTable: 'contact' }
              );
            }
            if (historyFilters.statuses.length) {
              countQuery = countQuery.in('status', historyFilters.statuses);
            }
            if (historyFilters.sources.length) {
              countQuery = countQuery.in('source', historyFilters.sources);
            }
            if (historyFilters.staff.length) {
              countQuery = countQuery.in('user_id', historyFilters.staff);
            }
            if (historyFilters.paidFrom) {
              const paidFrom = dayStartInTz(
                historyFilters.paidFrom,
                locale.timeZone
              )?.toISOString();
              if (paidFrom) countQuery = countQuery.gte('paid_at', paidFrom);
            }
            if (historyFilters.paidTo) {
              const paidUntil = dayStartInTz(
                istAddDays(historyFilters.paidTo, 1),
                locale.timeZone
              )?.toISOString();
              if (paidUntil) countQuery = countQuery.lt('paid_at', paidUntil);
            }
            const { count } = await countQuery;
            return [value, count ?? 0] as const;
          })
        ),
      ]);

      if (cancelled) return;
      if (pageResult.error) {
        setLedgerError(pageResult.error.message);
        setLedgerLoading(false);
        return;
      }
      setLedgerRows((pageResult.data as LedgerRow[]) ?? []);
      setLedgerTotalCount(pageResult.count ?? 0);
      setMethodCounts(
        Object.fromEntries(counts) as Record<PaymentMethod, number>
      );
      setLedgerLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    historyFilters,
    ledgerPage,
    ledgerSort,
    locale.timeZone,
    methods,
    reloadKey,
    search,
  ]);

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
      const term = search.trim().toLocaleLowerCase();
      if (term) {
        const name = row.contact?.name?.toLocaleLowerCase() ?? '';
        const phone = row.contact?.phone?.toLocaleLowerCase() ?? '';
        const memberNumber = String(row.member_number ?? '');
        if (
          !name.includes(term) &&
          !phone.includes(term) &&
          !memberNumber.includes(term)
        ) {
          return false;
        }
      }
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
  }, [dueFilters, dueRows, dueSort, search, today]);

  const filteredLedgerRows = ledgerRows;

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
      counts[bucketForDue(row.start_date, today)] += 1;
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

  const ledgerPageCount = Math.max(1, Math.ceil(ledgerTotalCount / PAGE_SIZE));
  const currentLedgerPage = Math.min(ledgerPage, ledgerPageCount);
  const ledgerPageRows = filteredLedgerRows;
  const ledgerRangeStart =
    ledgerTotalCount === 0 ? 0 : (currentLedgerPage - 1) * PAGE_SIZE + 1;
  const ledgerRangeEnd = Math.min(
    currentLedgerPage * PAGE_SIZE,
    ledgerTotalCount
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

  async function exportCsv() {
    setExporting(true);
    try {
      const supabase = createClient();
      const allRows: LedgerRow[] = [];
      const term = search.trim();
      let offset = 0;

      while (true) {
        const contactJoin = term
          ? 'contact:contacts!inner(name, phone, avatar_url)'
          : 'contact:contacts(name, phone, avatar_url)';
        let query = supabase
          .from('payments')
          .select(`*, ${contactJoin}`)
          .order('paid_at', { ascending: false });

        if (term) {
          const like = `%${term}%`;
          query = query.or(`name.ilike.${like},phone.ilike.${like}`, {
            referencedTable: 'contact',
          });
        }
        if (methods.length) query = query.in('method', methods);
        if (historyFilters.statuses.length) {
          query = query.in('status', historyFilters.statuses);
        }
        if (historyFilters.sources.length) {
          query = query.in('source', historyFilters.sources);
        }
        if (historyFilters.staff.length) {
          query = query.in('user_id', historyFilters.staff);
        }
        if (historyFilters.paidFrom) {
          const from = dayStartInTz(
            historyFilters.paidFrom,
            locale.timeZone
          )?.toISOString();
          if (from) query = query.gte('paid_at', from);
        }
        if (historyFilters.paidTo) {
          const until = dayStartInTz(
            istAddDays(historyFilters.paidTo, 1),
            locale.timeZone
          )?.toISOString();
          if (until) query = query.lt('paid_at', until);
        }

        const { data, error } = await query.range(
          offset,
          offset + EXPORT_PAGE_SIZE - 1
        );
        if (error) throw error;
        const pageRows = (data as LedgerRow[]) ?? [];
        allRows.push(...pageRows);
        if (pageRows.length < EXPORT_PAGE_SIZE) break;
        offset += EXPORT_PAGE_SIZE;
      }

      const escape = (value: string | number | null | undefined) => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const header = [
        'Paid on',
        'Name',
        'Phone',
        'Method',
        'Amount',
        'Status',
        'Recorded by',
        'Note',
      ];
      const lines = allRows.map((payment) =>
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
    } catch (error) {
      toast.error(getErrorMessage(error, 'Payment export failed'));
    } finally {
      setExporting(false);
    }
  }

  const isDue = view === 'due';
  const activeLoading = isDue ? dueLoading : ledgerLoading;
  const activeError = isDue ? dueError : ledgerError;
  const hasHistoryQuery =
    Boolean(search.trim()) ||
    methods.length > 0 ||
    historyFilters.statuses.length > 0 ||
    historyFilters.sources.length > 0 ||
    historyFilters.staff.length > 0 ||
    Boolean(historyFilters.paidFrom) ||
    Boolean(historyFilters.paidTo);

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          <SearchInput
            value={searchInput}
            onValueChange={setSearchInput}
            placeholder={isDue ? 'Search payment dues…' : 'Search payments…'}
            aria-label={isDue ? 'Search payment dues' : 'Search payments'}
          />

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
                staff={staff.map((member) => ({
                  value: member.user_id,
                  label: member.full_name,
                }))}
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
                    <ChipCount count={dueBucketCounts[key]} />
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
                    <ChipCount count={methodCounts[value]} />
                  </Chip>
                ))}
              </ChipGroup>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Toolbar aria-label="Payment table view">
              <ToolbarToggleGroup<PaymentTableView>
                aria-label="Payment table view"
                value={[view]}
                onValueChange={(nextViews) => {
                  const nextView = nextViews[0];
                  if (nextView) {
                    setView(nextView);
                    onViewChange?.(nextView);
                  }
                }}
              >
                <ToolbarToggleItem value="due" aria-label="Payments due">
                  <Wallet className="size-4" />
                  <span>Payment due</span>
                  <Badge variant="neutral" size="count">
                    {dueLoading && dueRows.length === 0 ? '—' : dueRows.length}
                  </Badge>
                </ToolbarToggleItem>
                <ToolbarToggleItem value="recent" aria-label="Recent payments">
                  <Receipt className="size-4" />
                  <span>Recent payments</span>
                  <Badge variant="neutral" size="count">
                    {ledgerLoading && ledgerTotalCount === 0
                      ? '—'
                      : ledgerTotalCount}
                  </Badge>
                </ToolbarToggleItem>
              </ToolbarToggleGroup>
            </Toolbar>

            {!isDue && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void exportCsv()}
                disabled={
                  exporting ||
                  ledgerLoading ||
                  !!ledgerError ||
                  ledgerTotalCount === 0
                }
              >
                {exporting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            )}
          </div>
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
          )
        ) : ledgerPageRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Receipt className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">
              {hasHistoryQuery
                ? 'No payments match your filters.'
                : 'No payments recorded yet.'}
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

        {!activeLoading && !activeError && !isDue && ledgerTotalCount > 0 && (
          <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <p className="text-muted-foreground text-xs tabular-nums">
              Showing {ledgerRangeStart}–{ledgerRangeEnd} of {ledgerTotalCount}{' '}
              payments
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
