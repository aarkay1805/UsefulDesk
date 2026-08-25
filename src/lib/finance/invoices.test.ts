import { describe, expect, it } from 'vitest';

import type { Contact, Membership, MembershipPeriodInvoice } from '@/types';
import {
  EMPTY_FINANCE_INVOICE_FILTERS,
  filterFinanceInvoices,
  financeInvoiceMatchesQueue,
  financeInvoiceLifecycle,
  financeInvoiceReference,
  financeInvoicesCsv,
  financeInvoiceSummary,
  groupInvoiceLines,
  invoiceItemsLabel,
  invoiceSourceLabel,
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
    invoice_sequence: null,
    invoice_number: null,
    seller_snapshot: null,
    customer_snapshot: null,
    identity_snapshot_version: null,
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
  it('prefers the human invoice number, retaining a UUID fallback for legacy rows', () => {
    expect(
      financeInvoiceReference(invoice({ invoice_number: 'INV-000123' }))
    ).toBe('INV-000123');
    expect(financeInvoiceReference(invoice())).toBe('#12345678');
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

describe('invoice-first member billing helpers', () => {
  it('uses owner-facing source labels', () => {
    expect(invoiceSourceLabel('joining')).toBe('Joining');
    expect(invoiceSourceLabel('membership_renewal')).toBe('Membership renewal');
    expect(invoiceSourceLabel('service_adjustment')).toBe('Service adjustment');
  });

  it('summarizes every line in one combined invoice label', () => {
    expect(
      invoiceItemsLabel([
        { description: 'Competition', quantity: 1 },
        { description: 'Personal training', quantity: 1 },
        { description: 'Protein shake', quantity: 2 },
      ])
    ).toBe('Competition + Personal training + Protein shake × 2');
  });

  it('groups membership and service lines under one invoice record', () => {
    const grouped = groupInvoiceLines([
      { invoice_id: 'combined', description: 'Membership' },
      { invoice_id: 'combined', description: 'Personal training' },
      { invoice_id: 'sale', description: 'Gloves' },
    ]);

    expect(grouped.get('combined')?.map((line) => line.description)).toEqual([
      'Membership',
      'Personal training',
    ]);
    expect(grouped.get('sale')?.map((line) => line.description)).toEqual([
      'Gloves',
    ]);
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

  it('searches the human invoice number, member identity, phone, and Member ID', () => {
    const numberedRows = normalizeFinanceInvoiceRows(
      [invoice({ invoice_number: 'INV-000123' })],
      [membership()],
      TODAY
    );
    expect(
      filterFinanceInvoices(numberedRows, {
        search: 'inv-000123',
        lifecycle: 'all',
        filters: EMPTY_FINANCE_INVOICE_FILTERS,
        sort: { key: 'issued_on', dir: 'desc' },
      })
    ).toHaveLength(1);

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

  it('sorts persisted invoice sequences numerically across the display rollover', () => {
    const numberedRows = normalizeFinanceInvoiceRows(
      [
        invoice({
          id: 'aaaaaaaa-1234-1234-1234-123456789abc',
          invoice_sequence: 999_999,
          invoice_number: 'INV-999999',
        }),
        invoice({
          id: 'bbbbbbbb-1234-1234-1234-123456789abc',
          invoice_sequence: 1_000_000,
          invoice_number: 'INV-1000000',
        }),
      ],
      [membership()],
      TODAY
    );

    for (const [dir, expected] of [
      ['asc', ['INV-999999', 'INV-1000000']],
      ['desc', ['INV-1000000', 'INV-999999']],
    ] as const) {
      expect(
        filterFinanceInvoices(numberedRows, {
          search: '',
          lifecycle: 'all',
          filters: EMPTY_FINANCE_INVOICE_FILTERS,
          sort: { key: 'reference', dir },
        }).map((row) => row.reference)
      ).toEqual(expected);
    }
  });

  it('uses reference ordering whenever either invoice lacks a persisted sequence', () => {
    const mixedRows = normalizeFinanceInvoiceRows(
      [
        invoice({
          id: 'cccccccc-1234-1234-1234-123456789abc',
          invoice_sequence: 10,
          invoice_number: 'INV-000010',
        }),
        invoice({
          id: 'bbbbbbbb-1234-1234-1234-123456789abc',
          invoice_sequence: null,
          invoice_number: null,
        }),
        invoice({
          id: 'aaaaaaaa-1234-1234-1234-123456789abc',
          invoice_sequence: null,
          invoice_number: null,
        }),
      ],
      [membership()],
      TODAY
    );

    for (const [dir, expected] of [
      ['asc', ['#AAAAAAAA', '#BBBBBBBB', 'INV-000010']],
      ['desc', ['INV-000010', '#BBBBBBBB', '#AAAAAAAA']],
    ] as const) {
      expect(
        filterFinanceInvoices(mixedRows, {
          search: '',
          lifecycle: 'all',
          filters: EMPTY_FINANCE_INVOICE_FILTERS,
          sort: { key: 'reference', dir },
        }).map((row) => row.reference)
      ).toEqual(expected);
    }
  });

  it('groups invoices into action-first queues without hiding review cases', () => {
    const [due, paid, voided] = rows;
    const review = {
      ...paid,
      requires_refund_review: true,
    };

    expect(financeInvoiceMatchesQueue(due, 'attention')).toBe(true);
    expect(financeInvoiceMatchesQueue(paid, 'paid')).toBe(true);
    expect(financeInvoiceMatchesQueue(voided, 'void')).toBe(true);
    expect(financeInvoiceMatchesQueue(review, 'attention')).toBe(true);
    expect(financeInvoiceMatchesQueue(review, 'paid')).toBe(false);
    expect(financeInvoiceMatchesQueue(voided, 'paid')).toBe(false);
  });

  it('keeps standalone sale customers searchable without a membership', () => {
    const contact: Contact = {
      id: 'contact-sale',
      account_id: 'account-1',
      user_id: 'user-1',
      name: 'Walk-in Customer',
      phone: '9000012345',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
    };
    const standalone = normalizeFinanceInvoiceRows(
      [
        invoice({
          membership_id: '',
          contact_id: contact.id,
          plan_id: null,
        }),
      ],
      [],
      TODAY,
      [contact]
    );

    expect(standalone[0].contact?.name).toBe('Walk-in Customer');
    expect(
      filterFinanceInvoices(standalone, {
        search: '900001',
        lifecycle: 'all',
        filters: EMPTY_FINANCE_INVOICE_FILTERS,
        sort: { key: 'issued_on', dir: 'desc' },
      })
    ).toHaveLength(1);
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
      grossInvoiced: 5_000,
      adjustments: 0,
      invoiced: 5_000,
      grossCollected: 3_500,
      refunds: 0,
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

  it('exports the human invoice number and reconciled values', () => {
    const csv = financeInvoicesCsv([
      {
        ...rows[0],
        source: 'sale',
        invoice_number: 'INV-000123',
        reference: 'INV-000123',
        lineKinds: ['service', 'merchandise'],
        credit_applied: 250,
      },
      ...rows.slice(1),
    ]);
    expect(csv).toContain('Invoice number,Member ID,Name');
    expect(csv).toContain('INV-000123,1001,Aarav Shah');
    expect(csv).toContain('Invoice source,Revenue categories');
    expect(csv).toContain('sale,service + merchandise');
    expect(csv).toContain(
      'Gross collected,Processed refunds,Net collected,Credit applied'
    );
    expect(csv).toContain(
      'Gateway payment IDs,Gateway refund IDs,Refund dispositions'
    );
  });

  it('exports paise-exact net totals after a partial refund adjustment', () => {
    const csv = financeInvoicesCsv([
      {
        ...rows[0],
        fee_amount: 1.01,
        invoice_adjustment_amount: 1,
        gross_amount_paid: 1.01,
        processed_refund_amount: 1,
        amount_paid: 0.01,
        accounting_balance: 0,
        collectible_balance: 0,
        requires_refund_review: false,
        gatewayPaymentIds: ['pay_test'],
        gatewayRefundIds: ['rfnd_test'],
        refundDispositions: ['reduce_charge'],
      },
    ]);

    expect(csv).toContain(',1.01,1,0.01,1.01,1,0.01,0,0,0,No,');
    expect(csv).not.toContain('0.010000000000000009');
  });
});
