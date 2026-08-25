import { describe, expect, it } from 'vitest';

import type { PaymentRefund } from '@/types';
import {
  invoiceCollectionActionState,
  invoiceDocumentActionPresentation,
  invoiceHeadline,
  invoiceRefundActionState,
  invoiceSummaryRows,
  invoiceVoidActionState,
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

function payment(patch: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    account_id: 'account-1',
    membership_id: 'membership-1',
    contact_id: 'contact-1',
    plan_id: 'plan-1',
    user_id: 'user-1',
    amount: 100,
    method: 'cash' as const,
    status: 'paid' as const,
    paid_at: '2026-08-10T10:00:00.000Z',
    source: 'manual' as const,
    payment_purpose: 'due' as const,
    created_at: '2026-08-10T10:00:00.000Z',
    ...patch,
  };
}

describe('invoice resolvable action states', () => {
  it('shows an allowed collection action for an open balance', () => {
    expect(invoiceCollectionActionState(invoice(), true)).toEqual({
      show: true,
      pending: false,
      blocker: null,
    });
  });

  it('keeps an accounting balance visible while refund review blocks collection', () => {
    expect(
      invoiceCollectionActionState(
        invoice({
          balance: 0,
          accounting_balance: 35,
          requires_refund_review: true,
        }),
        true
      )
    ).toEqual({ show: true, pending: false, blocker: 'refund_review' });
  });

  it.each([
    invoice({ amount_paid: 100, balance: 0 }),
    invoice({ state: 'void' }),
    invoice({ fee_amount: 0, balance: 0 }),
  ])('hides collection when the invoice is not collectible', (input) => {
    expect(invoiceCollectionActionState(input, false)).toEqual({
      show: false,
      pending: false,
      blocker: null,
    });
  });

  it('uses permission only after collection is otherwise applicable', () => {
    expect(invoiceCollectionActionState(invoice(), false).blocker).toBe(
      'permission'
    );
    expect(
      invoiceCollectionActionState(
        invoice({ amount_paid: 100, balance: 0 }),
        false
      ).blocker
    ).toBeNull();
  });

  it('keeps refund pending while the historical scan is incomplete', () => {
    expect(
      invoiceRefundActionState(
        payment({
          source: 'payment_link',
          gateway_payment_id: 'pay_123',
        }),
        [],
        false,
        true
      )
    ).toEqual({ show: true, pending: true, blocker: null });
  });

  it('hides refund when no refundable capacity remains', () => {
    expect(
      invoiceRefundActionState(
        payment({ source: 'auto', gateway_payment_id: 'pay_123' }),
        [refund({ amount: 100 })],
        true,
        false
      )
    ).toEqual({ show: false, pending: false, blocker: null });
  });

  it('requires line targeting before another refund', () => {
    expect(
      invoiceRefundActionState(
        payment({
          amount: 150,
          source: 'payment_link',
          gateway_payment_id: 'pay_123',
        }),
        [
          refund({
            amount: 50,
            status: 'processed',
            allocation_complete: false,
          }),
        ],
        true,
        true
      )
    ).toEqual({
      show: true,
      pending: false,
      blocker: 'line_target_required',
    });
  });

  it('keeps manual Void applicable and routes gateway payments to Refund', () => {
    expect(invoiceVoidActionState(payment(), true)).toEqual({
      show: true,
      pending: false,
      blocker: null,
    });
    expect(
      invoiceVoidActionState(
        payment({ source: 'auto', gateway_payment_id: 'pay_123' }),
        true
      )
    ).toEqual({ show: false, pending: false, blocker: null });
    expect(
      invoiceVoidActionState(
        payment({ gateway_payment_id: 'pay_legacy' }),
        true
      )
    ).toEqual({ show: false, pending: false, blocker: null });
    expect(
      invoiceRefundActionState(
        payment({ source: 'auto', gateway_payment_id: 'pay_123' }),
        [],
        true,
        true
      ).show
    ).toBe(true);
  });

  it('uses payment permissions only for otherwise applicable actions', () => {
    expect(invoiceVoidActionState(payment(), false).blocker).toBe('permission');
    expect(
      invoiceVoidActionState(payment({ status: 'void' }), false).blocker
    ).toBeNull();
    expect(
      invoiceRefundActionState(
        payment({ source: 'auto', gateway_payment_id: 'pay_123' }),
        [],
        true,
        false
      ).blocker
    ).toBe('permission');
    expect(
      invoiceRefundActionState(payment(), [], true, false).blocker
    ).toBeNull();
  });
});

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

describe('invoice document action presentation', () => {
  const complete = {
    is_projected: false,
    lifecycle: 'current' as const,
    state: 'open' as const,
    requires_refund_review: false,
    seller_snapshot: { business_name: 'FitZone' },
    customer_snapshot: { customer_name: 'Asha' },
    document_status: null,
    has_customer_phone: true,
    whatsapp_connected: true,
    template_ready: true,
  };

  it('keeps one exact recovery vocabulary for profile, phone, connection, and template setup', () => {
    expect(
      invoiceDocumentActionPresentation({
        ...complete,
        seller_snapshot: null,
      }).download.reason
    ).toBe('Finish Invoice details in Settings -> Payments first.');
    expect(
      invoiceDocumentActionPresentation({
        ...complete,
        has_customer_phone: false,
      }).share.reason
    ).toBe('Add a phone number before sending on WhatsApp.');
    expect(
      invoiceDocumentActionPresentation({
        ...complete,
        whatsapp_connected: false,
      }).share.reason
    ).toBe('Connect WhatsApp in Settings before sending.');
    expect(
      invoiceDocumentActionPresentation({
        ...complete,
        template_ready: false,
      }).share.reason
    ).toBe('Approve and sync gym_invoice_document in en_US before sending.');
  });

  it.each([
    ['download', { state: 'void' as const }, 'void'],
    ['download', { requires_refund_review: true }, 'refund_review'],
    ['download', { seller_snapshot: null }, 'invoice_profile'],
    [
      'download',
      { document_status: 'generating' as const },
      'document_preparing',
    ],
    ['share', { state: 'void' as const }, 'void'],
    ['share', { requires_refund_review: true }, 'refund_review'],
    ['share', { seller_snapshot: null }, 'invoice_profile'],
    ['share', { has_customer_phone: false }, 'missing_phone'],
    ['share', { whatsapp_connected: false }, 'whatsapp_disconnected'],
    ['share', { template_ready: false }, 'template_unavailable'],
    ['share', { document_status: 'generating' as const }, 'document_preparing'],
  ] as const)(
    'returns a stable blocker code for the %s action',
    (action, patch, blocker) => {
      expect(
        invoiceDocumentActionPresentation({ ...complete, ...patch })[action]
          .blocker
      ).toBe(blocker);
    }
  );

  it('returns no blocker for ready actions', () => {
    const presentation = invoiceDocumentActionPresentation({
      ...complete,
      document_status: 'ready',
    });

    expect(presentation.download.blocker).toBeNull();
    expect(presentation.share.blocker).toBeNull();
  });

  it('allows ready audit downloads without allowing void or review sharing', () => {
    for (const patch of [
      { state: 'void' as const },
      { requires_refund_review: true },
    ]) {
      const presentation = invoiceDocumentActionPresentation({
        ...complete,
        ...patch,
        document_status: 'ready',
      });
      expect(presentation.download).toEqual({
        show: true,
        enabled: true,
        reason: null,
        blocker: null,
      });
      expect(presentation.share.enabled).toBe(false);
    }
  });

  it('keeps a persisted numbered future invoice actionable', () => {
    const presentation = invoiceDocumentActionPresentation({
      ...complete,
      lifecycle: 'upcoming',
      is_projected: false,
    });

    expect(presentation.download).toEqual({
      show: true,
      enabled: true,
      reason: null,
      blocker: null,
    });
    expect(presentation.share).toEqual({
      show: true,
      enabled: true,
      reason: null,
      blocker: null,
    });
  });

  it('keeps synthetic upcoming projections actionless', () => {
    expect(
      invoiceDocumentActionPresentation({
        ...complete,
        lifecycle: 'upcoming',
        is_projected: true,
      })
    ).toEqual({
      download: { show: false, enabled: false, reason: null, blocker: null },
      share: { show: false, enabled: false, reason: null, blocker: null },
    });
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
