import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  alignFinanceCashFlowTrends,
  financeCashFlowHasMovement,
  financeComparisonThroughDay,
  loadFinanceExpenseTotals,
  financeMonthRange,
  financeOverviewCsv,
  financeYearOptions,
  normalizeFinanceAdPerformance,
  shiftFinanceMonth,
  summarizeFinanceCashFlow,
  summarizeFinanceExpenses,
  summarizeFinanceRevenue,
  summarizeFinanceRevenueStreams,
  type FinanceOverviewData,
  type FinanceRevenueStreamPaymentRow,
} from './overview';

function revenuePayment(
  overrides: Partial<FinanceRevenueStreamPaymentRow> = {}
): FinanceRevenueStreamPaymentRow {
  return {
    id: 'payment-1',
    membership_id: 'membership-1',
    amount: 4_000,
    payment_purpose: 'joining',
    status: 'paid',
    paid_at: '2026-07-20T10:00:00Z',
    period_end: '2026-08-19',
    method: 'upi',
    source: 'manual',
    contact: {
      name: 'Aarav Shah',
      avatar_url: undefined,
    },
    plan: { name: 'Gold' },
    membership: { member_number: 1001, start_date: '2026-07-20' },
    ...overrides,
  };
}

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

  it('lists years from the account creation year through the current year', () => {
    expect(
      financeYearOptions('2026-07', '2023-11-18T10:00:00Z', '2026-07')
    ).toEqual(['2026', '2025', '2024', '2023']);
  });

  it('keeps a historical deep-linked year available', () => {
    expect(
      financeYearOptions('2026-07', '2023-11-18T10:00:00Z', '2021-04')
    ).toEqual(['2026', '2025', '2024', '2023', '2022', '2021']);
  });
});

describe('Finance revenue attribution', () => {
  it('keeps payment purposes mutually exclusive and excludes void payments', () => {
    expect(
      summarizeFinanceRevenue([
        { amount: 4_000, payment_purpose: 'joining', status: 'paid' },
        { amount: 3_000, payment_purpose: 'renewal', status: 'paid' },
        { amount: 750, payment_purpose: 'sale', status: 'paid' },
        { amount: 2_000, payment_purpose: 'due', status: 'paid' },
        { amount: 500, payment_purpose: 'other', status: 'paid' },
        { amount: 9_000, payment_purpose: 'joining', status: 'void' },
      ])
    ).toEqual({
      joining: 4_000,
      renewal: 3_000,
      sale: 750,
      due: 2_000,
      other: 500,
    });
  });

  it('normalizes numeric ad metrics and preserves unavailable ratios', () => {
    expect(
      normalizeFinanceAdPerformance({
        adSpend: '1000',
        leads: '10',
        convertedMembers: '4',
        joiningRevenue: '6000',
        conversionRate: '40.0',
        returnOnAdSpend: null,
      })
    ).toEqual({
      adSpend: 1_000,
      leads: 10,
      convertedMembers: 4,
      joiningRevenue: 6_000,
      conversionRate: 40,
      returnOnAdSpend: null,
    });
  });

  it('keeps the five latest contributing payments inside each stream', () => {
    expect(
      summarizeFinanceRevenueStreams([
        revenuePayment(),
        revenuePayment({
          id: 'payment-2',
          amount: 2_000,
          paid_at: '2026-07-22T10:00:00Z',
          plan: { name: 'Silver' },
        }),
        revenuePayment({
          id: 'payment-3',
          amount: 1_000,
          paid_at: '2026-07-21T10:00:00Z',
        }),
        revenuePayment({
          id: 'payment-4',
          amount: 3_000,
          payment_purpose: 'renewal',
          paid_at: '2026-07-23T10:00:00Z',
          plan: null,
        }),
        revenuePayment({
          id: 'payment-5',
          amount: 9_000,
          status: 'void',
        }),
      ])
    ).toEqual([
      {
        purpose: 'joining',
        payments: 3,
        amount: 7_000,
        recentPayments: [
          expect.objectContaining({
            id: 'payment-2',
            planName: 'Silver',
            amount: 2_000,
          }),
          expect.objectContaining({ id: 'payment-3', amount: 1_000 }),
          expect.objectContaining({
            id: 'payment-1',
            memberNumber: 1001,
            contactName: 'Aarav Shah',
            amount: 4_000,
          }),
        ],
      },
      {
        purpose: 'renewal',
        payments: 1,
        amount: 3_000,
        recentPayments: [
          expect.objectContaining({
            id: 'payment-4',
            planName: null,
            amount: 3_000,
          }),
        ],
      },
      { purpose: 'sale', payments: 0, amount: 0, recentPayments: [] },
      { purpose: 'due', payments: 0, amount: 0, recentPayments: [] },
      { purpose: 'other', payments: 0, amount: 0, recentPayments: [] },
    ]);
  });
});

describe('summarizeFinanceExpenses', () => {
  it('tracks posted current and previous expenses while excluding void rows', () => {
    const period = financeMonthRange('2026-07');
    const summary = summarizeFinanceExpenses(
      [
        {
          id: 'current-1',
          occurred_on: '2026-07-15',
          amount: 12000,
          description: 'Rent',
          method: 'bank',
          status: 'posted',
          created_at: '2026-07-15T09:00:00Z',
        },
        {
          id: 'current-2',
          occurred_on: '2026-07-15',
          amount: 1500,
          description: 'Cleaning',
          method: 'cash',
          status: 'posted',
          created_at: '2026-07-15T10:00:00Z',
        },
        {
          id: 'previous',
          occurred_on: '2026-06-20',
          amount: 5000,
          description: 'Marketing',
          method: 'upi',
          status: 'posted',
          created_at: '2026-06-20T10:00:00Z',
        },
        {
          id: 'void',
          occurred_on: '2026-07-21',
          amount: 9000,
          description: 'Voided equipment entry',
          method: 'card',
          status: 'void',
          created_at: '2026-07-21T10:00:00Z',
        },
      ],
      period
    );

    expect(summary.current).toBe(13500);
    expect(summary.previous).toBe(5000);
    expect(summary.daily).toEqual([{ date: '2026-07-15', amount: 13500 }]);
    expect(summary.previousDaily).toEqual([
      { date: '2026-06-20', amount: 5000 },
    ]);
    expect(summary.transactions.map((transaction) => transaction.id)).toEqual([
      'current-2',
      'current-1',
    ]);
    expect(summary.transactions[0].method).toBe('cash');
    expect(summary.transactions[1].method).toBe('bank_other');
  });
});

describe('loadFinanceExpenseTotals', () => {
  it('loads the previous and selected calendar months and totals posted rows', async () => {
    const rows = [
      {
        id: 'previous',
        occurred_on: '2026-06-30',
        amount: 700,
        description: 'June supplies',
        method: 'cash',
        status: 'posted',
        created_at: '2026-06-30T08:00:00Z',
      },
      {
        id: 'current',
        occurred_on: '2026-07-01',
        amount: 1500,
        description: 'July utilities',
        method: 'bank',
        status: 'posted',
        created_at: '2026-07-01T08:00:00Z',
      },
      {
        id: 'void',
        occurred_on: '2026-07-10',
        amount: 9000,
        description: 'Voided entry',
        method: 'card',
        status: 'void',
        created_at: '2026-07-10T08:00:00Z',
      },
    ];
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      lt: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.lt.mockResolvedValue({ data: rows, error: null });
    const db = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;

    await expect(loadFinanceExpenseTotals(db, '2026-07')).resolves.toEqual({
      current: 1500,
      previous: 700,
    });
    expect(db.from).toHaveBeenCalledWith('expenses');
    expect(query.eq).toHaveBeenCalledWith('status', 'posted');
    expect(query.gte).toHaveBeenCalledWith('occurred_on', '2026-06-01');
    expect(query.lt).toHaveBeenCalledWith('occurred_on', '2026-08-01');
  });
});

describe('Finance cash-flow comparison', () => {
  it('aggregates paid income and posted expenses into current and previous daily movement', () => {
    const result = summarizeFinanceCashFlow(
      [
        {
          paid_at: '2026-07-08T04:30:00Z',
          amount: 4000,
          status: 'paid',
        },
        {
          paid_at: '2026-06-08T04:30:00Z',
          amount: 3000,
          status: 'paid',
        },
        {
          paid_at: '2026-07-08T05:30:00Z',
          amount: 9000,
          status: 'void',
        },
      ],
      [
        {
          id: 'expense-current',
          occurred_on: '2026-07-08',
          amount: 1200,
          description: 'Utilities',
          method: 'upi',
          status: 'posted',
          created_at: '2026-07-08T06:00:00Z',
        },
        {
          id: 'expense-previous',
          occurred_on: '2026-06-08',
          amount: 800,
          description: 'Cleaning',
          method: 'cash',
          status: 'posted',
          created_at: '2026-06-08T06:00:00Z',
        },
        {
          id: 'expense-void',
          occurred_on: '2026-07-08',
          amount: 5000,
          description: 'Voided',
          method: 'card',
          status: 'void',
          created_at: '2026-07-08T07:00:00Z',
        },
      ],
      financeMonthRange('2026-07'),
      'Asia/Kolkata'
    );

    expect(result.current).toHaveLength(31);
    expect(result.previous).toHaveLength(30);
    expect(result.current[7]).toEqual({
      date: '2026-07-08',
      income: 4000,
      expenses: 1200,
    });
    expect(result.previous[7]).toEqual({
      date: '2026-06-08',
      income: 3000,
      expenses: 800,
    });
  });

  it('groups matching ordinal seven-day buckets without cumulative values', () => {
    const current = summarizeFinanceCashFlow(
      [
        { paid_at: '2026-07-01T06:00:00Z', amount: 100, status: 'paid' },
        { paid_at: '2026-07-08T06:00:00Z', amount: 250, status: 'paid' },
      ],
      [
        {
          id: 'expense-current',
          occurred_on: '2026-07-07',
          amount: 40,
          description: 'Current expense',
          method: 'cash',
          status: 'posted',
          created_at: '2026-07-07T06:00:00Z',
        },
        {
          id: 'expense-previous',
          occurred_on: '2026-06-09',
          amount: 75,
          description: 'Previous expense',
          method: 'upi',
          status: 'posted',
          created_at: '2026-06-09T06:00:00Z',
        },
      ],
      financeMonthRange('2026-07'),
      'UTC'
    );
    const weekly = alignFinanceCashFlowTrends(
      current.current,
      current.previous,
      'weekly'
    );

    expect(weekly[0]).toEqual({
      ordinal: 1,
      currentStart: '2026-07-01',
      currentEnd: '2026-07-07',
      previousStart: '2026-06-01',
      previousEnd: '2026-06-07',
      currentIncome: 100,
      currentExpenses: 40,
      previousIncome: 0,
      previousExpenses: 0,
    });
    expect(weekly[1]).toMatchObject({
      ordinal: 8,
      currentStart: '2026-07-08',
      currentEnd: '2026-07-14',
      previousStart: '2026-06-08',
      previousEnd: '2026-06-14',
      currentIncome: 250,
      currentExpenses: 0,
      previousIncome: 0,
      previousExpenses: 75,
    });
  });

  it('truncates a current-month comparison through the same elapsed local day', () => {
    const flow = summarizeFinanceCashFlow(
      [],
      [],
      financeMonthRange('2026-08'),
      'Asia/Kolkata'
    );
    const throughDay = financeComparisonThroughDay('2026-08', '2026-08-12');
    expect(throughDay).toBe(12);
    expect(financeComparisonThroughDay('2026-07', '2026-08-12')).toBeNull();

    const daily = alignFinanceCashFlowTrends(
      flow.current,
      flow.previous,
      'daily',
      throughDay
    );
    const weekly = alignFinanceCashFlowTrends(
      flow.current,
      flow.previous,
      'weekly',
      throughDay
    );
    expect(daily).toHaveLength(12);
    expect(daily.at(-1)).toMatchObject({
      currentStart: '2026-08-12',
      previousStart: '2026-07-12',
    });
    expect(weekly).toHaveLength(2);
    expect(weekly.at(-1)).toMatchObject({
      currentStart: '2026-08-08',
      currentEnd: '2026-08-12',
      previousStart: '2026-07-08',
      previousEnd: '2026-07-12',
    });
  });

  it.each([
    ['2026-02', 28, 31],
    ['2028-02', 29, 31],
    ['2026-04', 30, 31],
    ['2026-05', 31, 30],
  ])(
    'aligns complete %s and previous months across %i/%i-day lengths',
    (month, currentDays, previousDays) => {
      const flow = summarizeFinanceCashFlow(
        [],
        [],
        financeMonthRange(month),
        'UTC'
      );
      const aligned = alignFinanceCashFlowTrends(
        flow.current,
        flow.previous,
        'daily'
      );

      expect(flow.current).toHaveLength(currentDays);
      expect(flow.previous).toHaveLength(previousDays);
      expect(aligned).toHaveLength(Math.max(currentDays, previousDays));
      expect(aligned.at(-1)?.currentStart === null).toBe(
        currentDays < previousDays
      );
      expect(aligned.at(-1)?.previousStart === null).toBe(
        previousDays < currentDays
      );
    }
  );

  it('assigns payment instants to the account-local day at month boundaries', () => {
    const india = summarizeFinanceCashFlow(
      [
        {
          paid_at: '2026-06-30T18:29:59Z',
          amount: 100,
          status: 'paid',
        },
        {
          paid_at: '2026-06-30T18:30:00Z',
          amount: 200,
          status: 'paid',
        },
      ],
      [],
      financeMonthRange('2026-07'),
      'Asia/Kolkata'
    );
    expect(india.previous.at(-1)?.income).toBe(100);
    expect(india.current[0].income).toBe(200);

    const losAngeles = summarizeFinanceCashFlow(
      [
        {
          paid_at: '2026-07-01T06:59:59Z',
          amount: 300,
          status: 'paid',
        },
        {
          paid_at: '2026-07-01T07:00:00Z',
          amount: 400,
          status: 'paid',
        },
      ],
      [],
      financeMonthRange('2026-07'),
      'America/Los_Angeles'
    );
    expect(losAngeles.previous.at(-1)?.income).toBe(300);
    expect(losAngeles.current[0].income).toBe(400);
  });

  it('reports an empty comparison only when both months have no movement', () => {
    const empty = summarizeFinanceCashFlow(
      [],
      [],
      financeMonthRange('2026-07'),
      'UTC'
    );
    expect(financeCashFlowHasMovement(empty.current, empty.previous)).toBe(
      false
    );

    empty.previous[0].income = 1;
    expect(financeCashFlowHasMovement(empty.current, empty.previous)).toBe(
      true
    );
  });
});

describe('financeOverviewCsv', () => {
  it('exports tracked expense and profit values', () => {
    const data = {
      period: financeMonthRange('2026-07'),
      revenue: { current: 6000, previous: 5000 },
      expenses: { current: 1500, previous: 1000 },
      profit: { current: 4500, previous: 4000 },
      projection: { amount: 4500, renewals: 1 },
      revenueBreakdown: {
        joining: 3000,
        renewal: 2000,
        sale: 0,
        due: 1000,
        other: 0,
      },
      revenueStreams: [],
      trend: [{ date: '2026-07-01', income: 6000, expenses: 1500 }],
      previousTrend: [{ date: '2026-06-01', income: 5000, expenses: 1000 }],
      comparisonThroughDay: null,
      invoiceHealth: {
        paid: 1,
        partiallyPaid: 0,
        overdue: 0,
        open: 0,
        outstanding: 0,
      },
      collectionMethods: [{ method: 'upi', payments: 1, amount: 6000 }],
      recentTransactions: [],
    } satisfies FinanceOverviewData;

    const csv = financeOverviewCsv(data);
    expect(csv).toContain('Business overview,2026-07-01 to 2026-07-31');
    expect(csv).toContain('Expenses,1500,1000');
    expect(csv).toContain('Profit,4500,4000');
    expect(csv).toContain('New memberships,3000');
    expect(csv).not.toContain('Other collections');
    expect(csv).not.toContain('Ad performance');
    expect(csv).toContain(
      'Date,Income,Expenses,Previous date,Previous income,Previous expenses'
    );
    expect(csv).toContain('2026-07-01,6000,1500,2026-06-01,5000,1000');
  });
});
