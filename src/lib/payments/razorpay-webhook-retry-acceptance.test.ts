import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { consumeRazorpayRetryAcceptance } from './razorpay-webhook-retry-acceptance';

function input(event: Record<string, unknown>, rpc = vi.fn()) {
  return {
    rpc,
    value: {
      admin: { rpc } as never,
      accountId: 'account-id',
      providerEventId: 'evt_refund',
      eventIdentitySource: 'header' as const,
      payloadSha256: 'a'.repeat(64),
      signatureGeneration: 'current' as const,
      event: event as never,
    },
  };
}

describe('Razorpay retry acceptance selector', () => {
  it('selects the refund RPC by the immutable UsefulDesk id in signed notes', async () => {
    const refundId = '550e8400-e29b-41d4-a716-446655440000';
    const { rpc, value } = input(
      {
        event: 'refund.processed',
        payload: {
          refund: { entity: { notes: { usefuldesk_refund_id: refundId } } },
        },
      },
      vi.fn().mockResolvedValue({
        data: { action: 'retry', acceptance_id: 'acceptance-id' },
        error: null,
      })
    );

    await expect(consumeRazorpayRetryAcceptance(value)).resolves.toEqual({
      action: 'retry',
      acceptanceId: 'acceptance-id',
    });
    expect(rpc).toHaveBeenCalledWith(
      'consume_razorpay_refund_retry_acceptance',
      expect.objectContaining({
        p_event_type: 'refund.processed',
        p_refund_id: refundId,
      })
    );
  });

  it('does not arm on an unrelated or malformed refund identity', async () => {
    const { rpc, value } = input({
      event: 'refund.processed',
      payload: {
        refund: { entity: { notes: { usefuldesk_refund_id: 'external' } } },
      },
    });

    await expect(consumeRazorpayRetryAcceptance(value)).resolves.toEqual({
      action: 'pass',
      acceptanceId: null,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
