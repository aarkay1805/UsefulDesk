import { beforeEach, describe, expect, it, vi } from 'vitest';

const paymentLinks = vi.hoisted(() => ({
  settle: vi.fn(),
  terminal: vi.fn(),
}));

vi.mock('./razorpay-payment-links', () => ({
  settleVerifiedPaymentLink: paymentLinks.settle,
  verifyPaymentLinkTerminal: paymentLinks.terminal,
}));

import { processClaimedRazorpayWebhook } from './razorpay-webhook-processor';

function admin() {
  return {
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
}

describe('Razorpay Payment Link webhook processing', () => {
  beforeEach(() => {
    paymentLinks.settle.mockResolvedValue({ outcome: 'recorded' });
    paymentLinks.terminal.mockResolvedValue(true);
  });

  it('settles a signed canonical payment_link.paid identity exactly once', async () => {
    const client = admin();
    const result = await processClaimedRazorpayWebhook({
      admin: client as never,
      accountId: 'account',
      eventId: 'event',
      processingOwner: 'owner',
      ingress: 'application',
      event: {
        event: 'payment_link.paid',
        payload: {
          payment_link: { entity: { id: 'plink_1', status: 'paid' } },
          payment: {
            entity: {
              id: 'pay_1',
              amount: 100,
              currency: 'INR',
              status: 'captured',
              created_at: 1_787_680_123,
            },
          },
        },
      },
    });

    expect(result.outcome).toBe('processed');
    expect(paymentLinks.settle).toHaveBeenCalledOnce();
    expect(paymentLinks.settle).toHaveBeenCalledWith({
      admin: client,
      accountId: 'account',
      gatewayLinkId: 'plink_1',
      gatewayPaymentId: 'pay_1',
      webhookEventId: 'event',
      partial: false,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      'complete_razorpay_canonical_webhook_event',
      expect.objectContaining({ p_event_id: 'event' })
    );
  });

  it('never settles the same money from payment.captured', async () => {
    const client = admin();
    await processClaimedRazorpayWebhook({
      admin: client as never,
      accountId: 'account',
      eventId: 'captured-event',
      processingOwner: 'owner',
      ingress: 'application',
      event: {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_1',
              amount: 100,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      },
    });

    expect(paymentLinks.settle).not.toHaveBeenCalled();
  });

  it('provider-verifies cancelled and expired terminal events', async () => {
    const client = admin();
    for (const [eventName, expectedStatus] of [
      ['payment_link.cancelled', 'cancelled'],
      ['payment_link.expired', 'expired'],
    ] as const) {
      await processClaimedRazorpayWebhook({
        admin: client as never,
        accountId: 'account',
        eventId: eventName,
        processingOwner: 'owner',
        ingress: 'application',
        event: {
          event: eventName,
          payload: {
            payment_link: {
              entity: { id: 'plink_1', status: expectedStatus },
            },
          },
        },
      });
    }

    expect(paymentLinks.terminal).toHaveBeenNthCalledWith(1, {
      admin: client,
      accountId: 'account',
      gatewayLinkId: 'plink_1',
      expectedStatus: 'cancelled',
    });
    expect(paymentLinks.terminal).toHaveBeenNthCalledWith(2, {
      admin: client,
      accountId: 'account',
      gatewayLinkId: 'plink_1',
      expectedStatus: 'expired',
    });
  });
});
