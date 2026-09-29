import { describe, expect, it, vi } from 'vitest';
import { executeTestFirstRefund, confirmTestRefund } from './test-refunds';
import {
  createTestFullRefund,
  recoverTestFullRefund,
  fetchTestFullRefund,
  testRefundsEnabled,
} from './test-provider';
const org = '11111111-1111-4111-8111-111111111111';
const req = '22222222-2222-4222-8222-222222222222';
const config = {
  keyId: 'rzp_test_key',
  keySecret: 'secret',
  webhookSecret: 'webhook',
  merchantId: 'acc_Test',
};
const facts = {
  organizationId: org,
  requestId: req,
  paymentId: 'pay_First',
  orderId: 'order_First',
  amountMinor: 79900,
};
const entity = {
  id: 'rfnd_First',
  payment_id: facts.paymentId,
  amount: facts.amountMinor,
  currency: 'INR',
  receipt: req,
  notes: { usefuldesk_organization_id: org, usefuldesk_request_id: req },
  status: 'processed',
};
const payment = {
  id: facts.paymentId,
  order_id: facts.orderId,
  amount: facts.amountMinor,
  currency: 'INR',
  status: 'refunded',
  amount_refunded: facts.amountMinor,
};
const context = {
  action: 'create',
  claim: {
    request_id: req,
    organization_id: org,
    provider_payment_id: facts.paymentId,
    provider_merchant_id: config.merchantId,
    amount_minor: facts.amountMinor,
    currency: 'INR',
  },
  execution: { provider_refund_id: null, confirmed_at: null },
  provider_order_id: facts.orderId,
};
function db(value: unknown = context, failCommit = false) {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'subscription_commit_test_full_refund'
        ? {
            request_id: req,
            provider_refund_id: entity.id,
            confirmed_at: '2026-09-28T12:00:00Z',
          }
        : value,
    error:
      failCommit && name === 'subscription_commit_test_full_refund'
        ? { code: '55000' }
        : null,
  }));
  return { rpc } as unknown as NonNullable<
    Parameters<typeof executeTestFirstRefund>[1]
  >['admin'] & { rpc: typeof rpc };
}
const input = { organizationId: org, actorUserId: 'owner' };
const result = { id: entity.id, status: 'processed' as const };
describe('Test full refund execution and recovery', () => {
  it('binds one provider POST before fresh verification and access commit', async () => {
    const admin = db();
    const createRefund = vi.fn(async () => result);
    const fetchRefund = vi.fn(async () => result);
    expect(
      await executeTestFirstRefund(input, {
        admin,
        config,
        createRefund,
        fetchRefund,
      })
    ).toEqual({ status: 'processed', confirmed: true });
    expect(createRefund).toHaveBeenCalledExactlyOnceWith(config, facts);
    expect(admin.rpc.mock.calls.map(([name]) => name)).toEqual([
      'subscription_claim_test_refund',
      'subscription_observe_test_refund',
      'subscription_observe_test_refund',
      'subscription_commit_test_full_refund',
    ]);
    expect(fetchRefund).toHaveBeenCalledWith(config, facts, entity.id);
  });
  it('recovers an uncertain POST by GET and never sends another refund', async () => {
    const admin = db({ ...context, action: 'recovery' });
    const createRefund = vi.fn();
    const recoverRefund = vi.fn(async () => result);
    await executeTestFirstRefund(input, {
      admin,
      config,
      createRefund,
      recoverRefund,
      fetchRefund: vi.fn(async () => result),
    });
    expect(createRefund).not.toHaveBeenCalled();
    expect(recoverRefund).toHaveBeenCalledExactlyOnceWith(config, facts);
    recoverRefund.mockResolvedValueOnce(null as never);
    await expect(
      executeTestFirstRefund(input, {
        admin,
        config,
        createRefund,
        recoverRefund,
      })
    ).rejects.toThrow('No second refund');
    expect(createRefund).not.toHaveBeenCalled();
  });
  it.each(['pending', 'failed'] as const)(
    'keeps access for a %s refund',
    async (status) => {
      const admin = db({
        ...context,
        action: 'bound',
        execution: { provider_refund_id: entity.id, confirmed_at: null },
      });
      expect(
        await executeTestFirstRefund(input, {
          admin,
          config,
          fetchRefund: vi.fn(async () => ({ id: entity.id, status })),
        })
      ).toEqual({ status, confirmed: false });
      expect(admin.rpc.mock.calls.map(([name]) => name)).not.toContain(
        'subscription_commit_test_full_refund'
      );
    }
  );
  it('preserves observed settlement when a platform correction blocks access commit', async () => {
    const admin = db(context, true);
    await expect(
      executeTestFirstRefund(input, {
        admin,
        config,
        createRefund: vi.fn(async () => result),
        fetchRefund: vi.fn(async () => result),
      })
    ).rejects.toThrow('needs review');
    expect(admin.rpc.mock.calls.map(([name]) => name)).toContain(
      'subscription_observe_test_refund'
    );
  });
  it('acknowledges a processed refund held for a later paid obligation', async () => {
    const admin = db();
    admin.rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_commit_test_full_refund'
          ? {
              request_id: req,
              provider_refund_id: entity.id,
              review_required_at: '2026-09-29T12:00:00Z',
            }
          : name === 'subscription_claim_test_refund'
            ? {
                ...context,
                action: 'bound',
                execution: {
                  provider_refund_id: entity.id,
                  confirmed_at: null,
                },
              }
            : context,
      error: null,
    }));
    expect(
      await executeTestFirstRefund(input, {
        admin,
        config,
        fetchRefund: vi.fn(async () => result),
      })
    ).toEqual({ status: 'review_required', confirmed: false });
    admin.rpc.mockClear();
    admin.rpc.mockResolvedValue({
      data: {
        ...context,
        action: 'review_required',
        execution: {
          provider_refund_id: entity.id,
          confirmed_at: null,
          review_required_at: '2026-09-29T12:00:00Z',
        },
      },
      error: null,
    });
    const fetchRefund = vi.fn();
    expect(
      await executeTestFirstRefund(input, { admin, config, fetchRefund })
    ).toEqual({ status: 'review_required', confirmed: false });
    expect(fetchRefund).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
  it('ignores unrelated webhook refunds and rejects identity mismatches before fetching', async () => {
    const fetchRefund = vi.fn();
    await confirmTestRefund(
      { paymentId: facts.paymentId, refundId: entity.id },
      { admin: db(null), config, fetchRefund }
    );
    await expect(
      confirmTestRefund(
        { paymentId: 'pay_Other', refundId: entity.id },
        { admin: db(), config, fetchRefund }
      )
    ).rejects.toThrow('identity mismatch');
    await expect(
      executeTestFirstRefund(
        { ...input, organizationId: req },
        { admin: db(), config, fetchRefund }
      )
    ).rejects.toThrow('another organization');
    expect(fetchRefund).not.toHaveBeenCalled();
  });
  it('replays a confirmed result without provider calls or a second commit', async () => {
    const admin = db({
      ...context,
      action: 'confirmed',
      execution: { provider_refund_id: entity.id, confirmed_at: '2026-09-28' },
    });
    const fetchRefund = vi.fn();
    expect(
      await executeTestFirstRefund(input, { admin, config, fetchRefund })
    ).toEqual({ status: 'processed', confirmed: true });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(fetchRefund).not.toHaveBeenCalled();
  });
});
describe('Razorpay Test refund verification', () => {
  it('requires the second opt-in and never enables Production or Live', () => {
    const env = {
      NODE_ENV: 'test' as const,
      USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED: 'true',
      USEFULDESK_SAAS_RAZORPAY_MODE: 'test',
      USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED: 'true',
    };
    expect(testRefundsEnabled(env)).toBe(true);
    for (const change of [
      { NODE_ENV: 'production' as const },
      { USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED: 'false' },
      { USEFULDESK_SAAS_RAZORPAY_MODE: 'live' },
    ])
      expect(testRefundsEnabled({ ...env, ...change })).toBe(false);
  });
  it('creates only the full original amount after checking captured payment and existing refunds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...payment,
          status: 'captured',
          captured: true,
          amount_refunded: 0,
        })
      )
      .mockResolvedValueOnce(Response.json({ count: 0, items: [] }))
      .mockResolvedValueOnce(Response.json(entity));
    expect(await createTestFullRefund(config, facts, fetchImpl)).toEqual(
      result
    );
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({
      amount: 79900,
      speed: 'normal',
      receipt: req,
      notes: entity.notes,
    });
    expect(fetchImpl.mock.calls.map(([, init]) => init.method)).toEqual([
      'GET',
      'GET',
      'POST',
    ]);
  });
  it.each([
    { amount: 1 },
    { currency: 'USD' },
    { payment_id: 'pay_Other' },
    { receipt: 'another' },
    { notes: {} },
  ])('rejects mismatched refund evidence %o', async (change) => {
    await expect(
      fetchTestFullRefund(
        config,
        facts,
        entity.id,
        vi.fn(async () => Response.json({ ...entity, ...change }))
      )
    ).rejects.toThrow('does not match');
  });
  it('requires the original payment to be fully refunded before access can end', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json(entity))
      .mockResolvedValueOnce(Response.json({ ...payment, amount_refunded: 1 }));
    await expect(
      fetchTestFullRefund(config, facts, entity.id, fetchImpl)
    ).rejects.toThrow('not settled');
  });
  it('does not assume a receipt is an idempotency key or re-POST an ambiguous recovery', async () => {
    for (const items of [[], [entity, entity]]) {
      const fetchImpl = vi.fn(async () =>
        Response.json({ count: items.length, items })
      );
      expect(await recoverTestFullRefund(config, facts, fetchImpl)).toBeNull();
      expect(fetchImpl.mock.calls).toHaveLength(1);
    }
    const fetchImpl = vi.fn();
    await expect(
      createTestFullRefund(
        { ...config, keyId: 'rzp_live_key' },
        facts,
        fetchImpl
      )
    ).rejects.toThrow('Only Test');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
