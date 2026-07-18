'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Loader2, Receipt } from 'lucide-react';

import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import {
  ColumnHeader,
  type ColumnFilterProp,
} from '@/components/table/column-header';
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
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type {
  Contact,
  Payment,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
} from '@/types';
import { MemberIdentity } from './member-identity';
import { VoidedPaymentBadge } from './membership-status-badge';
import { PaymentProofLink } from './payment-proof-link';
import {
  EMPTY_PAYMENT_HISTORY_FILTERS,
  PaymentHistoryFilters,
  type PaymentHistoryFilterState,
} from './payment-table-filters';
import { useAccountStaff } from './use-account-staff';

interface PaymentsLedgerProps {
  reloadKey: number;
  onSelect: (membershipId: string) => void;
}

type LedgerRow = Payment & {
  contact?: Pick<Contact, 'name' | 'phone' | 'avatar_url'> | null;
};

type LedgerColumnKey =
  | 'name'
  | 'paid_on'
  | 'method'
  | 'amount'
  | 'status'
  | 'recorded_by'
  | 'actions';

interface LedgerColumn {
  key: LedgerColumnKey;
  label: string;
  sortKey?: string;
  width: number;
  align?: 'right';
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

const PAYMENT_METHODS = (Object.keys(METHOD_LABEL) as PaymentMethod[]).map(
  (value) => ({
    value,
    label: METHOD_LABEL[value],
  })
);

const PAYMENT_STATUSES: { value: PaymentStatus; label: string }[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Voided' },
];

const PAYMENT_SOURCES: { value: PaymentSource; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto-pay' },
];

const LEDGER_LIMIT = 100;
const PAGE_SIZE = 25;

const LEDGER_COLUMNS: LedgerColumn[] = [
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

const SORT_COLUMNS = LEDGER_COLUMNS.filter((column) => column.sortKey).map(
  (column) => ({
    key: column.sortKey!,
    label: column.label,
  })
);

export function PaymentsLedger({ reloadKey, onSelect }: PaymentsLedgerProps) {
  const { fmt } = useLocale();
  const { nameById: staffNameById } = useAccountStaff();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [filters, setFilters] = useState<PaymentHistoryFilterState>(
    EMPTY_PAYMENT_HISTORY_FILTERS
  );
  const [sort, setSort] = useState<SortState>({ key: 'paid_on', dir: 'desc' });
  const [page, setPage] = useState(1);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from('payments')
        .select('*, contact:contacts(name, phone, avatar_url)')
        .order('paid_at', { ascending: false })
        .limit(LEDGER_LIMIT);
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setRows((data as LedgerRow[]) ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const matching = rows.filter((row) => {
      const source = paymentSource(row);
      const recorder = row.user_id
        ? staffNameById.get(row.user_id)
        : 'Auto-pay';
      if (
        query &&
        ![
          row.contact?.name,
          row.contact?.phone,
          row.note,
          METHOD_LABEL[row.method],
          recorder,
        ]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(query))
      ) {
        return false;
      }
      if (methods.length > 0 && !methods.includes(row.method)) return false;
      if (filters.statuses.length > 0 && !filters.statuses.includes(row.status))
        return false;
      return filters.sources.length === 0 || filters.sources.includes(source);
    });

    return [...matching].sort((a, b) => {
      const direction = sort.dir === 'asc' ? 1 : -1;
      let result = 0;
      if (sort.key === 'name') {
        result = (a.contact?.name ?? '').localeCompare(b.contact?.name ?? '');
      } else if (sort.key === 'method') {
        result = METHOD_LABEL[a.method].localeCompare(METHOD_LABEL[b.method]);
      } else if (sort.key === 'amount') {
        result = Number(a.amount) - Number(b.amount);
      } else if (sort.key === 'status') {
        result = a.status.localeCompare(b.status);
      } else if (sort.key === 'recorded_by') {
        result = recordedBy(a, staffNameById).localeCompare(
          recordedBy(b, staffNameById)
        );
      } else {
        result = a.paid_at.localeCompare(b.paid_at);
      }
      return result * direction;
    });
  }, [filters, methods, rows, search, sort, staffNameById]);

  const collected = useMemo(
    () =>
      filteredRows.reduce(
        (total, payment) =>
          payment.status === 'paid'
            ? total + (Number(payment.amount) || 0)
            : total,
        0
      ),
    [filteredRows]
  );

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const rangeStart =
    filteredRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredRows.length);

  function setMethodFilter(next: PaymentMethod[]) {
    setMethods(next.slice(-1));
    setPage(1);
  }

  function toggleMethod(method: string) {
    setMethods((current) =>
      current.includes(method as PaymentMethod) ? [] : [method as PaymentMethod]
    );
    setPage(1);
  }

  function toggleStatus(status: string) {
    setFilters((current) => ({
      ...current,
      statuses: current.statuses.includes(status as PaymentStatus)
        ? current.statuses.filter((value) => value !== status)
        : [...current.statuses, status as PaymentStatus],
    }));
    setPage(1);
  }

  function toggleSource(source: string) {
    setFilters((current) => ({
      ...current,
      sources: current.sources.includes(source as PaymentSource)
        ? current.sources.filter((value) => value !== source)
        : [...current.sources, source as PaymentSource],
    }));
    setPage(1);
  }

  function columnFilter(column: LedgerColumn): ColumnFilterProp | undefined {
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
        selected: filters.statuses,
        onToggle: toggleStatus,
      };
    }
    if (column.key === 'recorded_by') {
      return {
        options: PAYMENT_SOURCES,
        selected: filters.sources,
        onToggle: toggleSource,
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
    const lines = filteredRows.map((payment) =>
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

  return (
    <section className="border-border bg-card overflow-hidden rounded-2xl border">
      <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
        <SearchInput
          containerClassName="min-w-48 w-full max-w-[360px] flex-1 basis-64"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search payments…"
        />
        <div className="flex shrink-0 items-center gap-2">
          <PaymentHistoryFilters
            value={filters}
            onChange={(next) => {
              setFilters(next);
              setPage(1);
            }}
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
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={exportCsv}
          disabled={loading || !!loadError || filteredRows.length === 0}
        >
          <Download className="size-3.5" /> Export CSV
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="text-muted-foreground flex items-center gap-2 px-3 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading payments…
        </div>
      ) : loadError ? (
        <div
          className="border-destructive/30 bg-destructive/10 text-destructive m-3 rounded-lg border px-3 py-3 text-sm"
          role="alert"
        >
          Could not load payments: {loadError}
        </div>
      ) : pageRows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Receipt className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            {rows.length === 0
              ? 'No payments recorded yet.'
              : 'No payments match your search or filters.'}
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
            {pageRows.map((payment) => {
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

      {!loading && !loadError && filteredRows.length > 0 && (
        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <p className="text-muted-foreground text-xs tabular-nums">
            Showing {rangeStart}–{rangeEnd} of {filteredRows.length} payments ·{' '}
            {fmt.money(collected)} collected
            {rows.length === LEDGER_LIMIT
              ? ` · Latest ${LEDGER_LIMIT} loaded`
              : ''}
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
  );
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
