import { describe, expect, it } from 'vitest';

import type { PaymentRefund } from '@/types';
import {
  invoiceHeadline,
  invoiceSummaryRows,
  paymentRefundEventAt,
  paymentRefundOutcome,
} from './invoice-detail-presentation';

function invoice(patch: Partial<Parameters<typeof invoiceHeadline>[0]> = {}) {
  return {
    state: 'open' as const,
    fee_amount: 100,
    amount_paid: 0,
    balance: 100,
    ...patch,
  };
}

function refund(patch: Partial<PaymentRefund> = {}): PaymentRefund {
  return {
    id: 'refund-1',
    payment_id: 'payment-1',
    invoice_id: 'invoice-1',
    gateway_refund_id: 'rfnd_123',
    amount: 100,
    currency: 'INR',
    source: 'usefuldesk',
    disposition: null,
    reason: null,
    status: 'pending',
    requested_by: 'user-1',
    requested_at: '2026-08-10T10:00:00.000Z',
    processed_at: null,
    failed_at: null,
    provider_created_at: null,
    created_at: '2026-08-10T10:00:00.000Z',
    allocation_complete: true,
    ...patch,
  };
}

describe('invoice detail presentation', () => {
  it.each([
    {
      name: 'unpaid invoice',
      input: invoice(),
      headline: ['Balance due', 100, 'balance_due'],
      rows: ['invoice_total', 'balance'],
    },
    {
      name: 'part-paid invoice',
      input: invoice({ amount_paid: 40, gross_amount_paid: 40, balance: 60 }),
      headline: ['Balance due', 60, 'balance_due'],
      rows: ['invoice_total', 'collection', 'balance'],
    },
    {
      name: 'paid invoice',
      input: invoice({ amount_paid: 100, balance: 0 }),
      headline: ['Paid in full', 100, 'settled'],
      rows: ['invoice_total', 'collection', 'balance'],
    },
    {
      name: 'no-charge invoice',
      input: invoice({ fee_amount: 0, balance: 0 }),
      headline: ['Invoice total', 0, 'nothing_to_collect'],
      rows: ['invoice_total', 'balance'],
    },
    {
      name: 'void invoice',
      input: invoice({ state: 'void' }),
      headline: ['Invoice total', 100, 'void'],
      rows: ['invoice_total', 'balance'],
    },
    {
      name: 'refund review invoice',
      input: invoice({
        balance: 0,
        accounting_balance: 35,
        requires_refund_review: true,
      }),
      headline: ['Accounting balance', 35, 'refund_review'],
      rows: ['invoice_total', 'balance'],
    },
  ])('covers the $name state', ({ input, headline, rows }) => {
    expect(Object.values(invoiceHeadline(input))).toEqual(headline);
    expect(invoiceSummaryRows(input).map((row) => row.key)).toEqual(rows);
  });

  it('compresses a reopened refund into net collection with an audit breakdown', () => {
    const input = invoice({
      amount_paid: 0,
      gross_amount_paid: 100,
      processed_refund_amount: 100,
      balance: 100,
    });

    expect(invoiceHeadline(input).detail).toBe('balance_reopened');
    expect(invoiceSummaryRows(input)).toEqual([
      { key: 'invoice_total', label: 'Invoice total', amount: 100 },
      {
        key: 'collection',
        label: 'Net collected',
        amount: 0,
        collectionBreakdown: { gross: 100, refunded: 100 },
      },
      {
        key: 'balance',
        label: 'Balance due',
        amount: 100,
        emphasis: true,
        warning: true,
      },
    ]);
  });

  it('shows adjustments and credit as deductions before the final balance', () => {
    expect(
      invoiceSummaryRows(
        invoice({
          invoice_adjustment_amount: 20,
          credit_applied: 30,
          amount_paid: 50,
          balance: 0,
        })
      ).map(({ key, sign }) => [key, sign])
    ).toEqual([
      ['invoice_total', undefined],
      ['invoice_adjustment', 'minus'],
      ['credit_applied', 'minus'],
      ['collection', undefined],
      ['balance', undefined],
    ]);
  });
});

describe('refund event presentation', () => {
  it.each([
    ['reopen_balance', 'Balance reopened'],
    ['reduce_charge', 'Charge reduced'],
  ] as const)('names the %s accounting outcome', (disposition, label) => {
    expect(
      paymentRefundOutcome(refund({ status: 'processed', disposition }))
    ).toBe(label);
  });

  it.each([
    [{ status: 'creating' as const }, 'Sending to Razorpay'],
    [{ status: 'pending' as const }, 'Awaiting Razorpay'],
    [{ status: 'failed' as const }, 'No balance changed'],
    [{ status: 'orphaned' as const }, 'Manual review required'],
    [
      { status: 'processed' as const, allocation_complete: true },
      'Classification required',
    ],
    [
      { status: 'processed' as const, allocation_complete: false },
      'Line targeting required',
    ],
  ])('describes the non-terminal or unresolved state', (patch, label) => {
    expect(paymentRefundOutcome(refund(patch))).toBe(label);
  });

  it('uses the terminal event timestamp when one exists', () => {
    expect(
      paymentRefundEventAt(
        refund({
          status: 'processed',
          processed_at: '2026-08-11T09:30:00.000Z',
        })
      )
    ).toBe('2026-08-11T09:30:00.000Z');
    expect(
      paymentRefundEventAt(
        refund({
          status: 'failed',
          failed_at: '2026-08-12T09:30:00.000Z',
        })
      )
    ).toBe('2026-08-12T09:30:00.000Z');
  });
});
