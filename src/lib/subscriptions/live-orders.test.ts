import { describe, expect, it, vi } from 'vitest';

import { LiveOrderReviewRequired, prepareLiveCheckout } from './live-orders';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const orderId = 'order_Live123';
const config = {
  keyId: 'rzp_live_Usefulmade',
  keySecret: 'key-secret',
  webhookSecret: 'webhook-secret',
  merchantId: 'acc_UsefulmadeLive',
  pilotOrganizationId: organizationId,
};
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  USEFULDESK_SAAS_LIVE_ORDERS_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED: 'true',
};
const input = { requestId, organizationId, actorUserId: 'owner-1' };
const claim = {
  action: 'create',
  request_id: requestId,
  organization_id: organizationId,
  amount_minor: 79900,
  currency: 'INR',
  provider_order_id: null,
};
const bound = {
  request_id: requestId,
  organization_id: organizationId,
  provider_order_id: orderId,
};
function admin(claimData: unknown = claim) {
  let claims = 0;
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'subscription_claim_live_order'
        ? ++claims === 1
          ? claimData
          : { ...claim, ...bound, action: 'bound' }
        : bound,
    error: null,
  }));
  return { rpc };
}

describe('one Live order per frozen quote', () => {
  it('never claims or posts while either money gate is off', async () => {
    const db = admin();
    const createOrder = vi.fn();
    await expect(
      prepareLiveCheckout(input, {
        admin: db as never,
        config,
        createOrder,
        env: { ...env, USEFULDESK_SAAS_LIVE_ORDERS_ENABLED: 'false' },
      })
    ).rejects.toThrow('disabled');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('saves a claim before the provider POST and binds only its exact order', async () => {
    const db = admin();
    const createOrder = vi.fn(async () => ({
      id: orderId,
      amountMinor: 79900,
      currency: 'INR' as const,
    }));
    await expect(
      prepareLiveCheckout(input, {
        admin: db as never,
        config,
        createOrder,
        env,
      })
    ).resolves.toMatchObject({
      orderId,
      amountMinor: 79900,
      keyId: config.keyId,
    });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
      'subscription_claim_live_order',
      'subscription_bind_live_order',
      'subscription_claim_live_order',
    ]);
    expect(createOrder).toHaveBeenCalledOnce();
  });

  it('uses GET-only recovery after an uncertain POST and refuses ambiguity', async () => {
    const db = admin({ ...claim, action: 'recovery' });
    const createOrder = vi.fn();
    const recoverOrder = vi.fn(async () => null);
    await expect(
      prepareLiveCheckout(input, {
        admin: db as never,
        config,
        createOrder,
        recoverOrder,
        env,
      })
    ).rejects.toBeInstanceOf(LiveOrderReviewRequired);
    expect(createOrder).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it('rechecks a bound provider order without another POST', async () => {
    const db = admin({ ...claim, action: 'bound', provider_order_id: orderId });
    const createOrder = vi.fn();
    const fetchOrder = vi.fn(async () => ({
      id: orderId,
      amountMinor: 79900,
      currency: 'INR' as const,
    }));
    await expect(
      prepareLiveCheckout(input, {
        admin: db as never,
        config,
        createOrder,
        fetchOrder,
        env,
      })
    ).resolves.toMatchObject({ orderId });
    expect(fetchOrder).toHaveBeenCalledOnce();
    expect(createOrder).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it('refuses Checkout when cancellation wins during provider creation', async () => {
    const db = admin();
    const createOrder = vi.fn(async () => {
      db.rpc.mockResolvedValueOnce({ data: bound, error: null });
      db.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: '55000' },
      } as never);
      return { id: orderId, amountMinor: 79900, currency: 'INR' as const };
    });
    await expect(
      prepareLiveCheckout(input, {
        admin: db as never,
        config,
        createOrder,
        env,
      })
    ).rejects.toBeInstanceOf(LiveOrderReviewRequired);
    expect(createOrder).toHaveBeenCalledOnce();
  });

  it('rejects cross-organization claims before provider I/O', async () => {
    const db = admin({
      ...claim,
      organization_id: '33333333-3333-4333-8333-333333333333',
    });
    const createOrder = vi.fn();
    await expect(
      prepareLiveCheckout(input, {
        admin: db as never,
        config,
        createOrder,
        env,
      })
    ).rejects.toThrow('did not match');
    expect(createOrder).not.toHaveBeenCalled();
  });
});
