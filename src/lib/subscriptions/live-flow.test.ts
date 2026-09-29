import { describe, expect, it, vi } from 'vitest';

import { settleCapturedLivePayment } from './live-flow';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const orderId = 'order_Live123';
const paymentId = 'pay_Live456';
const captureEventAt = '2026-09-29T08:00:00.000Z';
const config = {
  keyId: 'rzp_live_Usefulmade',
  keySecret: 'key-secret',
  webhookSecret: 'webhook-secret',
  merchantId: 'acc_UsefulmadeLive',
  pilotOrganizationId: organizationId,
};
const quote = {
  request_id: requestId,
  organization_id: organizationId,
  provider_order_id: orderId,
  provider_merchant_id: config.merchantId,
  amount_minor: 79900,
  currency: 'INR',
};
const result = {
  status: 'verified',
  organization_id: organizationId,
  request_id: requestId,
  provider_payment_id: paymentId,
};
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED: 'true',
};

function admin(overrides: Record<string, unknown> = {}) {
  const values = {
    subscription_live_order_for_capture: quote,
    subscription_live_payment_replay_status: null,
    subscription_commit_live_initial_payment: result,
    ...overrides,
  };
  const rpc = vi.fn(async (name: string) => ({
    data: values[name as keyof typeof values],
    error: null,
  }));
  return { rpc };
}

describe('Live captured-payment settlement boundary', () => {
  it('does not touch the database or provider with the settlement gate off', async () => {
    const db = admin();
    const fetchPayment = vi.fn();
    await expect(
      settleCapturedLivePayment(
        { orderId, paymentId, captureEventAt },
        {
          admin: db as never,
          config,
          fetchPayment,
          env: { NODE_ENV: 'production' },
        }
      )
    ).rejects.toThrow('disabled');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  it('fetches captured Live facts before the service-only commit', async () => {
    const db = admin();
    const fetchPayment = vi.fn(async () => ({
      id: paymentId,
      orderId,
      amountMinor: 79900,
    }));
    await expect(
      settleCapturedLivePayment(
        { orderId, paymentId, captureEventAt },
        {
          admin: db as never,
          config,
          fetchPayment,
          env,
        }
      )
    ).resolves.toMatchObject({ status: 'verified', organizationId, requestId });
    expect(fetchPayment).toHaveBeenCalledWith(config, {
      requestId,
      organizationId,
      orderId,
      paymentId,
      amountMinor: 79900,
    });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
      'subscription_live_order_for_capture',
      'subscription_live_payment_replay_status',
      'subscription_commit_live_initial_payment',
    ]);
    expect(db.rpc).toHaveBeenLastCalledWith(
      'subscription_commit_live_initial_payment',
      expect.objectContaining({
        p_provider_merchant_id: config.merchantId,
        p_amount_minor: 79900,
        p_currency: 'INR',
        p_capture_event_at: captureEventAt,
      })
    );
  });

  it('returns a durable replay without another provider GET after refund', async () => {
    const db = admin({ subscription_live_payment_replay_status: result });
    const fetchPayment = vi.fn();
    await expect(
      settleCapturedLivePayment(
        { orderId, paymentId, captureEventAt },
        {
          admin: db as never,
          config,
          fetchPayment,
          env,
        }
      )
    ).resolves.toMatchObject({ status: 'verified' });
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalledWith(
      'subscription_commit_live_initial_payment',
      expect.anything()
    );
  });

  it('refuses a cross-organization lookup and a mismatched commit', async () => {
    const fetchPayment = vi.fn();
    await expect(
      settleCapturedLivePayment(
        { orderId, paymentId, captureEventAt },
        {
          admin: admin({
            subscription_live_order_for_capture: {
              ...quote,
              organization_id: '33333333-3333-4333-8333-333333333333',
            },
          }) as never,
          config,
          fetchPayment,
          env,
        }
      )
    ).rejects.toThrow('bound pilot quote');
    expect(fetchPayment).not.toHaveBeenCalled();
    await expect(
      settleCapturedLivePayment(
        { orderId, paymentId, captureEventAt },
        {
          admin: admin({
            subscription_commit_live_initial_payment: {
              ...result,
              provider_payment_id: 'pay_Other',
            },
          }) as never,
          config,
          fetchPayment: vi.fn(async () => ({
            id: paymentId,
            orderId,
            amountMinor: 79900,
          })),
          env,
        }
      )
    ).rejects.toThrow('not committed or held');
  });
});
