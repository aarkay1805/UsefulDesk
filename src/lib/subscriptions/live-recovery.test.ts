import { describe, expect, it, vi } from 'vitest';

import { recoverLiveFinancialObligations } from './live-recovery';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const refundRequestId = '33333333-3333-4333-8333-333333333333';
const leaseToken = '44444444-4444-4444-8444-444444444444';
const config = {
  keyId: 'rzp_live_Usefulmade',
  keySecret: 'private-key-secret',
  webhookSecret: 'private-webhook-secret',
  merchantId: 'acc_UsefulmadeLive',
  pilotOrganizationId: organizationId,
};
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: config.keyId,
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: config.keySecret,
  USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: config.webhookSecret,
  USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: config.merchantId,
  USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID: organizationId,
  USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED: 'true',
};
const orderClaim = {
  item_type: 'order',
  item_id: requestId,
  lease_token: leaseToken,
  request_id: requestId,
  organization_id: organizationId,
  provider_merchant_id: config.merchantId,
  provider_order_id: null,
  provider_payment_id: null,
  provider_refund_id: null,
  amount_minor: 79900,
  currency: 'INR',
};
const refundClaim = {
  ...orderClaim,
  item_type: 'refund',
  item_id: refundRequestId,
  provider_order_id: 'order_Live123',
  provider_payment_id: 'pay_Live456',
  provider_refund_id: null,
};
const order = {
  id: 'order_Live123',
  amount: 79900,
  currency: 'INR',
  receipt: requestId,
  status: 'paid',
  notes: {
    usefuldesk_request_id: requestId,
    usefuldesk_organization_id: organizationId,
  },
};
const refund = {
  id: 'rfnd_Live789',
  payment_id: 'pay_Live456',
  amount: 79900,
  currency: 'INR',
  receipt: refundRequestId,
  status: 'pending',
  notes: {
    usefuldesk_request_id: refundRequestId,
    usefuldesk_organization_id: organizationId,
  },
};
function provider(...bodies: unknown[]) {
  return vi.fn(
    async () => new Response(JSON.stringify(bodies.shift()), { status: 200 })
  );
}
function database(items: unknown[] = [orderClaim]) {
  const rpc = vi.fn(
    async (
      name: string,
      args: Record<string, unknown>
    ): Promise<{ data: unknown; error: unknown }> => ({
      error: null,
      data:
        name === 'subscription_claim_live_recovery_items'
          ? items
          : name === 'subscription_bind_live_order'
            ? {
                request_id: requestId,
                organization_id: organizationId,
                provider_order_id: order.id,
              }
            : name === 'subscription_observe_live_refund'
              ? {
                  refund_request_id: refundRequestId,
                  provider_refund_id: refund.id,
                  state: args.p_status,
                }
              : name === 'subscription_commit_live_full_refund'
                ? {
                    refund_request_id: refundRequestId,
                    provider_refund_id: refund.id,
                    confirmed_at: '2026-09-30T00:00:00Z',
                    review_reason: null,
                  }
                : {
                    item_type: args.p_item_type,
                    item_id: args.p_item_id,
                    outcome: args.p_outcome,
                    reason: args.p_reason,
                    completed: args.p_outcome === 'recovered',
                  },
    })
  );
  return { rpc };
}
function run(
  db: ReturnType<typeof database>,
  fetchImpl: ReturnType<typeof provider>,
  override = {}
) {
  return recoverLiveFinancialObligations({
    admin: db as never,
    env,
    config,
    leaseToken,
    fetchImpl: fetchImpl as typeof fetch,
    ...override,
  });
}
function expectOnlyGet(fetchImpl: ReturnType<typeof provider>) {
  expect(fetchImpl).toHaveBeenCalled();
  for (const call of fetchImpl.mock.calls as unknown as [string, RequestInit][])
    expect(call[1]).toMatchObject({
      method: 'GET',
      body: undefined,
      cache: 'no-store',
    });
}

describe('GET-only financial obligation recovery', () => {
  it.each([
    'USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED',
    'USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED',
    'USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED',
    'USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED',
  ])('fails closed before any I/O when %s is disabled', async (flag) => {
    const db = database();
    const fetchImpl = provider();
    await expect(
      run(db, fetchImpl, { env: { ...env, [flag]: 'false' } })
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('binds the original paid order while initiation is closed without fabricating capture evidence or access', async () => {
    const db = database();
    const fetchImpl = provider({ count: 1, items: [order] });
    const result = await run(db, fetchImpl);
    expect(result.items[0]).toMatchObject({
      outcome: 'recovered',
      reason: 'order_bound_signed_event_required',
      recorded: true,
    });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
      'subscription_claim_live_recovery_items',
      'subscription_bind_live_order',
      'subscription_finish_live_recovery_item',
    ]);
    expect(db.rpc).toHaveBeenCalledWith('subscription_bind_live_order', {
      p_request_id: requestId,
      p_provider_order_id: order.id,
      p_provider_merchant_id: config.merchantId,
      p_pilot_organization_id: organizationId,
    });
    expectOnlyGet(fetchImpl);
    const output = JSON.stringify(result);
    expect(output).not.toContain(config.keySecret);
    expect(output).not.toContain(config.webhookSecret);
    expect(output).not.toContain(order.id);
  });

  it.each([
    { count: 0, items: [] },
    { count: 2, items: [order, order] },
  ])(
    'retains zero or multiple matches as an owned exception, never retrying POST',
    async (body) => {
      const db = database();
      const fetchImpl = provider(body);
      expect((await run(db, fetchImpl)).items[0]).toMatchObject({
        outcome: 'review_required',
        reason: 'lookup_not_unique',
      });
      expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
        'subscription_claim_live_recovery_items',
        'subscription_finish_live_recovery_item',
      ]);
      expectOnlyGet(fetchImpl);
    }
  );

  it.each([
    { receipt: refundRequestId },
    { amount: 79899 },
    { currency: 'USD' },
    { notes: { usefuldesk_organization_id: organizationId } },
    {
      notes: {
        usefuldesk_request_id: requestId,
        usefuldesk_organization_id: refundRequestId,
      },
    },
  ])(
    'does not bind provider order facts that fail exact verification: %j',
    async (changed) => {
      const db = database();
      const fetchImpl = provider({
        count: 1,
        items: [{ ...order, ...changed }],
      });
      expect((await run(db, fetchImpl)).items[0]).toMatchObject({
        outcome: 'retry',
        reason: 'provider_lookup_unverified',
      });
      expect(db.rpc).not.toHaveBeenCalledWith(
        'subscription_bind_live_order',
        expect.anything()
      );
      expectOnlyGet(fetchImpl);
    }
  );

  it('records a provider 404 without disclosing its response and retries the same claim later', async () => {
    const db = database();
    const missing = vi.fn(
      async () => new Response('private provider body', { status: 404 })
    );
    const first = await run(db, missing);
    expect(first.failed).toBe(1);
    expect(first.items[0].reason).toBe('provider_lookup_unverified');
    expect(JSON.stringify(first)).not.toContain('private provider body');
    const recovered = await run(db, provider({ count: 1, items: [order] }));
    expect(recovered.recovered).toBe(1);
  });

  it('binds an unbound original refund and polls a bound pending refund without later webhook', async () => {
    const db = database([refundClaim]);
    const fetchImpl = provider({ count: 1, items: [refund] });
    expect((await run(db, fetchImpl)).items[0]).toMatchObject({
      outcome: 'pending',
      reason: 'refund_pending',
    });
    expect(db.rpc).not.toHaveBeenCalledWith(
      'subscription_commit_live_full_refund',
      expect.anything()
    );
    const bound = database([{ ...refundClaim, provider_refund_id: refund.id }]);
    const poll = provider({ ...refund, status: 'failed' });
    expect((await run(bound, poll)).items[0]).toMatchObject({
      outcome: 'failed',
      reason: 'refund_failed',
    });
    expectOnlyGet(fetchImpl);
    expectOnlyGet(poll);
  });

  it.each([
    { receipt: requestId },
    { amount: 50000 },
    { payment_id: 'pay_Foreign' },
    {
      notes: {
        usefuldesk_request_id: refundRequestId,
        usefuldesk_organization_id: requestId,
      },
    },
  ])('rejects an unmatched original refund: %j', async (changed) => {
    const db = database([refundClaim]);
    const fetchImpl = provider({
      count: 1,
      items: [{ ...refund, ...changed }],
    });
    expect((await run(db, fetchImpl)).failed).toBe(1);
    expect(db.rpc).not.toHaveBeenCalledWith(
      'subscription_observe_live_refund',
      expect.anything()
    );
    expectOnlyGet(fetchImpl);
  });

  it('confirms a bound refund only after processed refund and full original parent payment GETs', async () => {
    const db = database([{ ...refundClaim, provider_refund_id: refund.id }]);
    const processed = { ...refund, status: 'processed' };
    const fetchImpl = provider(processed, processed, {
      id: refundClaim.provider_payment_id,
      order_id: order.id,
      amount: 79900,
      currency: 'INR',
      status: 'refunded',
      amount_refunded: 79900,
    });
    expect((await run(db, fetchImpl)).items[0]).toMatchObject({
      outcome: 'recovered',
      reason: 'refund_confirmed',
    });
    expect(db.rpc).toHaveBeenCalledWith(
      'subscription_commit_live_full_refund',
      expect.objectContaining({
        p_refund_request_id: refundRequestId,
        p_provider_refund_id: refund.id,
      })
    );
    expectOnlyGet(fetchImpl);
  });

  it('leaves access unchanged when parent refund evidence does not match', async () => {
    const db = database([{ ...refundClaim, provider_refund_id: refund.id }]);
    const processed = { ...refund, status: 'processed' };
    const fetchImpl = provider(processed, processed, {
      id: refundClaim.provider_payment_id,
      order_id: order.id,
      amount: 79900,
      currency: 'INR',
      status: 'captured',
      amount_refunded: 0,
    });
    expect((await run(db, fetchImpl)).items[0].reason).toBe(
      'refund_parent_unverified'
    );
    expect(db.rpc).not.toHaveBeenCalledWith(
      'subscription_commit_live_full_refund',
      expect.anything()
    );
  });

  it('preserves a canonical refund review hold that appeared after claiming the item', async () => {
    const db = database([{ ...refundClaim, provider_refund_id: refund.id }]);
    const normal = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name, args) =>
      name === 'subscription_observe_live_refund'
        ? {
            error: null,
            data: {
              refund_request_id: refundRequestId,
              provider_refund_id: refund.id,
              state: 'review_required',
            },
          }
        : normal(name, args)
    );
    const fetchImpl = provider({ ...refund, status: 'processed' });
    expect((await run(db, fetchImpl)).items[0]).toMatchObject({
      outcome: 'review_required',
      reason: 'refund_review_required',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.rpc).not.toHaveBeenCalledWith(
      'subscription_commit_live_full_refund',
      expect.anything()
    );
  });

  it('reports a rejected local bind and retains the original claim for a GET-only retry', async () => {
    const db = database();
    const normal = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name, args) =>
      name === 'subscription_bind_live_order'
        ? {
            error: null,
            data: {
              request_id: refundRequestId,
              organization_id: organizationId,
              provider_order_id: order.id,
            },
          }
        : normal(name, args)
    );
    const fetchImpl = provider({ count: 1, items: [order] });
    expect((await run(db, fetchImpl)).items[0]).toMatchObject({
      outcome: 'retry',
      reason: 'binding_rejected',
    });
    expectOnlyGet(fetchImpl);
  });

  it('rejects foreign, duplicate and oversized scan contracts before provider or financial I/O', async () => {
    for (const items of [
      [{ ...orderClaim, provider_merchant_id: 'acc_Foreign' }],
      [orderClaim, orderClaim],
      Array(6).fill(orderClaim),
    ]) {
      const db = database(items);
      const fetchImpl = provider();
      await expect(run(db, fetchImpl)).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(db.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it('restricts the scheduler scan to one item and rejects oversized responses before provider I/O', async () => {
    const db = database([orderClaim, refundClaim]);
    const fetchImpl = provider();
    await expect(run(db, fetchImpl, { batchLimit: 1 })).rejects.toThrow(
      'scan failed'
    );
    expect(db.rpc).toHaveBeenCalledWith(
      'subscription_claim_live_recovery_items',
      expect.objectContaining({ p_limit: 1 })
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('honours the lease scan so a concurrent worker with no claimed item cannot duplicate provider work', async () => {
    const db = database();
    db.rpc.mockImplementationOnce(async () => ({
      data: [orderClaim],
      error: null,
    }));
    db.rpc.mockImplementationOnce(async () => ({ data: [], error: null }));
    const fetchImpl = provider({ count: 1, items: [order] });
    const [first, second] = await Promise.all([
      run(db, fetchImpl),
      run(db, fetchImpl),
    ]);
    expect(first.recovered).toBe(1);
    expect(second.inspected).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith(
      'subscription_claim_live_recovery_items',
      expect.objectContaining({ p_limit: 5, p_lease_token: leaseToken })
    );
  });

  it('reports failed lease completion while retaining the original canonical idempotent bind', async () => {
    const db = database();
    const normal = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name, args) =>
      name === 'subscription_finish_live_recovery_item'
        ? { data: null, error: null }
        : normal(name, args)
    );
    const result = await run(db, provider({ count: 1, items: [order] }));
    expect(result.items[0]).toMatchObject({
      outcome: 'retry',
      reason: 'lease_completion_rejected',
      recorded: false,
    });
  });

  it('accepts SQL-proven canonical confirmation from a genuine webhook during the pending refund GET', async () => {
    const db = database([{ ...refundClaim, provider_refund_id: refund.id }]);
    const normal = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name, args) =>
      name === 'subscription_finish_live_recovery_item'
        ? {
            error: null,
            data: {
              item_type: 'refund',
              item_id: refundRequestId,
              outcome: 'recovered',
              reason: 'refund_confirmed',
              completed: true,
            },
          }
        : normal(name, args)
    );
    const result = await run(db, provider(refund));
    expect(result.items[0]).toMatchObject({
      outcome: 'recovered',
      reason: 'refund_confirmed',
      recorded: true,
    });
    expect(db.rpc).not.toHaveBeenCalledWith(
      'subscription_commit_live_full_refund',
      expect.anything()
    );
  });

  it('reports a SQL-proven refund hold raced during GET as an owned review exception', async () => {
    const db = database([{ ...refundClaim, provider_refund_id: refund.id }]);
    const normal = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name, args) =>
      name === 'subscription_finish_live_recovery_item'
        ? {
            error: null,
            data: {
              item_type: 'refund',
              item_id: refundRequestId,
              outcome: 'review_required',
              reason: 'refund_review_required',
              completed: true,
            },
          }
        : normal(name, args)
    );
    const result = await run(db, provider(refund));
    expect(result.items[0]).toMatchObject({
      outcome: 'review_required',
      reason: 'refund_review_required',
      recorded: true,
    });
    expect(result.failed).toBe(0);
    expect(result.exceptions).toBe(1);
    expect(db.rpc).not.toHaveBeenCalledWith(
      'subscription_commit_live_full_refund',
      expect.anything()
    );
  });
});
