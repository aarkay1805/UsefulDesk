import { describe, expect, it } from 'vitest';
import { scheduleNextRenewalChange } from './billing-transitions';
import {
  applyPaidRenewalEvent,
  paidRenewalAccessAt,
  startFailedPaidRenewal,
} from './renewal-grace';

const start = '2026-01-01T00:00:00.000Z';
const paidThroughEnd = '2026-02-01T00:00:00.000Z';
const graceEnd = '2026-02-04T00:00:00.000Z';
const input = {
  requestId: 'renewal-1',
  existingPaidGrantId: 'grant-1',
  organizationId: 'org-1',
  fromTier: 'growth' as const,
  periodStart: start,
  paidThroughEnd,
  firstFailedAt: paidThroughEnd,
  scheduledChange: null,
};

describe('failed paid-renewal grace', () => {
  it('starts one 72-hour grace at the paid-through instant and never extends it on failed retries', () => {
    const failed = startFailedPaidRenewal(input);
    expect(failed.graceEndsAt).toBe(graceEnd);
    expect(paidRenewalAccessAt(failed, '2026-01-31T23:59:59.999Z')).toEqual({
      status: 'paid',
      tier: 'growth',
      mayStartPaidExpansion: true,
    });
    expect(paidRenewalAccessAt(failed, paidThroughEnd)).toEqual({
      status: 'grace',
      tier: 'growth',
      mayStartPaidExpansion: false,
    });
    expect(paidRenewalAccessAt(failed, '2026-02-03T23:59:59.999Z').status).toBe(
      'grace'
    );
    expect(paidRenewalAccessAt(failed, graceEnd)).toEqual({
      status: 'expired',
      tier: null,
      mayStartPaidExpansion: false,
    });
    const retry = applyPaidRenewalEvent(failed, {
      kind: 'payment_failed',
      requestId: failed.requestId,
      failedAt: '2026-02-03T23:59:59.999Z',
    });
    expect(retry).toBe(failed);
    expect(retry.graceEndsAt).toBe(graceEnd);
    expect(paidRenewalAccessAt(retry, graceEnd).status).toBe('expired');
  });

  it('restores a paid same-tier term only after matching server-verified payment', () => {
    const failed = startFailedPaidRenewal(input);
    const verifiedEvent = {
      kind: 'server_verified_payment' as const,
      requestId: failed.requestId,
      providerPaymentId: 'pay-1',
      verifiedAt: '2026-02-02T12:00:00.000Z',
      nextPaidThroughEnd: '2026-03-01T00:00:00.000Z',
    };
    const verified = applyPaidRenewalEvent(failed, verifiedEvent);
    expect(
      paidRenewalAccessAt(verified, '2026-02-02T11:59:59.999Z').status
    ).toBe('grace');
    expect(paidRenewalAccessAt(verified, verifiedEvent.verifiedAt)).toEqual({
      status: 'paid',
      tier: 'growth',
      mayStartPaidExpansion: true,
    });
    expect(
      paidRenewalAccessAt(verified, verifiedEvent.nextPaidThroughEnd).status
    ).toBe('expired');
    expect(applyPaidRenewalEvent(verified, verifiedEvent)).toBe(verified);
    expect(
      applyPaidRenewalEvent(verified, {
        kind: 'payment_failed',
        requestId: failed.requestId,
        failedAt: '2026-02-03T00:00:00.000Z',
      })
    ).toBe(verified);
    expect(() =>
      applyPaidRenewalEvent(verified, {
        ...verifiedEvent,
        providerPaymentId: 'pay-2',
      })
    ).toThrow('another payment');
  });

  it('expires between grace end and a late verified renewal, then restores only from verification', () => {
    const failed = startFailedPaidRenewal(input);
    const verified = applyPaidRenewalEvent(failed, {
      kind: 'server_verified_payment',
      requestId: failed.requestId,
      providerPaymentId: 'pay-late',
      verifiedAt: '2026-02-05T00:00:00.000Z',
      nextPaidThroughEnd: '2026-03-05T00:00:00.000Z',
    });
    expect(paidRenewalAccessAt(verified, graceEnd).status).toBe('expired');
    expect(
      paidRenewalAccessAt(verified, '2026-02-05T00:00:00.000Z').status
    ).toBe('paid');
  });

  it('keeps the old tier during a failed scheduled downgrade and requires resolved capacity on renewal', () => {
    const change = scheduleNextRenewalChange({
      requestId: 'downgrade-1',
      organizationId: 'org-1',
      fromTier: 'growth',
      targetTier: 'starter',
      periodStart: start,
      paidThroughEnd,
      requestedAt: '2026-01-20T00:00:00.000Z',
    });
    const failed = startFailedPaidRenewal({
      ...input,
      scheduledChange: change,
    });
    expect(paidRenewalAccessAt(failed, '2026-02-02T00:00:00.000Z')).toEqual({
      status: 'grace',
      tier: 'growth',
      mayStartPaidExpansion: false,
    });
    const evidence = {
      kind: 'server_verified_payment' as const,
      requestId: failed.requestId,
      providerPaymentId: 'pay-downgrade',
      verifiedAt: '2026-02-02T00:00:00.000Z',
      nextPaidThroughEnd: '2026-03-01T00:00:00.000Z',
    };
    const twoActiveBranches = [
      {
        account_id: 'one',
        organization_id: 'org-1',
        branch_status: 'active' as const,
      },
      {
        account_id: 'two',
        organization_id: 'org-1',
        branch_status: 'active' as const,
      },
    ];
    expect(() => applyPaidRenewalEvent(failed, evidence)).toThrow(
      'Post-archive'
    );
    expect(() =>
      applyPaidRenewalEvent(failed, {
        ...evidence,
        downgradeResolution: { branches: twoActiveBranches, purchases: [] },
      })
    ).toThrow('Branch resolution');
    const verified = applyPaidRenewalEvent(failed, {
      ...evidence,
      downgradeResolution: {
        branches: [
          twoActiveBranches[0],
          { ...twoActiveBranches[1], branch_status: 'archived' },
        ],
        purchases: [],
      },
    });
    expect(verified.plan.kind).toBe('scheduled_downgrade');
    if (verified.plan.kind === 'scheduled_downgrade') {
      expect(verified.plan.change.state).toBe('committed');
    }
    expect(paidRenewalAccessAt(verified, evidence.verifiedAt)).toEqual({
      status: 'paid',
      tier: 'starter',
      mayStartPaidExpansion: true,
    });
  });

  it('rejects first-checkout-like input, cancellation, mismatched terms, and early verification', () => {
    expect(() =>
      startFailedPaidRenewal({ ...input, existingPaidGrantId: '' })
    ).toThrow('existing paid renewal');
    const cancellation = scheduleNextRenewalChange({
      requestId: 'cancel-1',
      organizationId: 'org-1',
      fromTier: 'growth',
      targetTier: null,
      periodStart: start,
      paidThroughEnd,
      requestedAt: '2026-01-20T00:00:00.000Z',
    });
    expect(() =>
      startFailedPaidRenewal({
        ...input,
        scheduledChange: cancellation,
      })
    ).toThrow('Cancelled renewals');
    const failed = startFailedPaidRenewal(input);
    expect(() =>
      applyPaidRenewalEvent(failed, {
        kind: 'server_verified_payment',
        requestId: failed.requestId,
        providerPaymentId: 'pay-early',
        verifiedAt: '2026-01-31T23:59:59.999Z',
        nextPaidThroughEnd: '2026-03-01T00:00:00.000Z',
      })
    ).toThrow('before the paid-through end');
    expect(() =>
      applyPaidRenewalEvent(failed, {
        kind: 'server_verified_payment',
        requestId: failed.requestId,
        providerPaymentId: 'pay-1',
        verifiedAt: paidThroughEnd,
        nextPaidThroughEnd: paidThroughEnd,
      })
    ).toThrow('must follow verification');
    expect(paidRenewalAccessAt(failed, graceEnd).status).toBe('expired');
  });
});
