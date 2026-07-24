import { describe, expect, it } from 'vitest';

import type { Membership, MembershipPeriodInvoice } from '@/types';
import {
  EMPTY_FINANCE_INVOICE_FILTERS,
  filterFinanceInvoices,
  financeInvoiceLifecycle,
  financeInvoiceReference,
  financeInvoicesCsv,
  financeInvoiceSummary,
  normalizeFinanceInvoiceRows,
} from './invoices';

const TODAY = '2026-07-23';

function invoice(
  overrides: Partial<MembershipPeriodInvoice> = {}
): MembershipPeriodInvoice {
  return {
    id: '12345678-1234-1234-1234-123456789abc',
    account_id: 'account-1',
    membership_id: 'membership-1',
    contact_id: 'contact-1',
    plan_id: 'plan-1',
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    fee_amount: 2_000,
    state: 'open',
    created_at: '2026-07-01T06:00:00.000Z',
    amount_paid: 500,
    balance: 1_500,
    ...overrides,
  };
}

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 'membership-1',
    account_id: 'account-1',
    contact_id: 'contact-1',
    member_number: 1001,
    user_id: 'user-1',
    plan_id: 'plan-1',
    start_date: '2026-07-01',
    end_date: '2026-07-31',
    status: 'active',
    fee_amount: 2_000,
    fee_status: 'due',
    collection_mode: 'manual',
    created_at: '2026-07-01T06:00:00.000Z',
    updated_at: '2026-07-01T06:00:00.000Z',
    contact: {
      id: 'contact-1',
      account_id: 'account-1',
      user_id: 'user-1',
      name: 'Aarav Shah',
      phone: '9876543210',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    plan: {
      id: 'plan-1',
      account_id: 'account-1',
      name: 'Strength',
      price: 2_000,
      duration_days: 30,
      plan_type: 'recurring',
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('finance invoice identity and lifecycle', () => {
  it('uses a stable internal reference without claiming a document number', () => {
    expect(financeInvoiceReference(invoice().id)).toBe('#12345678');
  });

  it('derives void, upcoming, current, and past from persisted facts', () => {
    expect(
      financeInvoiceLifecycle(invoice({ state: 'void' }), '2026-07-31', TODAY)
    ).toBe('void');
    expect(
      financeInvoiceLifecycle(
        invoice({ period_start: '2026-08-01' }),
        '2026-08-31',
        TODAY
      )
    ).toBe('upcoming');
    expect(financeInvoiceLifecycle(invoice(), '2026-07-31', TODAY)).toBe(
      'current'
    );
    expect(financeInvoiceLifecycle(invoice(), '2026-08-31', TODAY)).toBe(
      'past'
    );
  });
});

describe('finance invoice filtering and totals', () => {
  const rows = normalizeFinanceInvoiceRows(
    [
      invoice(),
      invoice({
        id: 'aaaaaaaa-1234-1234-1234-123456789abc',
        membership_id: 'membership-2',
        contact_id: 'contact-2',
        plan_id: 'plan-2',
        period_end: '2026-06-30',
        fee_amount: 3_000,
        amount_paid: 3_000,
        balance: 0,
      }),
      invoice({
        id: 'bbbbbbbb-1234-1234-1234-123456789abc',
        state: 'void',
        fee_amount: 4_000,
        amount_paid: 0,
        balance: 4_000,
      }),
    ],
    [
      membership(),
      membership({
        id: 'membership-2',
        contact_id: 'contact-2',
        member_number: 1002,
        plan_id: 'plan-2',
        end_date: '2026-07-31',
        contact: {
          ...membership().contact!,
          id: 'contact-2',
          name: 'Meera Rao',
        },
        plan: {
          ...membership().plan!,
          id: 'plan-2',
          name: 'Yoga',
        },
      }),
    ],
    TODAY
  );

  it('searches reference, member identity, phone, and Member ID', () => {
    for (const [search, expected] of [
      ['#1234', 1],
      ['aarav', 2],
      ['987654', 3],
      ['1001', 2],
      ['1002', 1],
    ] as const) {
      expect(
        filterFinanceInvoices(rows, {
          search,
          lifecycle: 'all',
          filters: EMPTY_FINANCE_INVOICE_FILTERS,
          sort: { key: 'issued_on', dir: 'desc' },
        })
      ).toHaveLength(expected);
    }
  });

  it('applies payment and lifecycle filters and sorts by amount', () => {
    const result = filterFinanceInvoices(rows, {
      search: '',
      lifecycle: 'past',
      filters: {
        ...EMPTY_FINANCE_INVOICE_FILTERS,
        paymentStates: ['paid'],
      },
      sort: { key: 'total', dir: 'desc' },
    });
    expect(result.map((row) => row.reference)).toEqual(['#AAAAAAAA']);
  });

  it('sorts by the dedicated Member ID column', () => {
    const result = filterFinanceInvoices(rows, {
      search: '',
      lifecycle: 'all',
      filters: EMPTY_FINANCE_INVOICE_FILTERS,
      sort: { key: 'member_id', dir: 'asc' },
    });

    expect(result.map((row) => row.membership?.member_number)).toEqual([
      1001, 1001, 1002,
    ]);
  });

  it('excludes void rows from money totals while preserving their count', () => {
    expect(financeInvoiceSummary(rows)).toEqual({
      count: 3,
      invoiced: 5_000,
      collected: 3_500,
      outstanding: 1_500,
      overdue: 0,
    });
  });

  it('counts a due current-pointer period as overdue after its end date', () => {
    const [row] = normalizeFinanceInvoiceRows(
      [
        invoice({
          period_start: '2026-06-01',
          period_end: '2026-06-30',
        }),
      ],
      [
        membership({
          start_date: '2026-06-01',
          end_date: '2026-06-30',
        }),
      ],
      TODAY
    );

    expect(row.lifecycle).toBe('current');
    expect(row.overdue).toBe(true);
    expect(financeInvoiceSummary([row]).overdue).toBe(1);
  });

  it('exports the internal record reference and reconciled values', () => {
    const csv = financeInvoicesCsv(rows);
    expect(csv).toContain('Invoice record,Member ID,Name');
    expect(csv).toContain('#12345678,1001,Aarav Shah');
    expect(csv).not.toContain('Invoice number');
  });
});
