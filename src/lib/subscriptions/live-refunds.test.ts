import { describe, expect, it, vi } from 'vitest';

import {
  LiveRefundReviewRequired,
  prepareLiveFullRefund,
  reconcileLiveRefund,
} from './live-refunds';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const refundRequestId = '33333333-3333-4333-8333-333333333333';
const paymentId = 'pay_Live456';
const orderId = 'order_Live123';
const refundId = 'rfnd_Live789';
const config = {
  keyId: 'rzp_live_Usefulmade',
  keySecret: 'key-secret',
  webhookSecret: 'webhook-secret',
  merchantId: 'acc_UsefulmadeLive',
  pilotOrganizationId: organizationId,
};
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED: 'true',
};
const input = { refundRequestId, organizationId, actorUserId: 'owner-1' };
const claim = {
  action: 'create',
  refund_request_id: refundRequestId,
  request_id: requestId,
  organization_id: organizationId,
  provider_payment_id: paymentId,
  provider_order_id: orderId,
  provider_refund_id: null,
  amount_minor: 79900,
  currency: 'INR',
};
function admin(
  claimData: unknown = claim,
  commitData: unknown = {
    refund_request_id: refundRequestId,
    provider_refund_id: refundId,
    confirmed_at: '2026-09-29T00:00:00Z',
    review_reason: null,
  }
) {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'subscription_claim_live_refund'
        ? claimData
        : name === 'subscription_observe_live_refund'
          ? { refund_request_id: refundRequestId, provider_refund_id: refundId }
          : commitData,
    error: null,
  }));
  return { rpc };
}

describe('Live first-payment refund boundary', () => {
  it('makes no database or provider call with its separate refund gate off', async () => {
    const db = admin();
    const createRefund = vi.fn();
    await expect(
      prepareLiveFullRefund(input, {
        admin: db as never,
        config,
        createRefund,
        env: { ...env, USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED: 'false' },
      })
    ).rejects.toThrow('disabled');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('claims before POST, verifies full settlement, then commits access end', async () => {
    const db = admin();
    const createRefund = vi.fn(async () => ({
      id: refundId,
      status: 'processed' as const,
    }));
    const fetchSettled = vi.fn(async () => ({
      id: refundId,
      status: 'processed' as const,
    }));
    await expect(
      prepareLiveFullRefund(input, {
        admin: db as never,
        config,
        createRefund,
        fetchSettled,
        env,
      })
    ).resolves.toEqual({ status: 'confirmed', refundId });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
      'subscription_claim_live_refund',
      'subscription_observe_live_refund',
      'subscription_commit_live_full_refund',
    ]);
    expect(createRefund).toHaveBeenCalledOnce();
    expect(fetchSettled).toHaveBeenCalledOnce();
  });

  it('uses GET-only recovery and never issues a second refund POST', async () => {
    const db = admin({ ...claim, action: 'recovery' });
    const createRefund = vi.fn();
    const recoverRefund = vi.fn(async () => null);
    await expect(
      prepareLiveFullRefund(input, {
        admin: db as never,
        config,
        createRefund,
        recoverRefund,
        env,
      })
    ).rejects.toBeInstanceOf(LiveRefundReviewRequired);
    expect(createRefund).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it('preserves a pending refund and a processed refund held for later-charge review', async () => {
    const pending = admin();
    await expect(
      prepareLiveFullRefund(input, {
        admin: pending as never,
        config,
        createRefund: vi.fn(async () => ({
          id: refundId,
          status: 'pending' as const,
        })),
        env,
      })
    ).resolves.toEqual({ status: 'pending', refundId });
    expect(pending.rpc).not.toHaveBeenCalledWith(
      'subscription_commit_live_full_refund',
      expect.anything()
    );

    const held = admin(claim, {
      refund_request_id: refundRequestId,
      provider_refund_id: refundId,
      confirmed_at: null,
      review_reason: 'later_payment_or_access_change',
    });
    await expect(
      prepareLiveFullRefund(input, {
        admin: held as never,
        config,
        createRefund: vi.fn(async () => ({
          id: refundId,
          status: 'processed' as const,
        })),
        fetchSettled: vi.fn(async () => ({
          id: refundId,
          status: 'processed' as const,
        })),
        env,
      })
    ).resolves.toEqual({ status: 'review_required', refundId });
  });
});

describe('signed Live refund reconciliation', () => {
  const lookup = {
    refund_request_id: refundRequestId,
    request_id: requestId,
    organization_id: organizationId,
    provider_payment_id: paymentId,
    provider_order_id: orderId,
    provider_refund_id: refundId,
    amount_minor: 79900,
    currency: 'INR',
    state: 'pending',
    confirmed_at: null,
    review_reason: null,
  };
  it('uses GET-only evidence and commits a matching settled full refund', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === 'subscription_live_refund_for_payment'
          ? lookup
          : name === 'subscription_observe_live_refund'
            ? { provider_refund_id: refundId }
            : {
                provider_refund_id: refundId,
                confirmed_at: '2026-09-29T00:00:00Z',
              },
      error: null,
    }));
    const fetchRefund = vi.fn(async () => ({
      id: refundId,
      status: 'processed' as const,
    }));
    const fetchSettled = vi.fn(async () => ({
      id: refundId,
      status: 'processed' as const,
    }));
    await expect(
      reconcileLiveRefund(
        { paymentId, refundId },
        {
          admin: { rpc } as never,
          config,
          fetchRefund,
          fetchSettled,
        }
      )
    ).resolves.toEqual({ status: 'confirmed' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'subscription_live_refund_for_payment',
      'subscription_observe_live_refund',
      'subscription_commit_live_full_refund',
    ]);
    expect(fetchRefund).toHaveBeenCalledOnce();
    expect(fetchSettled).toHaveBeenCalledOnce();
  });

  it('rejects a refund mapped to another organization before provider GET', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ...lookup,
        organization_id: '33333333-3333-4333-8333-333333333333',
      },
      error: null,
    }));
    const fetchRefund = vi.fn();
    await expect(
      reconcileLiveRefund(
        { paymentId, refundId },
        {
          admin: { rpc } as never,
          config,
          fetchRefund,
        }
      )
    ).rejects.toThrow('not bound');
    expect(fetchRefund).not.toHaveBeenCalled();
  });
});
