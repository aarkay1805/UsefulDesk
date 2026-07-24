import { describe, expect, it } from 'vitest';

import type { FinanceExpenseRow } from './expenses';
import {
  financeExpenseDailyTrend,
  financeExpenseReference,
  financeExpensesCsv,
  normalizeFinanceExpensePage,
} from './expenses';

function expense(
  overrides: Partial<FinanceExpenseRow> = {}
): FinanceExpenseRow {
  return {
    id: '12345678-1234-1234-1234-123456789abc',
    account_id: 'account-1',
    occurred_on: '2026-07-23',
    amount: 18_500,
    description: 'July studio rent',
    category_id: 'category-1',
    category_name: 'Rent',
    method: 'bank',
    expense_kind: 'recurring',
    receipt_path: null,
    receipt_bucket: null,
    recorded_by: 'user-1',
    recorded_by_name: 'Riya Singh',
    status: 'posted',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    idempotency_key: 'operation-1',
    created_at: '2026-07-23T06:00:00.000Z',
    updated_at: '2026-07-23T06:00:00.000Z',
    reference: '#12345678',
    ...overrides,
  };
}

describe('finance expense normalization', () => {
  it('normalizes numeric RPC values and facets', () => {
    const result = normalizeFinanceExpensePage({
      rows: [expense()],
      summary: {
        count: '2',
        postedCount: '1',
        postedAmount: '18500',
        voidedCount: '1',
        voidedAmount: '500',
        recurringCount: '1',
        recurringAmount: '18500',
        oneTimeCount: '1',
        oneTimeAmount: '0',
      },
      facets: { all: '2', recurring: '1', oneTime: '1' },
      analysis: {
        dailyTrend: [{ date: '2026-07-23', amount: '18500' }],
        categoryTotals: [
          {
            categoryId: 'category-1',
            categoryName: 'Rent',
            count: '1',
            amount: '18500',
          },
        ],
      },
    });

    expect(result.summary).toEqual({
      count: 2,
      postedCount: 1,
      postedAmount: 18_500,
      voidedCount: 1,
      voidedAmount: 500,
      recurringCount: 1,
      recurringAmount: 18_500,
      oneTimeCount: 1,
      oneTimeAmount: 0,
    });
    expect(result.facets.one_time).toBe(1);
    expect(result.analysis.dailyTrend).toEqual([
      { date: '2026-07-23', amount: 18_500 },
    ]);
    expect(result.analysis.categoryTotals[0]).toEqual({
      categoryId: 'category-1',
      categoryName: 'Rent',
      count: 1,
      amount: 18_500,
    });
  });

  it('returns safe empty values for a missing RPC body', () => {
    expect(normalizeFinanceExpensePage(null)).toEqual({
      rows: [],
      summary: {
        count: 0,
        postedCount: 0,
        postedAmount: 0,
        voidedCount: 0,
        voidedAmount: 0,
        recurringCount: 0,
        recurringAmount: 0,
        oneTimeCount: 0,
        oneTimeAmount: 0,
      },
      facets: { all: 0, recurring: 0, one_time: 0 },
      analysis: { dailyTrend: [], categoryTotals: [] },
    });
  });

  it('fills absent days so the month trend keeps a stable axis', () => {
    const trend = financeExpenseDailyTrend('2026-02', [
      { date: '2026-02-14', amount: 900 },
    ]);
    expect(trend).toHaveLength(28);
    expect(trend[0]).toEqual({ date: '2026-02-01', amount: 0 });
    expect(trend[13]).toEqual({ date: '2026-02-14', amount: 900 });
    expect(trend[27]).toEqual({ date: '2026-02-28', amount: 0 });
  });
});

describe('finance expense identity and export', () => {
  it('uses a stable internal expense reference', () => {
    expect(financeExpenseReference(expense().id)).toBe('#12345678');
  });

  it('exports audit and financial context without private paths', () => {
    const csv = financeExpensesCsv(
      [expense({ description: 'Rent, July' })],
      () => '23 Jul 2026'
    );
    expect(csv).toContain(
      'Expense,Description,Date,Category,Payment method,Type'
    );
    expect(csv).toContain(
      '#12345678,\"Rent, July\",23 Jul 2026,Rent,bank,Recurring'
    );
    expect(csv).not.toContain('receipt_path');
  });
});
