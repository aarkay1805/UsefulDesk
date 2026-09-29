import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, authorized, settleCapturedLivePayment, reconcileLiveRefund } =
  vi.hoisted(() => ({
    rpc: vi.fn(),
    authorized: vi.fn(),
    settleCapturedLivePayment: vi.fn(),
    reconcileLiveRefund: vi.fn(),
  }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc }),
}));
vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => true,
  isAuthorizedCronRequest: authorized,
}));
vi.mock('@/lib/subscriptions/live-flow', () => ({ settleCapturedLivePayment }));
vi.mock('@/lib/subscriptions/live-refunds', () => ({ reconcileLiveRefund }));
import { POST } from './route';

const organizationId = '11111111-1111-4111-8111-111111111111';
const paymentEvent = {
  event_id: 'evt_Live1',
  body_sha256: 'a'.repeat(64),
  event_type: 'payment.captured',
  organization_id: organizationId,
  provider_order_id: 'order_Live123',
  provider_payment_id: 'pay_Live456',
  provider_refund_id: null,
  provider_event_at: '2026-09-29T08:00:00.000Z',
};
const refundEvent = {
  ...paymentEvent,
  event_id: 'evt_Live2',
  event_type: 'refund.processed',
  provider_refund_id: 'rfnd_Live789',
};
function request() {
  return new Request(
    'https://desk.usefulmade.com/api/subscriptions/live-reconcile',
    {
      method: 'POST',
    }
  );
}

describe('held Live webhook reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_MODE', 'live');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID', 'rzp_live_Usefulmade');
    vi.stubEnv('USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET', 'key-secret');
    vi.stubEnv(
      'USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET',
      'webhook-secret'
    );
    vi.stubEnv(
      'USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID',
      'acc_UsefulmadeLive'
    );
    vi.stubEnv('USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID', organizationId);
    vi.stubEnv('USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED', 'true');
    authorized.mockReturnValue(true);
    settleCapturedLivePayment.mockResolvedValue({ status: 'verified' });
    reconcileLiveRefund.mockResolvedValue({ status: 'confirmed' });
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_list_live_held_events'
          ? [paymentEvent, refundEvent]
          : { state: 'reconciled' },
      error: null,
    }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not read the database with both reconciliation gates off', async () => {
    expect((await POST(request())).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires the protected cron request when enabled', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED', 'true');
    authorized.mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('replays exact held payment and refund evidence without provider POST', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED', 'true');
    vi.stubEnv('USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED', 'true');
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      inspected: 2,
      reconciled: 2,
      failed: 0,
    });
    expect(rpc).toHaveBeenCalledWith(
      'subscription_list_live_held_events',
      expect.objectContaining({
        p_limit: 5,
        p_capture_enabled: true,
        p_refund_enabled: true,
      })
    );
    expect(settleCapturedLivePayment).toHaveBeenCalledWith({
      orderId: 'order_Live123',
      paymentId: 'pay_Live456',
      captureEventAt: '2026-09-29T08:00:00.000Z',
    });
    expect(reconcileLiveRefund).toHaveBeenCalledWith({
      paymentId: 'pay_Live456',
      refundId: 'rfnd_Live789',
    });
    expect(rpc).toHaveBeenCalledWith(
      'subscription_mark_live_event_reconciled',
      expect.objectContaining({
        p_event_id: 'evt_Live2',
        p_body_sha256: 'a'.repeat(64),
      })
    );
  });

  it('leaves failed events held for retry and reports the failure', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED', 'true');
    settleCapturedLivePayment.mockRejectedValueOnce(
      new Error('provider outage')
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      inspected: 2,
      reconciled: 0,
      failed: 1,
    });
    expect(rpc).not.toHaveBeenCalledWith(
      'subscription_mark_live_event_reconciled',
      expect.anything()
    );
  });
});
