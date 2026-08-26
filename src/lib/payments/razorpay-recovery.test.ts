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
      readinessVerified: 0,
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

  it('re-verifies stale imported-account readiness even when its token is not due', async () => {
    const admin = adminWithRpc({
      claim_razorpay_webhook_recovery_batch: [],
      claim_razorpay_oauth_refresh_scan_batch: [
        {
          account_id: 'stale-import',
          oauth_access_expires_at: '2026-09-10T00:00:00.000Z',
          merchant_status: 'unknown',
          activation_verified_at: '2026-08-07T09:00:00.000Z',
        },
      ],
      finish_razorpay_oauth_refresh_scan: true,
    });
    const verifyReadiness = vi.fn().mockResolvedValue({ ready: true });

    const result = await runRazorpayRecovery({
      admin: admin as never,
      providerMode: 'test',
      dependencies: {
        now: () => new Date('2026-08-09T10:00:00.000Z'),
        owner: () => '00000000-0000-4000-8000-000000000005',
        oauthEnabled: () => true,
        verifyReadiness,
      },
    });

    expect(verifyReadiness).toHaveBeenCalledWith({
      admin,
      accountId: 'stale-import',
    });
    expect(result.tokens.readinessVerified).toBe(1);
    expect(result.tokens.skippedNotDue).toBe(1);
  });

  it('isolates Payment Link reconciliation failures inside the leased batch', async () => {
    const admin = adminWithRpc({
      claim_razorpay_webhook_recovery_batch: [],
      claim_razorpay_payment_link_recovery_batch: [
        {
          id: 'link_ok',
          account_id: 'account',
          next_reconcile_at: '2026-08-09T09:59:00.000Z',
        },
        {
          id: 'link_fail',
          account_id: 'account',
          next_reconcile_at: '2026-08-09T09:58:00.000Z',
        },
      ],
    });
    const recoverPaymentLink = vi
      .fn()
      .mockResolvedValueOnce('verified')
      .mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await runRazorpayRecovery({
      admin: admin as never,
      providerMode: 'test',
      dependencies: {
        now: () => new Date('2026-08-09T10:00:00.000Z'),
        owner: () => '00000000-0000-4000-8000-000000000004',
        oauthEnabled: () => false,
        recoverPaymentLink,
      },
    });

    expect(result.paymentLinks).toEqual({
      claimed: 2,
      reconciled: 1,
      failed: 1,
      oldestAgeSeconds: 120,
    });
    expect(recoverPaymentLink).toHaveBeenCalledTimes(2);
    expect(result.notes).toContain(
      'payment-link:link_fail:provider unavailable'
    );
  });

  it('retries leased recurring-charge sequence exceptions and isolates failures', async () => {
    const admin = {
      rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
        if (name === 'claim_razorpay_webhook_recovery_batch') {
          return { data: [], error: null };
        }
        if (name === 'claim_gateway_charge_exception_recovery_batch') {
          return {
            data: [
              {
                id: 'exception_2',
                account_id: 'account',
                mandate_id: 'mandate',
                provider_paid_count: 2,
                first_seen_at: '2026-08-09T09:58:00.000Z',
              },
              {
                id: 'exception_3',
                account_id: 'account',
                mandate_id: 'mandate',
                provider_paid_count: 3,
                first_seen_at: '2026-08-09T09:59:00.000Z',
              },
            ],
            error: null,
          };
        }
        if (
          name === 'recover_gateway_charge_exception' &&
          args?.p_exception_id === 'exception_2'
        ) {
          return { data: 'applied', error: null };
        }
        if (name === 'recover_gateway_charge_exception') {
          return { data: null, error: { message: 'ledger lock timed out' } };
        }
        return { data: null, error: null };
      }),
    };

    const result = await runRazorpayRecovery({
      admin: admin as never,
      providerMode: 'test',
      dependencies: {
        now: () => new Date('2026-08-09T10:00:00.000Z'),
        owner: () => '00000000-0000-4000-8000-000000000006',
        oauthEnabled: () => false,
        refundsEnabled: () => false,
      },
    });

    expect(result.chargeExceptions).toEqual({
      claimed: 2,
      applied: 1,
      deferred: 0,
      failed: 1,
      oldestAgeSeconds: 120,
    });
    expect(result.notes).toContain(
      'charge-exception:exception_3:ledger lock timed out'
    );
  });

  it('scans leased mandates against Razorpay and reports durable observations', async () => {
    const admin = adminWithRpc({
      claim_razorpay_webhook_recovery_batch: [],
      claim_gateway_charge_exception_recovery_batch: [],
      claim_razorpay_subscription_reconciliation_batch: [
        {
          id: 'mandate_1',
          account_id: 'account_1',
          membership_id: 'membership_1',
          gateway_subscription_id: 'sub_1',
          last_applied_paid_count: 1,
          provider_reconcile_at: '2026-08-09T09:58:00.000Z',
        },
      ],
      finish_razorpay_subscription_reconciliation: true,
    });
    const reconcileSubscriptionSource = vi.fn().mockResolvedValue({
      providerPaidCount: 3,
      localPaidCount: 1,
      observed: 2,
    });

    const result = await runRazorpayRecovery({
      admin: admin as never,
      providerMode: 'test',
      dependencies: {
        now: () => new Date('2026-08-09T10:00:00.000Z'),
        owner: () => '00000000-0000-4000-8000-000000000007',
        oauthEnabled: () => false,
        refundsEnabled: () => false,
        reconcileSubscriptionSource,
      } as never,
    });

    expect(result.subscriptionReconciliation).toEqual({
      claimed: 1,
      scanned: 1,
      observations: 2,
      failed: 0,
      oldestAgeSeconds: 120,
    });
  });
});
