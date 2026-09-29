import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpc,
  fetchLivePaymentOrderId,
  settleCapturedLivePayment,
  reconcileLiveRefund,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetchLivePaymentOrderId: vi.fn(),
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
  fetchLivePaymentOrderId,
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
    rpc.mockResolvedValue({ data: { status: 'held' }, error: null });
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
});
