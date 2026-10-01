import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  classifyLiveWebhookOrder,
  createLiveFullRefund,
  createLiveOrder,
  fetchCapturedLivePayment,
  fetchLivePaymentOrderId,
  fetchSettledLiveFullRefund,
  liveBillingConfig,
  recoverLiveOrder,
  verifyLiveCheckoutSignature,
  verifyLiveWebhookSignature,
} from './live-provider';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const refundRequestId = '33333333-3333-4333-8333-333333333333';
const orderId = 'order_Live123';
const paymentId = 'pay_Live456';
const refundId = 'rfnd_Live789';
const env = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_live_Usefulmade',
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: 'live-key-secret',
  USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: 'live-webhook-secret',
  USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'acc_UsefulmadeLive',
  USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID: organizationId,
  USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_ORDERS_ENABLED: 'false',
  USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED: 'false',
} as NodeJS.ProcessEnv;
const config = liveBillingConfig(env);
const facts = { requestId, organizationId, amountMinor: 79900 };
const refundFacts = { ...facts, orderId, paymentId, refundRequestId };
const order = {
  id: orderId,
  amount: facts.amountMinor,
  currency: 'INR',
  receipt: requestId,
  status: 'created',
  notes: {
    usefuldesk_organization_id: organizationId,
    usefuldesk_request_id: requestId,
  },
};
const payment = {
  id: paymentId,
  order_id: orderId,
  amount: facts.amountMinor,
  currency: 'INR',
  status: 'captured',
  captured: true,
  amount_refunded: 0,
};
const refund = {
  id: refundId,
  payment_id: paymentId,
  amount: facts.amountMinor,
  currency: 'INR',
  receipt: refundRequestId,
  status: 'processed',
  notes: {
    usefuldesk_organization_id: organizationId,
    usefuldesk_request_id: refundRequestId,
  },
};

function response(value: unknown) {
  return Response.json(value);
}

describe('Usefulmade Live merchant adapter', () => {
  it('requires Production deployment, Live credentials, merchant and one pilot', () => {
    expect(() => liveBillingConfig({ ...env, NODE_ENV: 'test' })).toThrow();
    expect(() =>
      liveBillingConfig({ ...env, VERCEL_ENV: 'preview' })
    ).toThrow();
    expect(() =>
      liveBillingConfig({ ...env, USEFULDESK_SAAS_RAZORPAY_MODE: 'test' })
    ).toThrow();
    expect(() =>
      liveBillingConfig({
        ...env,
        USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_test_wrong',
      })
    ).toThrow();
    expect(() =>
      liveBillingConfig({
        ...env,
        USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'wrong',
      })
    ).toThrow();
    expect(() =>
      liveBillingConfig({
        ...env,
        USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID: 'wrong',
      })
    ).toThrow();
    expect(() =>
      liveBillingConfig({
        ...env,
        USEFULDESK_SAAS_RAZORPAY_TEST_KEY_ID: 'rzp_test_leak',
      })
    ).toThrow();
    expect(() =>
      liveBillingConfig({
        ...env,
        USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'false',
      })
    ).toThrow();
  });

  it('checks Checkout and raw webhook bytes with separate secrets', () => {
    const checkout = createHmac('sha256', config.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    const raw = '{"event":"payment.captured"}';
    const webhook = createHmac('sha256', config.webhookSecret)
      .update(raw)
      .digest('hex');
    expect(
      verifyLiveCheckoutSignature(orderId, paymentId, checkout, config)
    ).toBe(true);
    expect(
      verifyLiveCheckoutSignature(orderId, paymentId, webhook, config)
    ).toBe(false);
    expect(verifyLiveWebhookSignature(raw, webhook, config)).toBe(true);
    expect(verifyLiveWebhookSignature(`${raw} `, webhook, config)).toBe(false);
  });

  it('makes no provider POST while the distinct Live order/refund switches are off', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      createLiveOrder(config, facts, fetchImpl, env)
    ).rejects.toThrow('disabled');
    await expect(
      createLiveFullRefund(config, refundFacts, fetchImpl, env)
    ).rejects.toThrow('disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates only a pinned pilot order with exact receipt, notes and amount', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toMatchObject({
        amount: facts.amountMinor,
        receipt: requestId,
        partial_payment: false,
        notes: { usefuldesk_organization_id: organizationId },
      });
      return response(order);
    }) as unknown as typeof fetch;
    await expect(
      createLiveOrder(config, facts, fetchImpl, {
        ...env,
        USEFULDESK_SAAS_LIVE_ORDERS_ENABLED: 'true',
      })
    ).resolves.toMatchObject({ id: orderId, amountMinor: facts.amountMinor });
    await expect(
      createLiveOrder(
        config,
        { ...facts, organizationId: refundRequestId },
        fetchImpl,
        {
          ...env,
          USEFULDESK_SAAS_LIVE_ORDERS_ENABLED: 'true',
        }
      )
    ).rejects.toThrow('outside the Live pilot');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('refuses ambiguous or cross-organization order recovery', async () => {
    const ambiguous = vi.fn(async () =>
      response({ count: 2, items: [order, order] })
    ) as unknown as typeof fetch;
    await expect(
      recoverLiveOrder(config, facts, ambiguous)
    ).resolves.toBeNull();
    const wrong = vi.fn(async () =>
      response({
        count: 1,
        items: [
          {
            ...order,
            notes: {
              ...order.notes,
              usefuldesk_organization_id: refundRequestId,
            },
          },
        ],
      })
    ) as unknown as typeof fetch;
    await expect(recoverLiveOrder(config, facts, wrong)).rejects.toThrow(
      'identity'
    );
  });

  it('requires a fresh matching order and captured payment', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      response(url.includes('/orders/') ? order : payment)
    ) as unknown as typeof fetch;
    await expect(
      fetchCapturedLivePayment(
        config,
        { ...facts, orderId, paymentId },
        fetchImpl
      )
    ).resolves.toMatchObject({ id: paymentId, orderId });
    const wrongAmount = vi.fn(async (url: string) =>
      response(url.includes('/orders/') ? order : { ...payment, amount: 1 })
    ) as unknown as typeof fetch;
    await expect(
      fetchCapturedLivePayment(
        config,
        { ...facts, orderId, paymentId },
        wrongAmount
      )
    ).rejects.toThrow('matching capture');
  });

  it.each([
    ['changed order ID', { ...order, id: 'order_Different' }],
    ['changed receipt', { ...order, receipt: refundRequestId }],
    [
      'changed request note',
      {
        ...order,
        notes: { ...order.notes, usefuldesk_request_id: refundRequestId },
      },
    ],
  ])(
    'refuses capture and refund preflight with a %s',
    async (_reason, value) => {
      const fetchImpl = vi.fn(async () => response(value));
      await expect(
        fetchCapturedLivePayment(
          config,
          { ...facts, orderId, paymentId },
          fetchImpl
        )
      ).rejects.toThrow('identity');
      expect(fetchImpl).toHaveBeenCalledOnce();
      fetchImpl.mockClear();
      await expect(
        createLiveFullRefund(config, refundFacts, fetchImpl, {
          ...env,
          USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED: 'true',
        })
      ).rejects.toThrow('identity');
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl).toHaveBeenCalledWith(
        `https://api.razorpay.com/v1/orders/${orderId}`,
        expect.objectContaining({ method: 'GET' })
      );
    }
  );

  it('classifies only exact pilot order notes as SaaS on a shared merchant', async () => {
    const fetchImpl = vi.fn(async () =>
      response(order)
    ) as unknown as typeof fetch;
    await expect(
      classifyLiveWebhookOrder(config, orderId, fetchImpl)
    ).resolves.toBe('saas');
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.razorpay.com/v1/orders/${orderId}`,
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('recognizes only clearly foreign orders and keeps ambiguous ones retryable', async () => {
    const cases: { value: unknown; result: 'unrelated' | 'ambiguous' }[] = [
      {
        value: {
          ...order,
          receipt: 'gym-order-1',
          notes: { usefuldesk_account_id: 'gym-account' },
        },
        result: 'unrelated',
      },
      { value: { ...order, receipt: null, notes: [] }, result: 'unrelated' },
      {
        value: { ...order, receipt: requestId, notes: {} },
        result: 'ambiguous',
      },
      {
        value: {
          ...order,
          receipt: 'gym-order-1',
          notes: { usefuldesk_request_id: requestId },
        },
        result: 'ambiguous',
      },
      {
        value: {
          ...order,
          receipt: requestId,
          notes: { usefuldesk_request_id: requestId },
        },
        result: 'ambiguous',
      },
      {
        value: {
          ...order,
          receipt: requestId,
          notes: {
            ...order.notes,
            usefuldesk_organization_id: refundRequestId,
          },
        },
        result: 'ambiguous',
      },
      { value: { ...order, id: 'order_Different' }, result: 'ambiguous' },
      {
        value: { ...order, receipt: 'gym-order-1', notes: ['unexpected'] },
        result: 'ambiguous',
      },
    ];
    for (const { value, result } of cases) {
      const fetchImpl = vi.fn(async () =>
        response(value)
      ) as unknown as typeof fetch;
      if (result === 'unrelated') {
        await expect(
          classifyLiveWebhookOrder(config, orderId, fetchImpl)
        ).resolves.toBe('unrelated');
      } else {
        await expect(
          classifyLiveWebhookOrder(config, orderId, fetchImpl)
        ).rejects.toThrow();
      }
    }
    const unavailable = vi.fn(
      async () => new Response(null, { status: 503 })
    ) as unknown as typeof fetch;
    await expect(
      classifyLiveWebhookOrder(config, orderId, unavailable)
    ).rejects.toThrow();
  });

  it('requires a fresh matching payment before treating a null order as foreign', async () => {
    const withoutOrder = vi.fn(async () =>
      response({ id: paymentId, order_id: null })
    ) as unknown as typeof fetch;
    await expect(
      fetchLivePaymentOrderId(config, paymentId, withoutOrder)
    ).resolves.toBeNull();
    const wrongPayment = vi.fn(async () =>
      response({ id: 'pay_Different', order_id: null })
    ) as unknown as typeof fetch;
    await expect(
      fetchLivePaymentOrderId(config, paymentId, wrongPayment)
    ).rejects.toThrow('no valid order');
  });

  it('refuses refund POST when an earlier refund exists or settlement is partial', async () => {
    const withExisting = vi.fn(async (url: string) =>
      response(
        url.includes('/orders/')
          ? order
          : url.endsWith('/refunds?count=2')
            ? { count: 1, items: [refund] }
            : payment
      )
    ) as unknown as typeof fetch;
    await expect(
      createLiveFullRefund(config, refundFacts, withExisting, {
        ...env,
        USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED: 'true',
      })
    ).rejects.toThrow('requires review');
    expect(withExisting).toHaveBeenCalledTimes(3);

    const partial = vi.fn(async (url: string) =>
      response(
        url.endsWith(`/${refundId}`)
          ? refund
          : { ...payment, amount_refunded: 1, status: 'refunded' }
      )
    ) as unknown as typeof fetch;
    await expect(
      fetchSettledLiveFullRefund(config, refundFacts, refundId, partial)
    ).rejects.toThrow('not fully refunded');
  });
});
