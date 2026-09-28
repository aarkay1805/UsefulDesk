import { describe, expect, it, vi } from 'vitest';
import { reserveTestFirstRefund } from './test-refund-claims';
import { fetchTestFirstPaymentTime } from './test-provider';
const org = '11111111-1111-4111-8111-111111111111';
const req = '22222222-2222-4222-8222-222222222222';
const config = {
  keyId: 'rzp_test_key',
  keySecret: 'secret',
  webhookSecret: 'webhook',
  merchantId: 'acc_Test',
};
const payment = {
  organization_id: org,
  provider_payment_id: 'pay_First',
  provider_order_id: 'order_First',
  provider_merchant_id: 'acc_Test',
  provider_mode: 'test',
  currency: 'INR',
  amount_minor: 79900,
};
const claim = {
  organization_id: org,
  request_id: req,
  provider_payment_id: 'pay_First',
  amount_minor: 79900,
  state: 'requested',
};
const input = {
  organizationId: org,
  requestId: req,
  actorUserId: 'owner',
  receivedAt: '2026-09-28T00:00:00.000Z',
};
function db(first: unknown = { payment, claim: null }) {
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'subscription_test_first_payment'
        ? first
        : name === 'subscription_receive_test_refund_request'
          ? {
              organization_id: org,
              request_id: req,
              requested_at: input.receivedAt,
            }
          : claim,
  }));
  return { rpc } as unknown as NonNullable<
    Parameters<typeof reserveTestFirstRefund>[1]
  >['admin'] & { rpc: typeof rpc };
}
describe('durable Test first-payment refund requests', () => {
  it('records server receipt time and verified provider time, never browser amount or timezone', async () => {
    const admin = db();
    const fetchPaymentTime = vi.fn(async () => '2026-09-21T00:00:00.000Z');
    expect(
      await reserveTestFirstRefund(input, { admin, config, fetchPaymentTime })
    ).toEqual(claim);
    expect(admin.rpc).toHaveBeenLastCalledWith(
      'subscription_reserve_test_first_refund',
      {
        p_organization_id: org,
        p_request_id: req,
        p_actor_user_id: 'owner',
        p_provider_merchant_id: 'acc_Test',
        p_provider_payment_id: 'pay_First',
        p_paid_at: '2026-09-21T00:00:00.000Z',
        p_requested_at: input.receivedAt,
      }
    );
    expect(fetchPaymentTime).toHaveBeenCalledWith(config, {
      paymentId: 'pay_First',
      orderId: 'order_First',
      amountMinor: 79900,
    });
  });
  it('returns the original claim after browser loss without another provider request', async () => {
    const admin = db({ payment, claim });
    const fetchPaymentTime = vi.fn();
    expect(
      await reserveTestFirstRefund(
        { ...input, requestId: 'another-request' },
        { admin, config, fetchPaymentTime }
      )
    ).toEqual(claim);
    expect(fetchPaymentTime).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { organization_id: 'another' },
    { provider_merchant_id: 'acc_Other' },
    { provider_mode: 'live' },
  ])(
    'rejects payment identity mismatches before provider lookup %o',
    async (changed) => {
      const admin = db({ payment: { ...payment, ...changed } });
      const fetchPaymentTime = vi.fn();
      await expect(
        reserveTestFirstRefund(input, { admin, config, fetchPaymentTime })
      ).rejects.toThrow('does not belong');
      expect(fetchPaymentTime).not.toHaveBeenCalled();
    }
  );
  it('persists the original receipt before provider verification can fail', async () => {
    const admin = db();
    await expect(
      reserveTestFirstRefund(input, {
        admin,
        config,
        fetchPaymentTime: vi.fn(async () => {
          throw new Error('unavailable');
        }),
      })
    ).rejects.toThrow('unavailable');
    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(admin.rpc).toHaveBeenLastCalledWith(
      'subscription_receive_test_refund_request',
      expect.objectContaining({ p_received_at: input.receivedAt })
    );
  });
  it('uses the saved receipt time when retrying days after a provider outage', async () => {
    const admin = db();
    const fetchPaymentTime = vi.fn(async () => '2026-09-21T00:00:00.000Z');
    await reserveTestFirstRefund(
      { ...input, receivedAt: '2026-10-01T00:00:00.000Z' },
      { admin, config, fetchPaymentTime }
    );
    expect(admin.rpc).toHaveBeenLastCalledWith(
      'subscription_reserve_test_first_refund',
      expect.objectContaining({ p_requested_at: input.receivedAt })
    );
  });
  it('fetches payment time using GET only and refuses partially refunded payments', async () => {
    const entity = {
      id: 'pay_First',
      order_id: 'order_First',
      amount: 79900,
      currency: 'INR',
      status: 'captured',
      captured: true,
      amount_refunded: 0,
      created_at: 1790467200,
    };
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      return Response.json(entity);
    });
    expect(
      await fetchTestFirstPaymentTime(
        config,
        { paymentId: 'pay_First', orderId: 'order_First', amountMinor: 79900 },
        fetchImpl
      )
    ).toBe(new Date(entity.created_at * 1000).toISOString());
    for (const changed of [
      { created_at: undefined },
      { created_at: -1 },
      { created_at: 1.1 },
      { amount_refunded: 1 },
      { status: 'authorized' },
      { order_id: 'order_Other' },
    ]) {
      await expect(
        fetchTestFirstPaymentTime(
          config,
          {
            paymentId: 'pay_First',
            orderId: 'order_First',
            amountMinor: 79900,
          },
          vi.fn(async () => Response.json({ ...entity, ...changed }))
        )
      ).rejects.toThrow('do not match');
    }
  });
});
