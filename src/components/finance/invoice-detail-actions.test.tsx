// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Payment, PaymentRefund } from '@/types';
import {
  InvoicePaymentActions,
  InvoiceRecordPaymentAction,
} from './invoice-detail-dialog';

vi.mock('next/navigation', () => ({
  usePathname: () => '/finance',
  useRouter: () => ({ push: vi.fn() }),
}));

function invoice(patch: Record<string, unknown> = {}) {
  return {
    state: 'open' as const,
    fee_amount: 100,
    amount_paid: 0,
    balance: 100,
    ...patch,
  };
}

function payment(patch: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    account_id: 'account-1',
    membership_id: 'membership-1',
    contact_id: 'contact-1',
    plan_id: 'plan-1',
    user_id: 'user-1',
    amount: 100,
    method: 'cash',
    status: 'paid',
    paid_at: '2026-08-10T10:00:00.000Z',
    source: 'manual',
    payment_purpose: 'due',
    created_at: '2026-08-10T10:00:00.000Z',
    ...patch,
  };
}

function refund(patch: Partial<PaymentRefund> = {}): PaymentRefund {
  return {
    id: 'refund-1',
    payment_id: 'payment-1',
    invoice_id: 'invoice-1',
    gateway_refund_id: 'rfnd_123',
    amount: 50,
    currency: 'INR',
    source: 'razorpay_dashboard',
    disposition: null,
    reason: null,
    status: 'processed',
    requested_by: 'user-1',
    requested_at: '2026-08-10T10:00:00.000Z',
    processed_at: '2026-08-10T10:05:00.000Z',
    failed_at: null,
    provider_created_at: null,
    created_at: '2026-08-10T10:00:00.000Z',
    allocation_complete: false,
    ...patch,
  };
}

afterEach(cleanup);

describe('InvoiceRecordPaymentAction', () => {
  it('keeps refund-review collection visible and resolves to the existing target', async () => {
    const onResolveRefundReview = vi.fn();
    render(
      <InvoiceRecordPaymentAction
        invoice={invoice({
          balance: 0,
          accounting_balance: 35,
          collectible_balance: 0,
          requires_refund_review: true,
        })}
        canRecord
        canResolveRefundReview
        onRecord={vi.fn()}
        onResolveRefundReview={onResolveRefundReview}
      />
    );

    const action = screen.getByRole('button', { name: 'Record payment' });
    expect(action.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(action);

    expect(screen.getByText('Refund review blocks collection')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: 'Resolve refund review' })
    );
    expect(onResolveRefundReview).toHaveBeenCalledOnce();
  });

  it('explains permission without offering an unauthorized CTA', async () => {
    render(
      <InvoiceRecordPaymentAction
        invoice={invoice({
          balance: 0,
          accounting_balance: 35,
          requires_refund_review: true,
        })}
        canRecord={false}
        canResolveRefundReview={false}
        onRecord={vi.fn()}
        onResolveRefundReview={vi.fn()}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Record payment' })
    );
    expect(screen.getByText('Admin access required')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Resolve refund review' })
    ).toBeNull();
  });

  it.each([
    invoice({ amount_paid: 100, balance: 0 }),
    invoice({ state: 'void' }),
    invoice({ fee_amount: 0, balance: 0 }),
  ])('hides Record payment when collection is inapplicable', (value) => {
    render(
      <InvoiceRecordPaymentAction
        invoice={value}
        canRecord
        canResolveRefundReview
        onRecord={vi.fn()}
        onResolveRefundReview={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
  });
});

describe('InvoicePaymentActions', () => {
  it('keeps an applicable Refund truly loading during the historical scan', () => {
    render(
      <InvoicePaymentActions
        payment={payment({
          source: 'payment_link',
          gateway_payment_id: 'pay_123',
        })}
        refunds={[]}
        refundScanComplete={false}
        canRefund
        canVoid
        onRefund={vi.fn()}
        onVoid={vi.fn()}
        onResolveLineTarget={vi.fn()}
      />
    );

    const action = screen.getByRole('button', { name: 'Refund' });
    expect(action.hasAttribute('disabled')).toBe(true);
    expect(action.getAttribute('aria-busy')).toBe('true');
  });

  it('removes Refund when no refundable capacity remains', () => {
    render(
      <InvoicePaymentActions
        payment={payment({
          source: 'auto',
          gateway_payment_id: 'pay_123',
        })}
        refunds={[refund({ amount: 100, allocation_complete: true })]}
        refundScanComplete
        canRefund
        canVoid
        onRefund={vi.fn()}
        onVoid={vi.fn()}
        onResolveLineTarget={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
  });

  it('keeps applicable manual Void visible with a role blocker', async () => {
    render(
      <InvoicePaymentActions
        payment={payment()}
        refunds={[]}
        refundScanComplete
        canRefund={false}
        canVoid={false}
        onRefund={vi.fn()}
        onVoid={vi.fn()}
        onResolveLineTarget={vi.fn()}
      />
    );

    const action = screen.getByRole('button', { name: 'Void' });
    expect(action.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(action);
    expect(screen.getByText('Admin access required')).toBeTruthy();
  });

  it('routes unresolved line targeting to the existing classification control', async () => {
    const onResolveLineTarget = vi.fn();
    render(
      <InvoicePaymentActions
        payment={payment({
          amount: 150,
          source: 'payment_link',
          gateway_payment_id: 'pay_123',
        })}
        refunds={[refund()]}
        refundScanComplete
        canRefund
        canVoid
        onRefund={vi.fn()}
        onVoid={vi.fn()}
        onResolveLineTarget={onResolveLineTarget}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Refund' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Resolve refund review' })
    );
    expect(onResolveLineTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'refund-1',
      })
    );
  });
});
