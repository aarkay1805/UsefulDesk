import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchLink: vi.fn(),
  fetchPayment: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('./credentials', () => ({
  getRazorpayConnection: vi.fn(async () => ({ accountId: 'account-1' })),
  runRazorpayOperation: vi.fn(
    async (_admin, _connection, operation: (auth: object) => unknown) =>
      operation({ mode: 'oauth', accessToken: 'mock' })
  ),
}));
vi.mock('./razorpay', () => ({
  RazorpayError: class extends Error {},
  cancelPaymentLink: vi.fn(),
  createPaymentLink: vi.fn(),
  listPaymentLinksByReference: vi.fn(),
  fetchPaymentLink: mocks.fetchLink,
  fetchPayment: mocks.fetchPayment,
}));

import { settleVerifiedPaymentLink } from './razorpay-payment-links';

const local = {
  id: 'link-1',
  account_id: 'account-1',
  invoice_id: 'invoice-1',
  revision: 1,
  reference_id: 'reference-1',
  gateway_link_id: 'plink-1',
  expected_amount: 1500,
  expected_amount_subunits: 150_000,
  currency: 'INR',
  short_url: 'https://rzp.io/i/test',
  expires_at: '2026-09-01T00:00:00.000Z',
  status: 'created',
  next_reconcile_at: null,
  reconcile_attempt_count: 0,
};

function admin() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: local, error: null })),
  };
  const rpc = vi.fn(async (name: string) =>
    name === 'record_gateway_invoice_payment'
      ? {
          data: { outcome: 'recorded', payment_id: 'payment-1' },
          error: null,
        }
      : { data: true, error: null }
  );
  return { client: { from: vi.fn(() => query), rpc }, rpc };
}

describe('Razorpay Payment Link provider time', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLink.mockResolvedValue({
      id: 'plink-1',
      entity: 'payment_link',
      amount: 150_000,
      amount_paid: 150_000,
      currency: 'INR',
      accept_partial: false,
      reference_id: 'reference-1',
      short_url: 'https://rzp.io/i/test',
      status: 'paid',
      expire_by: 1_788_220_800,
      notes: {
        usefuldesk_account_id: 'account-1',
        usefuldesk_invoice_id: 'invoice-1',
        usefuldesk_payment_link_id: 'link-1',
      },
      payments: [{ payment_id: 'pay-1', amount: 150_000, status: 'captured' }],
    });
    mocks.fetchPayment.mockResolvedValue({
      id: 'pay-1',
      entity: 'payment',
      amount: 150_000,
      currency: 'INR',
      status: 'captured',
      captured: true,
      payment_link_id: 'plink-1',
      created_at: 1_787_680_123,
    });
  });

  it('stamps the ledger and local link from the provider-authored timestamp', async () => {
    const memory = admin();

    await settleVerifiedPaymentLink({
      admin: memory.client as never,
      accountId: 'account-1',
      gatewayLinkId: 'plink-1',
      gatewayPaymentId: 'pay-1',
      webhookEventId: 'event-1',
      partial: false,
    });

    expect(memory.rpc).toHaveBeenCalledWith(
      'stamp_razorpay_payment_link_provider_time',
      {
        p_account_id: 'account-1',
        p_payment_link_id: 'link-1',
        p_gateway_payment_id: 'pay-1',
        p_payment_id: 'payment-1',
        p_exception_id: null,
        p_provider_created_at: '2026-08-25T17:48:43.000Z',
      }
    );
  });

  it('fails before ledger settlement when the provider omits payment time', async () => {
    const memory = admin();
    mocks.fetchPayment.mockResolvedValue({
      id: 'pay-1',
      entity: 'payment',
      amount: 150_000,
      currency: 'INR',
      status: 'captured',
      captured: true,
      payment_link_id: 'plink-1',
    });

    await expect(
      settleVerifiedPaymentLink({
        admin: memory.client as never,
        accountId: 'account-1',
        gatewayLinkId: 'plink-1',
        gatewayPaymentId: 'pay-1',
        webhookEventId: 'event-1',
        partial: false,
      })
    ).rejects.toThrow('no valid provider timestamp');
    expect(memory.rpc).not.toHaveBeenCalledWith(
      'record_gateway_invoice_payment',
      expect.anything()
    );
  });
});
