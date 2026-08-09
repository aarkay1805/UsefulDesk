import { describe, expect, it, vi } from 'vitest';

import { runRazorpayRecovery } from './razorpay-recovery';

function adminWithRpc(responses: Record<string, unknown>) {
  return {
    rpc: vi.fn(async (name: string) => ({
      data: responses[name] ?? null,
      error: null,
    })),
  };
}

describe('Razorpay recovery worker', () => {
  it('leases a bounded batch, isolates webhook failures, and reports oldest age', async () => {
    const admin = adminWithRpc({
      claim_razorpay_webhook_recovery_batch: [
        {
          event_id: 'evt_ok',
          account_id: 'account',
          payload: { event: 'subscription.pending', payload: {} },
          created_at: '2026-08-09T09:59:00.000Z',
        },
        {
          event_id: 'evt_fail',
          account_id: 'account',
          payload: { event: 'subscription.charged', payload: {} },
          created_at: '2026-08-09T09:58:00.000Z',
        },
      ],
    });
    const processClaimed = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'processed' })
      .mockRejectedValueOnce(new Error('temporary ledger outage'));

    const result = await runRazorpayRecovery({
      admin: admin as never,
      providerMode: 'test',
      dependencies: {
        now: () => new Date('2026-08-09T10:00:00.000Z'),
        owner: () => '00000000-0000-4000-8000-000000000001',
        oauthEnabled: () => false,
        processClaimed,
      },
    });

    expect(result.webhooks).toEqual({
      claimed: 2,
      processed: 1,
      failed: 1,
      oldestAgeSeconds: 120,
    });
    expect(result.tokens.disabled).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith(
      'claim_razorpay_webhook_recovery_batch',
      expect.objectContaining({ p_limit: 100, p_lease_seconds: 300 })
    );
    expect(processClaimed).toHaveBeenCalledTimes(2);
    expect(admin.rpc).toHaveBeenCalledWith(
      'fail_razorpay_canonical_webhook_event',
      expect.objectContaining({
        p_event_id: 'evt_fail',
        p_error: 'temporary ledger outage',
      })
    );
  });

  it('refreshes only connections inside the seven-day window and completes every scan lease', async () => {
    const admin = adminWithRpc({
      claim_razorpay_webhook_recovery_batch: [],
      claim_razorpay_oauth_refresh_scan_batch: [
        {
          account_id: 'due',
          oauth_access_expires_at: '2026-08-10T00:00:00.000Z',
        },
        {
          account_id: 'later',
          oauth_access_expires_at: '2026-09-10T00:00:00.000Z',
        },
      ],
      finish_razorpay_oauth_refresh_scan: true,
    });
    const refreshConnection = vi.fn().mockResolvedValue({});

    const result = await runRazorpayRecovery({
      admin: admin as never,
      providerMode: 'test',
      dependencies: {
        now: () => new Date('2026-08-09T10:00:00.000Z'),
        owner: () => '00000000-0000-4000-8000-000000000002',
        oauthEnabled: () => true,
        refreshConnection,
      },
    });

    expect(result.tokens).toEqual({
      disabled: false,
      claimed: 2,
      refreshed: 1,
      skippedNotDue: 1,
      failed: 0,
    });
    expect(refreshConnection).toHaveBeenCalledOnce();
    expect(refreshConnection).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'due' })
    );
    expect(
      admin.rpc.mock.calls.filter(
        ([name]) => name === 'finish_razorpay_oauth_refresh_scan'
      )
    ).toHaveLength(2);
  });

  it('records a token error and still releases the daily scan lease', async () => {
    const admin = adminWithRpc({
      claim_razorpay_webhook_recovery_batch: [],
      claim_razorpay_oauth_refresh_scan_batch: [
        {
          account_id: 'due',
          oauth_access_expires_at: '2026-08-10T00:00:00.000Z',
        },
      ],
      finish_razorpay_oauth_refresh_scan: true,
    });

    const result = await runRazorpayRecovery({
      admin: admin as never,
      providerMode: 'test',
      dependencies: {
        now: () => new Date('2026-08-09T10:00:00.000Z'),
        owner: () => '00000000-0000-4000-8000-000000000003',
        oauthEnabled: () => true,
        refreshConnection: vi.fn().mockRejectedValue(new Error('timed out')),
      },
    });

    expect(result.tokens.failed).toBe(1);
    expect(admin.rpc).toHaveBeenCalledWith(
      'finish_razorpay_oauth_refresh_scan',
      expect.objectContaining({ p_account_id: 'due', p_error: 'timed out' })
    );
  });
});
