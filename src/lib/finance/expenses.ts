import type { SupabaseClient } from '@supabase/supabase-js';

import { financeMonthRange } from '@/lib/finance/overview';
import { istAddDays } from '@/lib/memberships/expiry';
import type {
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  PaymentMethod,
} from '@/types';

export type FinanceExpenseQuickView = 'all' | 'recurring' | 'one_time';

export type FinanceExpenseSortKey =
  | 'expense'
  | 'description'
  | 'occurred_on'
  | 'category'
  | 'method'
  | 'expense_kind'
  | 'amount'
  | 'status'
  | 'recorded_by';

export interface FinanceExpenseFilterState {
  categoryIds: string[];
  methods: PaymentMethod[];
  statuses: ExpenseStatus[];
  recordedBy: string[];
  occurredFrom: string;
  occurredTo: string;
}

export const EMPTY_FINANCE_EXPENSE_FILTERS: FinanceExpenseFilterState = {
  categoryIds: [],
  methods: [],
  statuses: [],
  recordedBy: [],
  occurredFrom: '',
  occurredTo: '',
};

export type FinanceExpenseRow = Expense & {
  reference: string;
  category_name: string;
  recorded_by_name: string | null;
};

export interface FinanceExpenseSummary {
  count: number;
  postedCount: number;
  postedAmount: number;
  recurringCount: number;
  recurringAmount: number;
  oneTimeCount: number;
  oneTimeAmount: number;
  voidedCount: number;
  voidedAmount: number;
}

export interface FinanceExpenseTrendPoint {
  date: string;
  amount: number;
}

export interface FinanceExpenseCategoryTotal {
  categoryId: string;
  categoryName: string;
  count: number;
  amount: number;
}

export type FinanceExpenseFacets = Record<FinanceExpenseQuickView, number>;

export interface FinanceExpensePage {
  rows: FinanceExpenseRow[];
  summary: FinanceExpenseSummary;
  facets: FinanceExpenseFacets;
  analysis: {
    dailyTrend: FinanceExpenseTrendPoint[];
    categoryTotals: FinanceExpenseCategoryTotal[];
  };
}

export interface FinanceExpenseQuery {
  month: string;
  search: string;
  quickView: FinanceExpenseQuickView;
  filters: FinanceExpenseFilterState;
  sort: { key: FinanceExpenseSortKey; dir: 'asc' | 'desc' };
  page: number;
  pageSize: number;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeFinanceExpensePage(
  value: unknown
): FinanceExpensePage {
  const result =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const summary =
    result.summary && typeof result.summary === 'object'
      ? (result.summary as Record<string, unknown>)
      : {};
  const facets =
    result.facets && typeof result.facets === 'object'
      ? (result.facets as Record<string, unknown>)
      : {};
  const analysis =
    result.analysis && typeof result.analysis === 'object'
      ? (result.analysis as Record<string, unknown>)
      : {};

  return {
    rows: Array.isArray(result.rows)
      ? (result.rows as FinanceExpenseRow[])
      : [],
    summary: {
      count: number(summary.count),
      postedCount: number(summary.postedCount),
      postedAmount: number(summary.postedAmount),
      recurringCount: number(summary.recurringCount),
      recurringAmount: number(summary.recurringAmount),
      oneTimeCount: number(summary.oneTimeCount),
      oneTimeAmount: number(summary.oneTimeAmount),
      voidedCount: number(summary.voidedCount),
      voidedAmount: number(summary.voidedAmount),
    },
    facets: {
      all: number(facets.all),
      recurring: number(facets.recurring),
      one_time: number(facets.oneTime),
    },
    analysis: {
      dailyTrend: Array.isArray(analysis.dailyTrend)
        ? analysis.dailyTrend.map((point) => {
            const row =
              point && typeof point === 'object'
                ? (point as Record<string, unknown>)
                : {};
            return {
              date: String(row.date ?? ''),
              amount: number(row.amount),
            };
          })
        : [],
      categoryTotals: Array.isArray(analysis.categoryTotals)
        ? analysis.categoryTotals.map((total) => {
            const row =
              total && typeof total === 'object'
                ? (total as Record<string, unknown>)
                : {};
            return {
              categoryId: String(row.categoryId ?? ''),
              categoryName: String(row.categoryName ?? ''),
              count: number(row.count),
              amount: number(row.amount),
            };
          })
        : [],
    },
  };
}

export function financeExpenseDailyTrend(
  month: string,
  points: FinanceExpenseTrendPoint[]
): FinanceExpenseTrendPoint[] {
  const period = financeMonthRange(month);
  const amountByDate = new Map(
    points.map((point) => [point.date, number(point.amount)])
  );
  const result: FinanceExpenseTrendPoint[] = [];
  for (
    let date = period.start;
    date <= period.end;
    date = istAddDays(date, 1)
  ) {
    result.push({ date, amount: amountByDate.get(date) ?? 0 });
  }
  return result;
}

function expenseBounds(query: Pick<FinanceExpenseQuery, 'month' | 'filters'>): {
  start: string;
  end: string;
} {
  const month = financeMonthRange(query.month);
  const start = query.filters.occurredFrom || month.start;
  const inclusiveEnd = query.filters.occurredTo || month.end;
  return { start, end: istAddDays(inclusiveEnd, 1) };
}

export async function loadFinanceExpenses(
  db: SupabaseClient,
  query: FinanceExpenseQuery
): Promise<FinanceExpensePage> {
  const bounds = expenseBounds(query);
  const { data, error } = await db.rpc('finance_expense_ledger', {
    p_start: bounds.start,
    p_end: bounds.end,
    p_search: query.search.trim() || null,
    p_category_ids: query.filters.categoryIds.length
      ? query.filters.categoryIds
      : null,
    p_methods: query.filters.methods.length ? query.filters.methods : null,
    p_statuses: query.filters.statuses.length ? query.filters.statuses : null,
    p_recorded_by: query.filters.recordedBy.length
      ? query.filters.recordedBy
      : null,
    p_view: query.quickView,
    p_sort: query.sort.key,
    p_direction: query.sort.dir,
    p_offset: Math.max(0, (query.page - 1) * query.pageSize),
    p_limit: query.pageSize,
  });
  if (error) throw error;
  return normalizeFinanceExpensePage(data);
}

export async function loadAllFinanceExpenses(
  db: SupabaseClient,
  query: Omit<FinanceExpenseQuery, 'page' | 'pageSize'>
): Promise<FinanceExpenseRow[]> {
  const rows: FinanceExpenseRow[] = [];
  const pageSize = 500;
  for (let page = 1; ; page += 1) {
    const result = await loadFinanceExpenses(db, {
      ...query,
      page,
      pageSize,
    });
    rows.push(...result.rows);
    if (result.rows.length < pageSize) return rows;
  }
}

export async function loadExpenseCategories(
  db: SupabaseClient,
  includeArchived = false
): Promise<ExpenseCategory[]> {
  let request = db
    .from('expense_categories')
    .select(
      'id, account_id, name, is_active, sort_order, created_at, updated_at'
    )
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (!includeArchived) request = request.eq('is_active', true);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as ExpenseCategory[];
}

export function financeExpenseReference(id: string): string {
  return `#${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

function csvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? '');
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function financeExpensesCsv(
  rows: FinanceExpenseRow[],
  formatDate: (value: string) => string
): string {
  const lines: Array<Array<string | number>> = [
    [
      'Expense',
      'Description',
      'Date',
      'Category',
      'Payment method',
      'Type',
      'Amount',
      'Status',
      'Recorded by',
      'Void reason',
    ],
    ...rows.map((row) => [
      row.reference,
      row.description,
      formatDate(row.occurred_on),
      row.category_name,
      row.method,
      row.expense_kind === 'recurring' ? 'Recurring' : 'One-time',
      row.amount,
      row.status === 'void' ? 'Voided' : 'Posted',
      row.recorded_by_name?.trim() || 'Staff',
      row.void_reason ?? '',
    ]),
  ];
  return `\uFEFF${lines
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\r\n')}\r\n`;
}
