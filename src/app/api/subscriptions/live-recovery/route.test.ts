import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { recovery } = vi.hoisted(() => ({ recovery: vi.fn() }));
vi.mock('@/lib/subscriptions/live-recovery', async (original) => ({
  ...(await original<typeof import('@/lib/subscriptions/live-recovery')>()),
  recoverLiveFinancialObligations: recovery,
}));
import { POST } from './route';

const cronHeaders: Record<string, string>[] = [
  { 'x-cron-secret': 'private-cron-secret' },
  { authorization: 'Bearer private-cron-secret' },
];

function request(headers: Record<string, string> = {}) {
  return new Request(
    'https://desk.usefulmade.com/api/subscriptions/live-recovery',
    { method: 'POST', headers }
  );
}
describe('protected financial recovery route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [name, value] of Object.entries({
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
      USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_live_Usefulmade',
      USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: 'private-key-secret',
      USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: 'private-webhook-secret',
      USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'acc_UsefulmadeLive',
      USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID:
        '11111111-1111-4111-8111-111111111111',
      USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'true',
      USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED: 'true',
      USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED: 'true',
      USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED: 'true',
      AUTOMATION_CRON_SECRET: 'private-cron-secret',
      CRON_SECRET: '',
    }))
      vi.stubEnv(name, value);
    recovery.mockResolvedValue({
      inspected: 0,
      recovered: 0,
      exceptions: 0,
      failed: 0,
      items: [],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['false', 'TRUE', '1', ''])(
    'does no I/O with a closed or nonliteral recovery gate %s',
    async (value) => {
      vi.stubEnv('USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED', value);
      expect((await POST(request())).status).toBe(404);
      expect(recovery).not.toHaveBeenCalled();
    }
  );
  it('rejects browser/session requests and missing cron configuration before recovery', async () => {
    expect((await POST(request({ cookie: 'session=owner' }))).status).toBe(401);
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    expect(
      (await POST(request({ 'x-cron-secret': 'private-cron-secret' }))).status
    ).toBe(401);
    expect(recovery).not.toHaveBeenCalled();
  });
  it.each(cronHeaders)(
    'accepts cron authentication %j without requiring initiation gates',
    async (headers) => {
      const response = await POST(request(headers));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(recovery).toHaveBeenCalledWith();
    }
  );
  it('does not invoke recovery when the live runtime or intake binding is closed', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED', 'false');
    expect(
      (await POST(request({ 'x-cron-secret': 'private-cron-secret' }))).status
    ).toBe(404);
    expect(recovery).not.toHaveBeenCalled();
  });

  it('does not accept caller-supplied scan scope or financial facts', async () => {
    const response = await POST(
      new Request(
        'https://desk.usefulmade.com/api/subscriptions/live-recovery?limit=999',
        {
          method: 'POST',
          headers: {
            'x-cron-secret': 'private-cron-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            merchant_id: 'acc_Foreign',
            request_id: 'replacement',
            amount_minor: 1,
            limit: 999,
          }),
        }
      )
    );
    expect(response.status).toBe(200);
    expect(recovery).toHaveBeenCalledWith();
  });
  it('preserves per-item retry outcomes with HTTP 503 and never returns exception details', async () => {
    recovery.mockResolvedValueOnce({
      inspected: 1,
      recovered: 0,
      exceptions: 1,
      failed: 1,
      items: [
        {
          itemType: 'order',
          itemId: '22222222-2222-4222-8222-222222222222',
          outcome: 'retry',
          reason: 'provider_lookup_unverified',
          recorded: true,
        },
      ],
    });
    const response = await POST(
      request({ 'x-cron-secret': 'private-cron-secret' })
    );
    expect(response.status).toBe(503);
    expect((await response.json()).items[0].reason).toBe(
      'provider_lookup_unverified'
    );
    recovery.mockRejectedValueOnce(
      new Error('private-key-secret private provider body')
    );
    const failed = await POST(
      request({ 'x-cron-secret': 'private-cron-secret' })
    );
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: 'Retry later' });
  });
});
