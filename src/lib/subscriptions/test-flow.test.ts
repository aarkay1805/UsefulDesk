import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  confirmTestPayment,
  prepareTestCheckout,
  TestBillingConflict,
} from './test-flow';
import {
  createTestOrder,
  fetchCapturedTestPayment,
  testBillingConfig,
  verifyTestCheckoutSignature,
  verifyTestWebhookSignature,
} from './test-provider';

const organizationId = '11111111-1111-4111-8111-111111111111';
const otherOrganizationId = '33333333-3333-4333-8333-333333333333';
const requestId = '22222222-2222-4222-8222-222222222222';
const orderId = 'order_Test123';
const paymentId = 'pay_Test456';
const config = {
  keyId: 'rzp_test_key',
  keySecret: 'test-secret',
  webhookSecret: 'test-webhook-secret',
  merchantId: 'acc_UsefulmadeTest',
};
const intent = {
  request_id: requestId,
  organization_id: organizationId,
  tier: 'growth',
  amount_minor: 149900,
  currency: 'INR',
  provider_order_id: orderId,
  state: 'pending',
};

function admin(dataByName: Record<string, unknown>) {
  const rpc = vi.fn(async (name: string) => ({
    data: dataByName[name],
    error: null,
  }));
  return { rpc } as unknown as NonNullable<
    Parameters<typeof prepareTestCheckout>[1]
  >['admin'] & {
    rpc: typeof rpc;
  };
}

function checkoutSignature() {
  return createHmac('sha256', config.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

describe('Usefulmade Test merchant boundary', () => {
  it('requires a separate complete Test merchant configuration', () => {
    expect(() =>
      testBillingConfig({
        NODE_ENV: 'production',
        USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED: 'true',
        USEFULDESK_SAAS_RAZORPAY_MODE: 'test',
      })
    ).toThrow(/disabled/);
    expect(() =>
      testBillingConfig({
        NODE_ENV: 'test',
        USEFULDESK_SUBSCRIPTION_INTENTS_ENABLED: 'true',
        USEFULDESK_SAAS_RAZORPAY_MODE: 'test',
      })
    ).toThrow(/incomplete/);
  });

  it('signs checkout and webhook bytes with separate secrets', () => {
    expect(
      verifyTestCheckoutSignature(
        orderId,
        paymentId,
        checkoutSignature(),
        config
      )
    ).toBe(true);
    const raw = '{"event":"payment.captured"}';
    const webhookSignature = createHmac('sha256', config.webhookSecret)
      .update(raw)
      .digest('hex');
    expect(verifyTestWebhookSignature(raw, webhookSignature, config)).toBe(
      true
    );
    expect(
      verifyTestWebhookSignature(`${raw} `, webhookSignature, config)
    ).toBe(false);
    expect(
      verifyTestCheckoutSignature(orderId, paymentId, webhookSignature, config)
    ).toBe(false);
  });

  it('creates an INR order tied to this intent with Usefulmade credentials', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from('rzp_test_key:test-secret').toString('base64')}`,
      });
      expect(JSON.parse(String(init.body))).toMatchObject({
        amount: 149900,
        currency: 'INR',
        receipt: requestId,
        partial_payment: false,
        notes: { usefuldesk_organization_id: organizationId },
      });
      return new Response(
        JSON.stringify({
          id: orderId,
          amount: 149900,
          currency: 'INR',
          receipt: requestId,
          status: 'created',
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const order = await createTestOrder(
      config,
      { requestId, organizationId, amountMinor: 149900 },
      fetchImpl
    );
    expect(order.id).toBe(orderId);
  });

  it.each([
    { status: 'authorized', captured: false, amount_refunded: 0 },
    { status: 'captured', captured: true, amount_refunded: 100 },
  ])('rejects an unpaid or refunded provider payment %o', async (status) => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: paymentId,
            order_id: orderId,
            amount: 149900,
            currency: 'INR',
            ...status,
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    await expect(
      fetchCapturedTestPayment(
        config,
        { paymentId, orderId, amountMinor: 149900 },
        fetchImpl
      )
    ).rejects.toThrow(/not a matching captured/);
  });

  it('claims, creates, binds, and returns only the public Checkout key', async () => {
    const db = admin({
      subscription_claim_test_order: { ...intent, action: 'create' },
    });
    const createOrder = vi.fn(async () => ({
      id: orderId,
      amount: 149900,
      currency: 'INR' as const,
      receipt: requestId,
    }));
    const result = await prepareTestCheckout(
      { organizationId, requestId, actorUserId: 'owner-1' },
      { admin: db, config, createOrder }
    );
    expect(result).toMatchObject({
      organizationId,
      requestId,
      orderId,
      amountMinor: 149900,
      keyId: config.keyId,
    });
    expect(JSON.stringify(result)).not.toContain(config.keySecret);
    expect(db.rpc).toHaveBeenCalledWith('subscription_bind_test_order', {
      p_request_id: requestId,
      p_provider_order_id: orderId,
      p_provider_merchant_id: config.merchantId,
    });
  });

  it('does not create a second order after a bound replay or uncertain first attempt', async () => {
    const bound = admin({
      subscription_claim_test_order: { ...intent, action: 'bound' },
    });
    const createOrder = vi.fn();
    const fetchOrder = vi.fn(async () => ({
      id: orderId,
      amount: 149900,
      currency: 'INR' as const,
      receipt: requestId,
    }));
    await prepareTestCheckout(
      { organizationId, requestId, actorUserId: 'owner-1' },
      { admin: bound, config, createOrder, fetchOrder }
    );
    expect(createOrder).not.toHaveBeenCalled();
    const uncertain = admin({
      subscription_claim_test_order: { action: 'recovery' },
    });
    await expect(
      prepareTestCheckout(
        { organizationId, requestId, actorUserId: 'owner-1' },
        { admin: uncertain, config, createOrder }
      )
    ).rejects.toBeInstanceOf(TestBillingConflict);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rejects a claim or callback belonging to another organization', async () => {
    const wrong = admin({
      subscription_claim_test_order: {
        ...intent,
        action: 'create',
        organization_id: otherOrganizationId,
      },
    });
    const createOrder = vi.fn();
    await expect(
      prepareTestCheckout(
        { organizationId, requestId, actorUserId: 'owner-1' },
        { admin: wrong, config, createOrder }
      )
    ).rejects.toThrow(/another organization/);
    expect(createOrder).not.toHaveBeenCalled();
    const callbackDb = admin({ subscription_test_intent_for_order: intent });
    const fetchPayment = vi.fn();
    await expect(
      confirmTestPayment(
        {
          source: 'checkout',
          orderId,
          paymentId,
          checkoutSignature: checkoutSignature(),
          expectedOrganizationId: otherOrganizationId,
        },
        { admin: callbackDb, config, fetchPayment }
      )
    ).rejects.toThrow(/does not belong/);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  it('requires signature and captured provider payment before atomic grant', async () => {
    const db = admin({
      subscription_test_intent_for_order: intent,
      subscription_commit_test_initial_payment: {
        grant: {
          organization_id: organizationId,
          source_intent_id: requestId,
          first_provider_payment_id: paymentId,
        },
      },
    });
    const fetchPayment = vi.fn(async () => ({
      id: paymentId,
      orderId,
      amountMinor: 149900,
      currency: 'INR' as const,
    }));
    await expect(
      confirmTestPayment(
        {
          source: 'checkout',
          orderId,
          paymentId,
          checkoutSignature: '0'.repeat(64),
          expectedOrganizationId: organizationId,
        },
        { admin: db, config, fetchPayment }
      )
    ).rejects.toThrow(/signature/);
    expect(fetchPayment).not.toHaveBeenCalled();
    const result = await confirmTestPayment(
      {
        source: 'checkout',
        orderId,
        paymentId,
        checkoutSignature: checkoutSignature(),
        expectedOrganizationId: organizationId,
        expectedRequestId: requestId,
      },
      { admin: db, config, fetchPayment }
    );
    expect(result).toMatchObject({ organizationId, requestId, paymentId });
    expect(fetchPayment).toHaveBeenCalledOnce();
    expect(db.rpc).toHaveBeenCalledWith(
      'subscription_commit_test_initial_payment',
      expect.objectContaining({
        p_amount_minor: 149900,
        p_provider_merchant_id: config.merchantId,
      })
    );
  });

  it('acknowledges a previously committed payment without re-reading refunded provider state', async () => {
    const db = admin({
      subscription_test_intent_for_order: { ...intent, state: 'verified' },
      subscription_commit_test_initial_payment: {
        grant: {
          organization_id: organizationId,
          source_intent_id: requestId,
          first_provider_payment_id: paymentId,
        },
      },
    });
    const fetchPayment = vi.fn();
    await confirmTestPayment(
      { source: 'webhook', orderId, paymentId },
      { admin: db, config, fetchPayment }
    );
    expect(fetchPayment).not.toHaveBeenCalled();
  });
});
