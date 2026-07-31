import { describe, expect, it } from 'vitest';

import {
  financeMonthRange,
  financeOverviewCsv,
  financeYearOptions,
  normalizeFinanceAdPerformance,
  shiftFinanceMonth,
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
      phone: '9876543210',
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
        { amount: 2_000, payment_purpose: 'due', status: 'paid' },
        { amount: 500, payment_purpose: 'other', status: 'paid' },
        { amount: 9_000, payment_purpose: 'joining', status: 'void' },
      ])
    ).toEqual({ joining: 4_000, renewal: 3_000, due: 2_000, other: 500 });
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
    expect(summary.transactions.map((transaction) => transaction.id)).toEqual([
      'current-2',
      'current-1',
    ]);
    expect(summary.transactions[0].method).toBe('cash');
    expect(summary.transactions[1].method).toBe('bank_other');
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
        due: 1000,
        other: 0,
      },
      revenueStreams: [],
      adPerformance: {
        adSpend: 1500,
        leads: 10,
        convertedMembers: 4,
        joiningRevenue: 3000,
        conversionRate: 40,
        returnOnAdSpend: 2,
      },
      trend: [{ date: '2026-07-01', income: 6000, expenses: 1500 }],
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
    expect(csv).toContain('Expenses,1500,1000');
    expect(csv).toContain('Profit,4500,4000');
    expect(csv).toContain('New memberships,3000');
    expect(csv).not.toContain('Other collections');
    expect(csv).toContain('Converted members to date,4');
    expect(csv).toContain('Return on ad spend,2');
    expect(csv).toContain('2026-07-01,6000,1500');
  });
});
