import { afterEach, describe, expect, it, vi } from 'vitest';

import { settleCapturedLivePayment } from './live-flow';
import { prepareLiveFullRefund } from './live-refunds';
import { prepareLiveCheckout } from './live-orders';
import {
  createLiveOrder,
  fetchLiveOrder,
  liveCustomerCheckoutEnabled,
} from './live-provider';
import { liveRecoveryScopes, resolveLiveProviderAuthority } from './live-scope';

const pilot = '11111111-1111-4111-8111-111111111111';
const customer = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const config = {
  keyId: 'rzp_live_Synthetic',
  keySecret: 'synthetic-key',
  webhookSecret: 'synthetic-hook',
  merchantId: 'acc_Synthetic',
  pilotOrganizationId: pilot,
};
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: config.keyId,
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: config.keySecret,
  USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: config.webhookSecret,
  USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: config.merchantId,
  USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID: pilot,
  USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: 'true',
};
const identity = {
  request_id: requestId,
  organization_id: customer,
  merchant_id: config.merchantId,
  amount_minor: 79900,
  currency: 'INR',
  scope: 'customer_sale',
};
const facts = { requestId, organizationId: customer, amountMinor: 79900 };
const order = {
  id: 'order_SyntheticCustomer',
  amount: 79900,
  currency: 'INR',
  receipt: requestId,
  status: 'created',
  notes: {
    usefuldesk_request_id: requestId,
    usefuldesk_organization_id: customer,
  },
};
const claim = {
  request_id: requestId,
  organization_id: customer,
  amount_minor: 79900,
  currency: 'INR',
};
const capture = {
  orderId: order.id,
  paymentId: 'pay_SyntheticCustomer',
  captureEventAt: '2026-10-02T08:00:00Z',
};

function database(overrides: Record<string, unknown> = {}) {
  let claims = 0;
  const values: Record<string, unknown> = {
    subscription_resolve_live_scope: identity,
    subscription_list_live_recovery_scopes: [pilot, customer],
    subscription_bind_live_order: { ...claim, provider_order_id: order.id },
    subscription_live_order_for_capture: {
      ...claim,
      provider_order_id: order.id,
      provider_merchant_id: config.merchantId,
    },
    subscription_live_payment_replay_status: null,
    subscription_commit_live_initial_payment: {
      ...claim,
      status: 'verified',
      provider_payment_id: capture.paymentId,
    },
    ...overrides,
  };
  return {
    rpc: vi.fn(async (name: string) => ({
      data:
        name === 'subscription_claim_live_order' &&
        !Object.hasOwn(overrides, name)
          ? {
              ...claim,
              action: ++claims === 1 ? 'create' : 'bound',
              provider_order_id: claims === 1 ? null : order.id,
            }
          : values[name],
      error: null,
    })),
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('separate customer authority and original-pilot isolation', () => {
  it('requires both literal customer switches; original order flag grants no customer authority', async () => {
    expect(
      liveCustomerCheckoutEnabled({
        NODE_ENV: 'production',
        USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: 'true',
      })
    ).toBe(false);
    expect(
      liveCustomerCheckoutEnabled({
        ...env,
        USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: '1',
      })
    ).toBe(false);
    const db = database();
    await expect(
      prepareLiveCheckout(
        { ...facts, actorUserId: 'owner' },
        {
          admin: db as never,
          config,
          env: {
            ...env,
            USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: 'false',
          },
        }
      )
    ).rejects.toThrow('disabled');
    expect(db.rpc).not.toHaveBeenCalled();
    await expect(
      prepareLiveCheckout(
        { requestId, organizationId: pilot, actorUserId: 'owner' },
        { admin: db as never, config, env }
      )
    ).rejects.toThrow('disabled');
  });

  it('rejects browser-shaped or cloned authority before provider I/O', async () => {
    const fetchImpl = vi.fn();
    await expect(
      createLiveOrder(
        config,
        {
          ...facts,
          authority: {
            ...identity,
            ...facts,
            merchantId: config.merchantId,
            keyId: config.keyId,
          },
        },
        fetchImpl,
        env
      )
    ).rejects.toThrow('authority');
    const authority = await resolveLiveProviderAuthority(
      { requestId },
      config,
      database() as never
    );
    await expect(
      createLiveOrder(
        config,
        { ...facts, authority: { ...authority } },
        fetchImpl,
        env
      )
    ).rejects.toThrow('authority');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { merchant_id: 'acc_Other' },
    { organization_id: pilot },
    { request_id: pilot },
    { amount_minor: 79901 },
    { currency: 'AED' },
    { scope: 'internal_acceptance' },
    { organization_id: 'invalid' },
  ])('rejects changed database authority %j', async (change) => {
    await expect(
      resolveLiveProviderAuthority(
        { requestId },
        config,
        database({
          subscription_resolve_live_scope: { ...identity, ...change },
        }) as never
      )
    ).rejects.toThrow('operator-authorized');
  });

  it('creates after one durable owner claim, binds the customer and rechecks without changing the pilot', async () => {
    const db = database();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(order));
    vi.stubGlobal('fetch', fetchImpl);
    const checkout = await prepareLiveCheckout(
      { requestId, organizationId: customer, actorUserId: 'owner' },
      { admin: db as never, config, env }
    );
    expect(checkout).toMatchObject({
      organizationId: customer,
      orderId: order.id,
      amountMinor: 79900,
    });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
      'subscription_resolve_live_scope',
      'subscription_claim_live_order',
      'subscription_bind_live_order',
      'subscription_claim_live_order',
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(
      JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)
    ).toMatchObject({
      amount: 79900,
      receipt: requestId,
      notes: { usefuldesk_organization_id: customer },
    });
    expect(db.rpc).toHaveBeenCalledWith(
      'subscription_bind_live_order',
      expect.objectContaining({ p_pilot_organization_id: customer })
    );
    expect(config.pilotOrganizationId).toBe(pilot);
    expect(checkout).not.toHaveProperty('authority');
  });

  it('keeps an ambiguous create GET-only on retry, even if the provider response was lost', async () => {
    const db = database({
      subscription_claim_live_order: { ...claim, action: 'recovery' },
    });
    const createOrder = vi.fn();
    const recoverOrder = vi.fn(async () => null);
    await expect(
      prepareLiveCheckout(
        { requestId, organizationId: customer, actorUserId: 'owner' },
        { admin: db as never, config, env, createOrder, recoverOrder }
      )
    ).rejects.toThrow('recovery');
    expect(createOrder).not.toHaveBeenCalled();
    expect(recoverOrder).toHaveBeenCalledOnce();
  });

  it('rejects provider notes naming another tenant despite a valid durable customer token', async () => {
    const authority = await resolveLiveProviderAuthority(
      { requestId },
      config,
      database() as never
    );
    const fetchImpl = vi.fn(async () =>
      Response.json({
        ...order,
        notes: { ...order.notes, usefuldesk_organization_id: pilot },
      })
    );
    await expect(
      fetchLiveOrder(
        config,
        { ...facts, orderId: order.id, authority },
        fetchImpl
      )
    ).rejects.toThrow('does not match');
    await expect(
      fetchLiveOrder(
        config,
        { ...facts, requestId: pilot, orderId: order.id, authority },
        fetchImpl
      )
    ).rejects.toThrow('authority');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('settles by bound order authority and holds changed reviews after initiation is closed', async () => {
    const db = database({
      subscription_commit_live_initial_payment: {
        ...claim,
        status: 'review_required',
        provider_payment_id: capture.paymentId,
      },
    });
    const fetchPayment = vi.fn(async () => ({
      id: capture.paymentId,
      orderId: order.id,
      amountMinor: 79900,
    }));
    const result = await settleCapturedLivePayment(capture, {
      admin: db as never,
      config,
      fetchPayment,
      env: { ...env, USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: 'false' },
    });
    expect(result).toMatchObject({
      status: 'review_required',
      organizationId: customer,
    });
    expect(db.rpc.mock.calls[0]).toEqual([
      'subscription_resolve_live_scope',
      {
        p_provider_merchant_id: config.merchantId,
        p_provider_order_id: order.id,
      },
    ]);
    expect(fetchPayment).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        organizationId: customer,
        authority: expect.any(Object),
      })
    );
  });

  it('returns customer replay after refund with no fresh capture GET or access commit', async () => {
    const db = database({
      subscription_live_payment_replay_status: {
        ...claim,
        status: 'verified',
        provider_payment_id: capture.paymentId,
      },
    });
    const fetchPayment = vi.fn();
    await expect(
      settleCapturedLivePayment(capture, {
        admin: db as never,
        config,
        fetchPayment,
        env,
      })
    ).resolves.toMatchObject({ organizationId: customer, status: 'verified' });
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalledWith(
      'subscription_commit_live_initial_payment',
      expect.anything()
    );
  });

  it('retains the original recovery scope first and refuses duplicate or changed inventories', async () => {
    expect(await liveRecoveryScopes(config, database() as never)).toEqual([
      pilot,
      customer,
    ]);
    await expect(
      liveRecoveryScopes(
        config,
        database({
          subscription_list_live_recovery_scopes: [customer, pilot],
        }) as never
      )
    ).rejects.toThrow('inventory');
    await expect(
      liveRecoveryScopes(
        config,
        database({
          subscription_list_live_recovery_scopes: [pilot, customer, customer],
        }) as never
      )
    ).rejects.toThrow('inventory');
  });
  it('requires separate customer refund activation and retains the quote authority on the reviewed claim', async () => {
    const refundRequestId = '44444444-4444-4444-8444-444444444444';
    const input = {
      refundRequestId,
      organizationId: customer,
      actorUserId: 'owner',
    };
    const db = database({
      subscription_claim_live_refund: {
        ...claim,
        action: 'create',
        refund_request_id: refundRequestId,
        provider_payment_id: capture.paymentId,
        provider_order_id: order.id,
      },
      subscription_observe_live_refund: {
        refund_request_id: refundRequestId,
        provider_refund_id: 'rfnd_SyntheticCustomer',
      },
    });
    const createRefund = vi.fn(async () => ({
      id: 'rfnd_SyntheticCustomer',
      status: 'pending' as const,
    }));
    await expect(
      prepareLiveFullRefund(input, {
        admin: db as never,
        config,
        env,
        createRefund,
      })
    ).rejects.toThrow('disabled');
    expect(db.rpc).not.toHaveBeenCalled();
    await expect(
      prepareLiveFullRefund(input, {
        admin: db as never,
        config,
        env: { ...env, USEFULDESK_SAAS_LIVE_CUSTOMER_REFUNDS_ENABLED: 'true' },
        createRefund,
      })
    ).resolves.toMatchObject({ status: 'pending' });
    expect(createRefund).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        organizationId: customer,
        authority: expect.any(Object),
      }),
      expect.anything(),
      expect.anything()
    );
  });
});
