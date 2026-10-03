import { afterEach, describe, expect, it, vi } from 'vitest';

import { settleCapturedLivePayment } from './live-flow';
import { prepareLiveCheckout } from './live-orders';
import {
  createLiveOrder,
  fetchCapturedLivePayment,
  fetchLiveOrder,
  liveMonthlyCheckoutEnabled,
  recoverLiveFullRefund,
  recoverLiveOrder,
} from './live-provider';
import { recoverLiveFinancialObligations } from './live-recovery';
import { resolveLiveProviderAuthority } from './live-scope';

// All merchants, provider bodies and durable RPC rows in this suite are synthetic.
const pilot = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const offerId = '44444444-4444-4444-8444-444444444444';
const refundId = '55555555-5555-4555-8555-555555555555';
const leaseToken = '66666666-6666-4666-8666-666666666666';
const orderId = 'order_SyntheticMonthly';
const paymentId = 'pay_SyntheticMonthly';
const config = {
  keyId: 'rzp_live_SyntheticMonthly',
  keySecret: 'synthetic-key',
  webhookSecret: 'synthetic-hook',
  merchantId: 'acc_SyntheticMonthly',
  pilotOrganizationId: pilot,
};
const environment: NodeJS.ProcessEnv = {
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
  USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED: 'true',
};
const cases = [
  ['starter', 79900, 1],
  ['growth', 149900, 1],
  ['ultimate', 399900, 5],
] as const;
function fixture(tier: string = 'growth', amountMinor = 149900, branches = 1) {
  const row = {
    request_id: requestId,
    organization_id: organizationId,
    merchant_id: config.merchantId,
    amount_minor: amountMinor,
    currency: 'INR',
    scope: 'customer_sale',
    offer_contract_version: 'monthly_first_v1',
    catalog_version: 'monthly_inr_2026_10_v1',
    tier,
    monthly_offer_id: offerId,
    included_branches: branches,
    paid_extra_branch_slots: 0,
  };
  const order = {
    id: orderId,
    amount: amountMinor,
    currency: 'INR',
    receipt: requestId,
    status: 'created',
    notes: {
      usefuldesk_request_id: requestId,
      usefuldesk_organization_id: organizationId,
      usefuldesk_contract_version: 'monthly_first_v1',
      usefuldesk_catalog_version: 'monthly_inr_2026_10_v1',
      usefuldesk_catalog_tier: tier,
      usefuldesk_monthly_offer_id: offerId,
    },
  };
  let claimCount = 0;
  const db = {
    rpc: vi.fn(
      async (
        name: string,
        args?: Record<string, unknown>
      ): Promise<{ data: unknown; error: unknown }> => {
        if (name === 'subscription_resolve_live_scope')
          return { data: row, error: null };
        if (name === 'subscription_claim_live_order')
          return {
            data: {
              ...row,
              action: ++claimCount === 1 ? 'create' : 'bound',
              provider_order_id: claimCount === 1 ? null : orderId,
            },
            error: null,
          };
        if (name === 'subscription_bind_live_order')
          return { data: { ...row, provider_order_id: orderId }, error: null };
        if (name === 'subscription_live_order_for_capture')
          return {
            data: {
              ...row,
              provider_order_id: orderId,
              provider_merchant_id: config.merchantId,
            },
            error: null,
          };
        if (name === 'subscription_live_payment_replay_status')
          return { data: null, error: null };
        if (name === 'subscription_commit_live_initial_payment')
          return {
            data: {
              ...row,
              status: 'verified',
              provider_payment_id: paymentId,
            },
            error: null,
          };
        if (name === 'subscription_list_live_recovery_scopes')
          return { data: [pilot, organizationId], error: null };
        if (name === 'subscription_claim_live_recovery_items')
          return {
            data:
              args?.p_pilot_organization_id === pilot
                ? []
                : [
                    {
                      ...row,
                      item_type: 'order',
                      item_id: requestId,
                      lease_token: leaseToken,
                      provider_merchant_id: config.merchantId,
                      provider_order_id: null,
                      provider_payment_id: null,
                      provider_refund_id: null,
                    },
                  ],
            error: null,
          };
        if (name === 'subscription_finish_live_recovery_item')
          return {
            data: {
              item_type: args?.p_item_type,
              item_id: args?.p_item_id,
              outcome: args?.p_outcome,
              reason: args?.p_reason,
              completed: args?.p_outcome === 'recovered',
            },
            error: null,
          };
        return { data: null, error: null };
      }
    ),
  };
  const facts = { requestId, organizationId, amountMinor };
  return { row, order, db, facts };
}
async function resolveFor(changes: Record<string, unknown> = {}) {
  const f = fixture();
  Object.assign(f.row, changes);
  return resolveLiveProviderAuthority({ requestId }, config, f.db as never);
}
const input = { requestId, organizationId, actorUserId: 'synthetic-owner' };
afterEach(() => vi.unstubAllGlobals());

describe('versioned monthly provider authority (synthetic)', () => {
  it.each(cases)(
    'mints only frozen durable %s economics',
    async (tier, amount, branches) => {
      const f = fixture(tier, amount, branches);
      const authority = await resolveLiveProviderAuthority(
        { requestId },
        config,
        f.db as never
      );
      expect(authority).toMatchObject({
        contractVersion: 'monthly_first_v1',
        catalogVersion: 'monthly_inr_2026_10_v1',
        catalogTier: tier,
        monthlyOfferId: offerId,
        amountMinor: amount,
      });
      expect(Object.isFrozen(authority)).toBe(true);
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(f.order));
      await createLiveOrder(
        config,
        { ...f.facts, authority },
        fetchImpl,
        environment
      );
      expect(
        JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)
      ).toMatchObject({ amount, notes: f.order.notes });
      await expect(
        createLiveOrder(
          config,
          { ...f.facts, authority: { ...authority } },
          fetchImpl,
          environment
        )
      ).rejects.toThrow('authority');
      await expect(
        createLiveOrder(
          config,
          { ...f.facts, amountMinor: amount + 1, authority },
          fetchImpl,
          environment
        )
      ).rejects.toThrow('authority');
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  );
  it('projects explicit original Starter without monthly economics or notes', async () => {
    const authority = await resolveFor({
      offer_contract_version: 'starter_v1',
      catalog_version: null,
      monthly_offer_id: null,
      tier: 'starter',
      amount_minor: 79900,
    });
    expect(authority).toMatchObject({
      contractVersion: 'starter_v1',
      catalogVersion: null,
      monthlyOfferId: null,
      catalogTier: 'starter',
      amountMinor: 79900,
    });
  });
  it.each([
    { offer_contract_version: undefined },
    { offer_contract_version: null },
    { offer_contract_version: 'unknown' },
    { catalog_version: null },
    { tier: undefined },
    { monthly_offer_id: null },
    { monthly_offer_id: 'invalid' },
    { amount_minor: 79900 },
    { included_branches: 5 },
    { paid_extra_branch_slots: 1 },
    { currency: 'USD' },
    { merchant_id: 'acc_Foreign' },
    { request_id: pilot },
    { organization_id: pilot },
    { scope: 'internal_acceptance' },
    { renewal_of_request_id: pilot },
  ])('rejects incomplete/mismatched durable identity %j', async (change) => {
    await expect(resolveFor(change)).rejects.toThrow();
  });
  it('keeps original Starter economics and rejects internal arbitrary amounts', async () => {
    await expect(
      resolveFor({
        offer_contract_version: 'starter_v1',
        catalog_version: null,
        monthly_offer_id: null,
      })
    ).rejects.toThrow();
    const fetchImpl = vi.fn();
    await expect(
      createLiveOrder(
        config,
        { requestId, organizationId: pilot, amountMinor: 149900 },
        fetchImpl,
        { ...environment, USEFULDESK_SAAS_LIVE_ORDERS_ENABLED: 'true' }
      )
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['false', '1', undefined])(
    'requires literal monthly flag %s and both customer flags',
    async (value) => {
      const env = {
        ...environment,
        USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED: value,
      };
      expect(liveMonthlyCheckoutEnabled(env)).toBe(false);
      const f = fixture();
      await expect(
        prepareLiveCheckout(input, { admin: f.db as never, config, env })
      ).rejects.toThrow('disabled');
      expect(f.db.rpc.mock.calls.map(([name]) => name)).toEqual([
        'subscription_resolve_live_scope',
      ]);
      expect(
        liveMonthlyCheckoutEnabled({
          ...environment,
          USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED: 'false',
        })
      ).toBe(false);
      expect(
        liveMonthlyCheckoutEnabled({
          ...environment,
          USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: 'false',
        })
      ).toBe(false);
    }
  );
  it.each(['create', 'recovery', 'bound'])(
    'rechecks the monthly runtime flag after %s provider I/O',
    async (action) => {
      const f = fixture();
      const env = { ...environment };
      const normal = f.db.rpc.getMockImplementation()!;
      f.db.rpc.mockImplementation(async (name, args) => {
        const result = await normal(name, args);
        if (name === 'subscription_claim_live_order' && result.data)
          Object.assign(result.data, {
            action:
              action === 'create'
                ? (result.data as Record<string, unknown>).action
                : 'bound',
            provider_order_id: orderId,
          });
        if (
          name === 'subscription_claim_live_order' &&
          f.db.rpc.mock.calls.filter(([n]) => n === name).length === 1
        )
          Object.assign(result.data!, { action });
        return result;
      });
      const fetchImpl = vi.fn(async () => {
        env.USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED = 'false';
        return Response.json(
          action === 'recovery' ? { count: 1, items: [f.order] } : f.order
        );
      });
      vi.stubGlobal('fetch', fetchImpl);
      await expect(
        prepareLiveCheckout(input, { admin: f.db as never, config, env })
      ).rejects.toThrow('disabled');
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(
        f.db.rpc.mock.calls.filter(
          ([n]) => n === 'subscription_claim_live_order'
        )
      ).toHaveLength(2);
    }
  );
  it('checks a flag closure during the final durable recheck', async () => {
    const f = fixture();
    const env = { ...environment };
    const normal = f.db.rpc.getMockImplementation()!;
    f.db.rpc.mockImplementation(async (name, args) => {
      const result = await normal(name, args);
      if (
        name === 'subscription_claim_live_order' &&
        (result.data as Record<string, unknown>).action === 'bound'
      )
        env.USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED = 'false';
      return result;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(f.order))
    );
    await expect(
      prepareLiveCheckout(input, { admin: f.db as never, config, env })
    ).rejects.toThrow('disabled');
  });
  it.each([
    'amount_minor',
    'tier',
    'monthly_offer_id',
    'offer_contract_version',
    'catalog_version',
  ])('rejects drift in %s before POST and at recheck', async (field) => {
    for (const phase of ['claim', 'recheck']) {
      const f = fixture();
      const normal = f.db.rpc.getMockImplementation()!;
      f.db.rpc.mockImplementation(async (name, args) => {
        const result = await normal(name, args);
        if (
          name === 'subscription_claim_live_order' &&
          (phase === 'claim' ||
            (result.data as Record<string, unknown>).action === 'bound')
        )
          Object.assign(result.data!, {
            [field]: field === 'amount_minor' ? 79900 : 'changed',
          });
        return result;
      });
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(f.order));
      vi.stubGlobal('fetch', fetchImpl);
      await expect(
        prepareLiveCheckout(input, {
          admin: f.db as never,
          config,
          env: environment,
        })
      ).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(phase === 'claim' ? 0 : 1);
    }
  });
  it('claims once before POST; lost response retry is GET-only', async () => {
    const f = fixture();
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      methods.push(init?.method ?? 'GET');
      expect(f.db.rpc.mock.calls.at(-1)?.[0]).toBe(
        'subscription_claim_live_order'
      );
      if (methods.length === 1) throw new Error('synthetic lost response');
      return Response.json({ count: 1, items: [f.order] });
    });
    vi.stubGlobal('fetch', fetchImpl);
    await expect(
      prepareLiveCheckout(input, {
        admin: f.db as never,
        config,
        env: environment,
      })
    ).rejects.toThrow('lost response');
    const normal = f.db.rpc.getMockImplementation()!;
    let retried = false;
    f.db.rpc.mockImplementation(async (name, args) => {
      const result = await normal(name, args);
      if (name === 'subscription_claim_live_order' && !retried) {
        retried = true;
        Object.assign(result.data!, {
          action: 'recovery',
          provider_order_id: null,
        });
      }
      return result;
    });
    await expect(
      prepareLiveCheckout(input, {
        admin: f.db as never,
        config,
        env: environment,
      })
    ).resolves.toMatchObject({ amountMinor: 149900 });
    expect(methods).toEqual(['POST', 'GET']);
  });
  it.each(['create', 'bound'])(
    'withholds monthly Checkout when %s crosses durable expiry/source containment',
    async (action) => {
      const f = fixture();
      const normal = f.db.rpc.getMockImplementation()!;
      let claims = 0;
      f.db.rpc.mockImplementation(async (name, args) => {
        const result = await normal(name, args);
        if (name === 'subscription_claim_live_order') {
          if (++claims === 2) return { data: null, error: { code: '55000' } };
          Object.assign(result.data!, {
            action,
            provider_order_id: action === 'bound' ? orderId : null,
          });
        }
        return result;
      });
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(f.order));
      vi.stubGlobal('fetch', fetchImpl);
      await expect(
        prepareLiveCheckout(input, {
          admin: f.db as never,
          config,
          env: environment,
        })
      ).rejects.toThrow('changed during');
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  );
  it('refuses a monthly Starter claim missing identity rather than downgrading its price', async () => {
    const f = fixture('starter', 79900);
    const normal = f.db.rpc.getMockImplementation()!;
    f.db.rpc.mockImplementation(async (name, args) => {
      const result = await normal(name, args);
      if (name === 'subscription_claim_live_order') {
        for (const key of [
          'offer_contract_version',
          'catalog_version',
          'tier',
          'monthly_offer_id',
          'included_branches',
          'paid_extra_branch_slots',
        ])
          delete (result.data as Record<string, unknown>)[key];
      }
      return result;
    });
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    await expect(
      prepareLiveCheckout(input, {
        admin: f.db as never,
        config,
        env: environment,
      })
    ).rejects.toThrow('did not match');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { tier: 'starter' },
    { offer_contract_version: 'unknown' },
    { offer_contract_version: 'monthly_first_v1' },
  ])('rejects partial/unknown legacy claim identity %j', async (change) => {
    const f = fixture('starter', 79900);
    Object.assign(f.row, {
      offer_contract_version: 'starter_v1',
      catalog_version: null,
      monthly_offer_id: null,
    });
    const normal = f.db.rpc.getMockImplementation()!;
    f.db.rpc.mockImplementation(async (name, args) => {
      const result = await normal(name, args);
      if (name === 'subscription_claim_live_order') {
        for (const key of [
          'offer_contract_version',
          'catalog_version',
          'tier',
          'monthly_offer_id',
          'included_branches',
          'paid_extra_branch_slots',
        ])
          delete (result.data as Record<string, unknown>)[key];
        Object.assign(result.data!, change);
      }
      return result;
    });
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    await expect(
      prepareLiveCheckout(input, {
        admin: f.db as never,
        config,
        env: environment,
      })
    ).rejects.toThrow('did not match');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('requires signed event time before any capture lookup or provider GET', async () => {
    const f = fixture();
    const fetchPayment = vi.fn();
    await expect(
      settleCapturedLivePayment(
        { orderId, paymentId, captureEventAt: '' },
        { admin: f.db as never, config, env: environment, fetchPayment }
      )
    ).rejects.toThrow('Signed Live capture');
    expect(f.db.rpc).not.toHaveBeenCalled();
    expect(fetchPayment).not.toHaveBeenCalled();
  });
  it.each([0, 2])('keeps %i recovered orders under review', async (count) => {
    const f = fixture();
    const authority = await resolveLiveProviderAuthority(
      { requestId },
      config,
      f.db as never
    );
    const fetchImpl = vi.fn(async () =>
      Response.json({ count, items: count ? [f.order, f.order] : [] })
    );
    expect(
      await recoverLiveOrder(config, { ...f.facts, authority }, fetchImpl)
    ).toBeNull();
  });
  it.each([
    'usefuldesk_contract_version',
    'usefuldesk_catalog_version',
    'usefuldesk_catalog_tier',
    'usefuldesk_monthly_offer_id',
    'usefuldesk_request_id',
    'usefuldesk_organization_id',
  ])('refuses changed provider note %s', async (field) => {
    const f = fixture();
    const authority = await resolveLiveProviderAuthority(
      { requestId },
      config,
      f.db as never
    );
    const fetchImpl = vi.fn(async () =>
      Response.json({
        ...f.order,
        notes: { ...f.order.notes, [field]: 'gym-member-collection' },
      })
    );
    await expect(
      fetchLiveOrder(config, { ...f.facts, authority, orderId }, fetchImpl)
    ).rejects.toThrow('does not match');
  });
  it.each(cases)(
    'continues signed capture and GET-only order/refund recovery with %s initiation closed',
    async (tier, amount, branches) => {
      const f = fixture(tier, amount, branches);
      const env = {
        ...environment,
        USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED: 'false',
        USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: 'false',
        NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI: 'false',
      };
      const payment = {
        id: paymentId,
        order_id: orderId,
        amount,
        currency: 'INR',
        status: 'captured',
        captured: true,
        amount_refunded: 0,
      };
      const fetchImpl = vi.fn(async (url) =>
        Response.json(String(url).includes('/payments/') ? payment : f.order)
      );
      vi.stubGlobal('fetch', fetchImpl);
      await expect(
        settleCapturedLivePayment(
          { orderId, paymentId, captureEventAt: '2026-10-03T08:00:00Z' },
          { admin: f.db as never, config, env }
        )
      ).resolves.toMatchObject({ status: 'verified' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(f.db.rpc).toHaveBeenLastCalledWith(
        'subscription_commit_live_initial_payment',
        expect.objectContaining({
          p_capture_event_at: '2026-10-03T08:00:00Z',
          p_amount_minor: amount,
        })
      );
      const authority = await resolveLiveProviderAuthority(
        { requestId },
        config,
        f.db as never
      );
      const refund = {
        id: 'rfnd_SyntheticMonthly',
        payment_id: paymentId,
        amount,
        currency: 'INR',
        receipt: refundId,
        status: 'pending',
        notes: {
          usefuldesk_request_id: refundId,
          usefuldesk_organization_id: organizationId,
        },
      };
      await expect(
        recoverLiveFullRefund(
          config,
          {
            ...f.facts,
            authority,
            orderId,
            paymentId,
            refundRequestId: refundId,
          },
          vi.fn(async () => Response.json({ count: 1, items: [refund] }))
        )
      ).resolves.toMatchObject({ status: 'pending' });
      const recoveryFetch = vi.fn<typeof fetch>(async () =>
        Response.json({ count: 1, items: [f.order] })
      );
      await expect(
        recoverLiveFinancialObligations({
          admin: f.db as never,
          config,
          env,
          leaseToken,
          fetchImpl: recoveryFetch,
        })
      ).resolves.toMatchObject({ inspected: 1, recovered: 1 });
      expect(
        recoveryFetch.mock.calls.every(([, init]) => init?.method !== 'POST')
      ).toBe(true);
    }
  );
  it.each([
    { status: 'authorized', captured: false },
    { amount: 79900 },
    { currency: 'USD' },
    { order_id: 'order_Foreign' },
    { id: 'pay_Foreign' },
    { amount_refunded: 1 },
  ])('rejects fresh payment mismatch %j without settlement', async (change) => {
    const f = fixture();
    const authority = await resolveLiveProviderAuthority(
      { requestId },
      config,
      f.db as never
    );
    const fetchImpl = vi.fn(async (url) =>
      Response.json(
        String(url).includes('/payments/')
          ? {
              id: paymentId,
              order_id: orderId,
              amount: 149900,
              currency: 'INR',
              status: 'captured',
              captured: true,
              amount_refunded: 0,
              ...change,
            }
          : f.order
      )
    );
    await expect(
      fetchCapturedLivePayment(
        config,
        { ...f.facts, authority, orderId, paymentId },
        fetchImpl
      )
    ).rejects.toThrow('matching capture');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([
    { offer_contract_version: undefined },
    { monthly_offer_id: null },
    { amount_minor: 79900 },
    { catalog_version: 'unknown' },
    { tier: 'starter' },
  ])('refuses malformed monthly recovery before any GET %j', async (change) => {
    const f = fixture();
    const normal = f.db.rpc.getMockImplementation()!;
    f.db.rpc.mockImplementation(async (name, args) => {
      const result = await normal(name, args);
      if (
        name === 'subscription_claim_live_recovery_items' &&
        Array.isArray(result.data)
      )
        result.data.forEach((item) => Object.assign(item, change));
      return result;
    });
    const fetchImpl = vi.fn();
    await expect(
      recoverLiveFinancialObligations({
        admin: f.db as never,
        config,
        env: environment,
        leaseToken,
        fetchImpl,
      })
    ).rejects.toThrow('identity');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
