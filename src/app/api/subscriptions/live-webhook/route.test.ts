import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpc,
  classifyLiveWebhookOrder,
  fetchLivePaymentOrderId,
  fetchLiveOrder,
  settleCapturedLivePayment,
  reconcileLiveRefund,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  classifyLiveWebhookOrder: vi.fn(),
  fetchLivePaymentOrderId: vi.fn(),
  fetchLiveOrder: vi.fn(),
  settleCapturedLivePayment: vi.fn(),
  reconcileLiveRefund: vi.fn(),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc }),
}));
vi.mock('@/lib/subscriptions/live-provider', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/subscriptions/live-provider')
  >()),
  classifyLiveWebhookOrder,
  fetchLivePaymentOrderId,
  fetchLiveOrder,
}));
vi.mock('@/lib/subscriptions/live-flow', () => ({ settleCapturedLivePayment }));
vi.mock('@/lib/subscriptions/live-refunds', () => ({ reconcileLiveRefund }));
import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const merchantId = 'acc_UsefulmadeLive';
const webhookSecret = 'live-webhook-secret';
const captureEventAt = Math.floor(Date.now() / 1000) - 60;
const captured = {
  account_id: merchantId,
  event: 'payment.captured',
  created_at: captureEventAt,
  payload: {
    payment: { entity: { id: 'pay_Live456', order_id: 'order_Live123' } },
  },
};

function signedRequest(event: unknown, signature?: string) {
  const raw = JSON.stringify(event);
  return new Request(
    'https://desk.usefulmade.com/api/subscriptions/live-webhook',
    {
      method: 'POST',
      headers: {
        'x-razorpay-event-id': 'evt_Live123',
        'x-razorpay-signature':
          signature ??
          createHmac('sha256', webhookSecret).update(raw).digest('hex'),
      },
      body: raw,
    }
  );
}

describe('Usefulmade Live webhook intake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'live');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID', 'rzp_live_Usefulmade');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET', 'key-secret');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET', webhookSecret);
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID', merchantId);
    vi.stubEnv('USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID', organizationId);
    vi.stubEnv('USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_DELIVERY_EVIDENCE_ENABLED', 'false');
    rpc.mockResolvedValue({ data: { status: 'held' }, error: null });
    classifyLiveWebhookOrder.mockResolvedValue('saas');
    fetchLivePaymentOrderId.mockResolvedValue('order_Live123');
    settleCapturedLivePayment.mockResolvedValue({ status: 'verified' });
    reconcileLiveRefund.mockResolvedValue({ status: 'confirmed' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is hidden when intake is off and rejects changed bytes or merchant', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED', 'false');
    expect((await POST(signedRequest(captured))).status).toBe(404);
    vi.stubEnv('USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED', 'true');
    expect((await POST(signedRequest(captured, '0'.repeat(64)))).status).toBe(
      400
    );
    expect(
      (await POST(signedRequest({ ...captured, account_id: 'acc_Gym' }))).status
    ).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(classifyLiveWebhookOrder).not.toHaveBeenCalled();
  });

  it('acknowledges signed foreign orders without claiming SaaS work', async () => {
    classifyLiveWebhookOrder.mockResolvedValue('unrelated');
    expect((await POST(signedRequest(captured))).status).toBe(200);
    expect(classifyLiveWebhookOrder).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId }),
      'order_Live123'
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(settleCapturedLivePayment).not.toHaveBeenCalled();

    const refund = {
      account_id: merchantId,
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_Gym123', payment_id: 'pay_Gym123' } },
      },
    };
    expect((await POST(signedRequest(refund))).status).toBe(200);
    expect(fetchLivePaymentOrderId).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId }),
      'pay_Gym123'
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(reconcileLiveRefund).not.toHaveBeenCalled();
  });

  it('acknowledges a signed payment with no order and retries uncertain ownership', async () => {
    const noOrder = {
      ...captured,
      payload: { payment: { entity: { id: 'pay_Gym123', order_id: null } } },
    };
    fetchLivePaymentOrderId.mockResolvedValueOnce(null);
    expect((await POST(signedRequest(noOrder))).status).toBe(200);
    expect(fetchLivePaymentOrderId).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId }),
      'pay_Gym123'
    );
    expect(classifyLiveWebhookOrder).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();

    fetchLivePaymentOrderId.mockResolvedValueOnce('order_Live123');
    expect((await POST(signedRequest(noOrder))).status).toBe(200);
    expect(classifyLiveWebhookOrder).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId }),
      'order_Live123'
    );
    expect(rpc).toHaveBeenCalledOnce();

    rpc.mockClear();
    classifyLiveWebhookOrder.mockClear();
    const omittedOrder = {
      ...captured,
      payload: { payment: { entity: { id: 'pay_Gym123' } } },
    };
    fetchLivePaymentOrderId.mockResolvedValueOnce('order_Live123');
    expect((await POST(signedRequest(omittedOrder))).status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();

    rpc.mockClear();
    classifyLiveWebhookOrder.mockClear();
    fetchLivePaymentOrderId.mockRejectedValueOnce(new Error('provider down'));
    expect((await POST(signedRequest(omittedOrder))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();

    fetchLivePaymentOrderId.mockRejectedValueOnce(new Error('provider down'));
    expect((await POST(signedRequest(noOrder))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();

    fetchLivePaymentOrderId.mockResolvedValueOnce(null);
    const refundWithoutOrder = {
      account_id: merchantId,
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_Gym123', payment_id: 'pay_Gym123' } },
      },
    };
    expect((await POST(signedRequest(refundWithoutOrder))).status).toBe(200);
    expect(classifyLiveWebhookOrder).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();

    classifyLiveWebhookOrder.mockRejectedValueOnce(
      new Error('Provider order unavailable')
    );
    expect((await POST(signedRequest(captured))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('retries an unbound apparent SaaS order, preserving the delivery for recovery', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Live webhook has no bound pilot order' },
    });
    expect((await POST(signedRequest(captured))).status).toBe(503);
    expect(classifyLiveWebhookOrder).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('acknowledges only after the signed pilot event is durable', async () => {
    expect((await POST(signedRequest(captured))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'subscription_record_live_webhook_event',
      expect.objectContaining({
        p_merchant_id: merchantId,
        p_pilot_organization_id: organizationId,
        p_event_id: 'evt_Live123',
        p_event_type: 'payment.captured',
        p_provider_order_id: 'order_Live123',
        p_provider_payment_id: 'pay_Live456',
        p_provider_refund_id: null,
        p_provider_event_at: new Date(captureEventAt * 1000).toISOString(),
        p_body_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
    rpc.mockResolvedValueOnce({ data: { status: 'duplicate' }, error: null });
    expect((await POST(signedRequest(captured))).status).toBe(200);
  });

  it('retries a database failure and resolves refund order by fresh payment GET', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST' } });
    expect((await POST(signedRequest(captured))).status).toBe(503);
    const refund = {
      account_id: merchantId,
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_Live789', payment_id: 'pay_Live456' } },
      },
    };
    expect((await POST(signedRequest(refund))).status).toBe(200);
    expect(fetchLivePaymentOrderId).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId }),
      'pay_Live456'
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'subscription_record_live_webhook_event',
      expect.objectContaining({ p_provider_refund_id: 'rfnd_Live789' })
    );
  });

  it('settles a captured delivery only after saving it when the distinct gate is on', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED', 'true');
    expect((await POST(signedRequest(captured))).status).toBe(200);
    expect(settleCapturedLivePayment).toHaveBeenCalledWith({
      orderId: 'order_Live123',
      paymentId: 'pay_Live456',
      captureEventAt: new Date(captureEventAt * 1000).toISOString(),
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'database' } });
    expect((await POST(signedRequest(captured))).status).toBe(503);
    expect(settleCapturedLivePayment).toHaveBeenCalledTimes(1);
  });

  it('reconciles a signed refund through the Live refund path after durable intake', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED', 'true');
    const refund = {
      account_id: merchantId,
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_Live789', payment_id: 'pay_Live456' } },
      },
    };
    expect((await POST(signedRequest(refund))).status).toBe(200);
    expect(reconcileLiveRefund).toHaveBeenCalledWith({
      paymentId: 'pay_Live456',
      refundId: 'rfnd_Live789',
    });
    reconcileLiveRefund.mockRejectedValueOnce(new Error('provider down'));
    expect((await POST(signedRequest(refund))).status).toBe(503);
  });

  it('records a signed failed payment without changing entitlement or waiting forever', async () => {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_mark_live_event_reconciled'
          ? { state: 'reconciled' }
          : { status: 'held' },
      error: null,
    }));
    const failed = { ...captured, event: 'payment.failed' };
    expect((await POST(signedRequest(failed))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'subscription_mark_live_event_reconciled',
      expect.objectContaining({ p_event_id: 'evt_Live123' })
    );
    expect(settleCapturedLivePayment).not.toHaveBeenCalled();
    expect(reconcileLiveRefund).not.toHaveBeenCalled();
  });

  describe('opt-in delivery receipts', () => {
    beforeEach(() => {
      vi.stubEnv('USEFULDESK_SAAS_LIVE_DELIVERY_EVIDENCE_ENABLED', 'true');
      rpc.mockImplementation(async (name: string) => ({
        data:
          name === 'subscription_record_live_delivery_receipt'
            ? { status: 'recorded' }
            : { status: 'held' },
        error: null,
      }));
    });

    it('retains each repeated signed delivery after durable SaaS handling', async () => {
      vi.stubEnv('USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED', 'true');
      expect((await POST(signedRequest(captured))).status).toBe(200);
      rpc.mockImplementation(async (name: string) => ({
        data:
          name === 'subscription_record_live_delivery_receipt'
            ? { status: 'recorded' }
            : { status: 'duplicate' },
        error: null,
      }));
      expect((await POST(signedRequest(captured))).status).toBe(200);
      const receipts = rpc.mock.calls.filter(
        ([name]) => name === 'subscription_record_live_delivery_receipt'
      );
      expect(receipts).toHaveLength(2);
      expect(receipts[0][1]).toEqual(receipts[1][1]);
      expect(receipts[0][1]).toMatchObject({
        p_event_id_source: 'provider',
        p_classification: 'saas',
        p_provider_order_id: 'order_Live123',
      });
      expect(rpc.mock.invocationCallOrder[1]).toBeGreaterThan(
        settleCapturedLivePayment.mock.invocationCallOrder[0]
      );
    });

    it('records provider-proven unrelated receipts without claiming or settling SaaS work', async () => {
      classifyLiveWebhookOrder.mockResolvedValue('unrelated');
      expect((await POST(signedRequest(captured))).status).toBe(200);
      expect(rpc).toHaveBeenCalledExactlyOnceWith(
        'subscription_record_live_delivery_receipt',
        expect.objectContaining({ p_classification: 'unrelated_order' })
      );
      expect(settleCapturedLivePayment).not.toHaveBeenCalled();
      expect(reconcileLiveRefund).not.toHaveBeenCalled();

      rpc.mockClear();
      fetchLivePaymentOrderId.mockResolvedValueOnce(null);
      const noOrder = {
        ...captured,
        payload: { payment: { entity: { id: 'pay_Gym123', order_id: null } } },
      };
      expect((await POST(signedRequest(noOrder))).status).toBe(200);
      expect(rpc).toHaveBeenCalledExactlyOnceWith(
        'subscription_record_live_delivery_receipt',
        expect.objectContaining({
          p_classification: 'unrelated_no_order',
          p_provider_order_id: null,
        })
      );
    });

    it('distinguishes the body-digest fallback from a provider event ID', async () => {
      const request = signedRequest(captured);
      request.headers.delete('x-razorpay-event-id');
      expect((await POST(request)).status).toBe(200);
      const receipt = rpc.mock.calls.find(
        ([name]) => name === 'subscription_record_live_delivery_receipt'
      )?.[1];
      expect(receipt.p_event_id_source).toBe('body_digest');
      expect(receipt.p_event_id).toBe(receipt.p_body_sha256);
    });

    it('never records rejected signatures, uncertain ownership or failed handling', async () => {
      expect((await POST(signedRequest(captured, '0'.repeat(64)))).status).toBe(
        400
      );
      classifyLiveWebhookOrder.mockRejectedValueOnce(
        new Error('unknown owner')
      );
      expect((await POST(signedRequest(captured))).status).toBe(503);
      expect(rpc).not.toHaveBeenCalled();
      vi.stubEnv('USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED', 'true');
      settleCapturedLivePayment.mockRejectedValueOnce(
        new Error('provider down')
      );
      expect((await POST(signedRequest(captured))).status).toBe(503);
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        'subscription_record_live_webhook_event',
      ]);
    });

    it('asks for retry if an enabled receipt cannot be persisted', async () => {
      classifyLiveWebhookOrder.mockResolvedValue('unrelated');
      rpc.mockResolvedValueOnce({ data: null, error: { code: 'database' } });
      expect((await POST(signedRequest(captured))).status).toBe(503);
      expect(settleCapturedLivePayment).not.toHaveBeenCalled();
    });

    it.each(['TRUE', '1', ' true '])(
      'requires literal opt-in (%s)',
      async (flag) => {
        vi.stubEnv('USEFULDESK_SAAS_LIVE_DELIVERY_EVIDENCE_ENABLED', flag);
        expect((await POST(signedRequest(captured))).status).toBe(200);
        expect(rpc).toHaveBeenCalledOnce();
      }
    );
  });
  it('attributes customer SaaS from durable order authority while retaining the original receipt listener', async () => {
    const customer = '22222222-2222-4222-8222-222222222222';
    vi.stubEnv('USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_DELIVERY_EVIDENCE_ENABLED', 'true');
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_resolve_live_scope'
          ? {
              request_id: '33333333-3333-4333-8333-333333333333',
              organization_id: customer,
              merchant_id: merchantId,
              amount_minor: 79900,
              currency: 'INR',
              scope: 'customer_sale',
            }
          : {
              status:
                name === 'subscription_record_live_delivery_receipt'
                  ? 'recorded'
                  : 'held',
            },
      error: null,
    }));
    fetchLiveOrder.mockResolvedValue({ id: 'order_Live123' });
    expect(
      (
        await POST(
          signedRequest({ ...captured, organization_id: organizationId })
        )
      ).status
    ).toBe(200);
    expect(rpc).toHaveBeenCalledWith('subscription_resolve_live_scope', {
      p_provider_merchant_id: merchantId,
      p_provider_order_id: 'order_Live123',
    });
    expect(fetchLiveOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: customer,
        authority: expect.any(Object),
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'subscription_record_live_webhook_event',
      expect.objectContaining({ p_pilot_organization_id: customer })
    );
    expect(rpc).toHaveBeenCalledWith(
      'subscription_record_live_delivery_receipt',
      expect.objectContaining({ p_pilot_organization_id: organizationId })
    );
  });

  it('keeps an apparent customer SaaS delivery retryable without durable authority', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED', 'true');
    rpc.mockResolvedValue({ data: null, error: { code: '55000' } });
    expect((await POST(signedRequest(captured))).status).toBe(503);
    expect(fetchLiveOrder).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'subscription_resolve_live_scope',
    ]);
    expect(settleCapturedLivePayment).not.toHaveBeenCalled();
  });
});
