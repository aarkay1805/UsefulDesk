import { beforeEach, describe, expect, it, vi } from 'vitest';

const refunds = vi.hoisted(() => ({ finalize: vi.fn() }));

vi.mock('./razorpay-refunds', () => ({
  finalizeOrImportVerifiedRefund: refunds.finalize,
}));

import { processClaimedRazorpayWebhook } from './razorpay-webhook-processor';

describe('Razorpay refund webhook processing', () => {
  beforeEach(() => {
    refunds.finalize.mockReset();
    refunds.finalize.mockResolvedValue({ outcome: 'finalized' });
  });

  it('provider-verifies a signed processed refund before completing its canonical event', async () => {
    const admin = {
      rpc: vi.fn(async () => ({ data: true, error: null })),
    };
    const remote = {
      id: 'rfnd_1',
      entity: 'refund' as const,
      payment_id: 'pay_1',
      amount: 100,
      currency: 'INR',
      status: 'processed' as const,
      created_at: 1_786_280_000,
    };
    const result = await processClaimedRazorpayWebhook({
      admin: admin as never,
      accountId: 'account',
      eventId: 'event',
      processingOwner: 'owner',
      ingress: 'application',
      event: {
        event: 'refund.processed',
        payload: { refund: { entity: remote } },
      },
    });

    expect(refunds.finalize).toHaveBeenCalledWith({
      admin,
      accountId: 'account',
      remoteRefund: remote,
    });
    expect(result.outcome).toBe('processed');
    expect(admin.rpc).toHaveBeenCalledWith(
      'complete_razorpay_canonical_webhook_event',
      expect.objectContaining({ p_event_id: 'event' })
    );
  });

  it('leaves the canonical event retryable when refund verification fails', async () => {
    refunds.finalize.mockRejectedValue(new Error('provider mismatch'));
    const admin = {
      rpc: vi.fn(async () => ({ data: true, error: null })),
    };
    const result = await processClaimedRazorpayWebhook({
      admin: admin as never,
      accountId: 'account',
      eventId: 'event',
      processingOwner: 'owner',
      ingress: 'application',
      event: {
        event: 'refund.failed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_1',
              entity: 'refund',
              payment_id: 'pay_1',
              amount: 100,
              currency: 'INR',
              status: 'failed',
              created_at: 1_786_280_000,
            },
          },
        },
      },
    });

    expect(result.outcome).toBe('failed');
    expect(admin.rpc).toHaveBeenCalledWith(
      'fail_razorpay_canonical_webhook_event',
      expect.objectContaining({ p_error: 'provider mismatch' })
    );
  });
});
