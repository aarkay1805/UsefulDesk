import { describe, expect, it } from 'vitest';

import {
  financeMonthOptions,
  financeMonthRange,
  financeOverviewCsv,
  shiftFinanceMonth,
  type FinanceOverviewData,
} from './overview';

describe('Finance calendar months', () => {
  it('shifts across year boundaries', () => {
    expect(shiftFinanceMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftFinanceMonth('2026-12', 1)).toBe('2027-01');
  });

  it('builds exact calendar ranges including leap years', () => {
    expect(financeMonthRange('2028-02')).toEqual({
      month: '2028-02',
      start: '2028-02-01',
      end: '2028-02-29',
      nextStart: '2028-03-01',
      previousStart: '2028-01-01',
      previousEnd: '2028-01-31',
    });
  });

  it('lists the current month before older months', () => {
    expect(financeMonthOptions('2026-07', 3)).toEqual([
      '2026-07',
      '2026-06',
      '2026-05',
    ]);
  });
});

describe('financeOverviewCsv', () => {
  it('keeps unavailable expense values blank rather than inventing zeroes', () => {
    const data = {
      period: financeMonthRange('2026-07'),
      revenue: { current: 6000, previous: 5000 },
      expenses: { current: null, previous: null },
      profit: { current: null, previous: null },
      projection: { amount: 4500, renewals: 1 },
      trend: [{ date: '2026-07-01', income: 6000, expenses: null }],
      invoiceHealth: {
        paid: 1,
        partiallyPaid: 0,
        overdue: 0,
        open: 0,
        outstanding: 0,
      },
      collectionMethods: [{ method: 'upi', payments: 1, amount: 6000 }],
      recentTransactions: [],
      expenseTrackingAvailable: false,
    } satisfies FinanceOverviewData;

    const csv = financeOverviewCsv(data);
    expect(csv).toContain('Expenses,,');
    expect(csv).not.toContain('Expenses,0,0');
  });
});
