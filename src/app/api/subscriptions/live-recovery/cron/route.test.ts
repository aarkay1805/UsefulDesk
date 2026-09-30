import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { recovery } = vi.hoisted(() => ({ recovery: vi.fn() }));
vi.mock('@/lib/subscriptions/live-recovery', async (original) => ({
  ...(await original<typeof import('@/lib/subscriptions/live-recovery')>()),
  recoverLiveFinancialObligations: recovery,
}));
import { GET } from './route';

const cronHeaders: Record<string, string>[] = [
  { 'x-cron-secret': 'private-cron-secret' },
  { authorization: 'Bearer private-cron-secret' },
];

function request(headers: Record<string, string> = {}) {
  return new Request(
    'https://desk.usefulmade.com/api/subscriptions/live-recovery/cron?limit=999',
    { headers }
  );
}
describe('fixed-budget financial recovery cron', () => {
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
  it('is closed by default before any recovery work', async () => {
    vi.stubEnv('USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED', 'false');
    expect((await GET(request())).status).toBe(401);
    const response = await GET(
      request({ 'x-cron-secret': 'private-cron-secret' })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      skipped: 'disabled',
      inspected: 0,
    });
    expect(recovery).not.toHaveBeenCalled();
  });
  it('requires cron authentication and its configured secret', async () => {
    expect((await GET(request())).status).toBe(401);
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    expect(
      (await GET(request({ 'x-cron-secret': 'private-cron-secret' }))).status
    ).toBe(401);
    expect(recovery).not.toHaveBeenCalled();
  });
  it.each(cronHeaders)(
    'uses a fixed single item regardless of caller query parameters: %j',
    async (headers) => {
      const response = await GET(request(headers));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(recovery).toHaveBeenCalledWith({ batchLimit: 1 });
    }
  );
  it('does not run with a mismatched Production binding', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(
      (await GET(request({ 'x-cron-secret': 'private-cron-secret' }))).status
    ).toBe(404);
    expect(recovery).not.toHaveBeenCalled();
  });
  it('distinguishes a recorded pending observation from a retry failure', async () => {
    recovery.mockResolvedValueOnce({
      inspected: 1,
      recovered: 0,
      exceptions: 1,
      failed: 0,
      items: [{ outcome: 'pending', reason: 'refund_pending', recorded: true }],
    });
    const pending = await GET(
      request({ 'x-cron-secret': 'private-cron-secret' })
    );
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({
      inspected: 1,
      recovered: 0,
      exceptions: 1,
      failed: 0,
    });
    recovery.mockResolvedValueOnce({
      inspected: 1,
      recovered: 0,
      exceptions: 1,
      failed: 1,
      items: [
        {
          outcome: 'retry',
          reason: 'provider_lookup_unverified',
          recorded: true,
        },
      ],
    });
    expect(
      (await GET(request({ 'x-cron-secret': 'private-cron-secret' }))).status
    ).toBe(503);
  });

  it.each([0, 1])(
    'returns only aggregate counters when the worker has private item details (failed=%i)',
    async (failed) => {
      const itemId = '33333333-3333-4333-8333-333333333333';
      recovery.mockResolvedValueOnce({
        inspected: 1,
        recovered: 0,
        exceptions: 1,
        failed,
        items: [
          {
            itemType: 'refund',
            itemId,
            outcome: failed ? 'retry' : 'pending',
            reason: failed ? 'provider_lookup_unverified' : 'refund_pending',
            recorded: true,
          },
        ],
      });
      const response = await GET(
        request({ 'x-cron-secret': 'private-cron-secret' })
      );
      expect(response.status).toBe(failed ? 503 : 200);
      const body = await response.json();
      expect(body).toEqual({
        inspected: 1,
        recovered: 0,
        exceptions: 1,
        failed,
      });
      expect(body).not.toHaveProperty('items');
      expect(JSON.stringify(body)).not.toContain(itemId);
    }
  );
});
