import { describe, expect, it } from 'vitest';
import {
  applyUpgradePaymentEvent,
  baseMonthlySoftwareMinor,
  commitScheduledDowngrade,
  prepareBaseTierUpgrade,
  proratedUpgradeDifferenceMinor,
  scheduleNextRenewalChange,
  scheduledTierAt,
  upgradeTierAt,
} from './billing-transitions';

const periodStart = '2026-01-01T00:00:00.000Z';
const periodEnd = '2026-02-01T00:00:00.000Z';
const upgradeInput = {
  requestId: 'upgrade-1',
  organizationId: 'org-1',
  fromTier: 'starter' as const,
  toTier: 'growth' as const,
  periodStart,
  periodEnd,
  requestedAt: '2026-01-16T12:00:00.000Z',
};
const renewalInput = {
  requestId: 'change-1',
  organizationId: 'org-1',
  fromTier: 'ultimate' as const,
  targetTier: 'starter' as const,
  periodStart,
  paidThroughEnd: periodEnd,
  requestedAt: '2026-01-20T00:00:00.000Z',
};
const fiveBranches = Array.from({ length: 5 }, (_, index) => ({
  account_id: `branch-${index + 1}`,
  organization_id: 'org-1',
  branch_status: 'active' as const,
}));
const archiveFour = ['branch-1', 'branch-2', 'branch-3', 'branch-4'];

describe('subscription billing transitions', () => {
  it('prorates only the positive monthly price difference over actual period bounds in paise', () => {
    expect(baseMonthlySoftwareMinor('starter')).toBe(79900);
    expect(baseMonthlySoftwareMinor('growth')).toBe(149900);
    expect(baseMonthlySoftwareMinor('ultimate')).toBe(399900);
    expect(prepareBaseTierUpgrade(upgradeInput).chargeMinor).toBe(35000);
    expect(
      proratedUpgradeDifferenceMinor({
        currentMonthlyMinor: 79900,
        targetMonthlyMinor: 149900,
        periodStart,
        periodEnd,
        chargeAt: periodStart,
      })
    ).toBe(70000);
    expect(
      proratedUpgradeDifferenceMinor({
        currentMonthlyMinor: 79900,
        targetMonthlyMinor: 149900,
        periodStart,
        periodEnd,
        chargeAt: '2026-01-31T00:00:00.000Z',
      })
    ).toBe(2258);
    expect(
      proratedUpgradeDifferenceMinor({
        currentMonthlyMinor: 79900,
        targetMonthlyMinor: 149900,
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-03-01T00:00:00.000Z',
        chargeAt: '2026-02-15T00:00:00.000Z',
      })
    ).toBe(35000);
    expect(
      proratedUpgradeDifferenceMinor({
        currentMonthlyMinor: 1,
        targetMonthlyMinor: 2,
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-01-01T00:00:00.002Z',
        chargeAt: '2026-01-01T00:00:00.001Z',
      })
    ).toBe(1); // exact half paise rounds up
  });

  it('keeps the old tier until a matching verified payment, and handles retries once', () => {
    const pending = prepareBaseTierUpgrade(upgradeInput);
    expect(upgradeTierAt(pending, '2026-01-20T00:00:00.000Z')).toBe('starter');
    const failed = applyUpgradePaymentEvent(pending, {
      kind: 'payment_failed',
      requestId: pending.requestId,
    });
    expect(upgradeTierAt(failed, '2026-01-20T00:00:00.000Z')).toBe('starter');
    const confirmation = {
      kind: 'server_verified_payment' as const,
      requestId: pending.requestId,
      providerPaymentId: 'pay-1',
      paidMinor: 35000,
      verifiedAt: '2026-01-20T00:00:00.000Z',
    };
    const verified = applyUpgradePaymentEvent(failed, confirmation);
    expect(upgradeTierAt(verified, '2026-01-19T23:59:59.999Z')).toBe('starter');
    expect(upgradeTierAt(verified, confirmation.verifiedAt)).toBe('growth');
    expect(upgradeTierAt(verified, periodEnd)).toBeNull();
    expect(applyUpgradePaymentEvent(verified, confirmation)).toBe(verified);
    expect(
      applyUpgradePaymentEvent(verified, {
        kind: 'payment_failed',
        requestId: pending.requestId,
      })
    ).toBe(verified);
    expect(() =>
      applyUpgradePaymentEvent(verified, {
        ...confirmation,
        providerPaymentId: 'pay-2',
      })
    ).toThrow('another payment');
  });

  it('rejects invalid quotes and confirmations without granting access', () => {
    const pending = prepareBaseTierUpgrade(upgradeInput);
    expect(() =>
      prepareBaseTierUpgrade({ ...upgradeInput, toTier: 'starter' })
    ).toThrow('higher tier');
    expect(() =>
      prepareBaseTierUpgrade({ ...upgradeInput, requestedAt: periodEnd })
    ).toThrow('valid paid billing period');
    expect(() =>
      prepareBaseTierUpgrade({
        ...upgradeInput,
        requestedAt: '2026-01-31T23:59:59.999Z',
      })
    ).toThrow('wait for the next billing period');
    expect(() =>
      prepareBaseTierUpgrade({ ...upgradeInput, periodStart: '2026-01-01' })
    ).toThrow('timezone');
    expect(() =>
      prepareBaseTierUpgrade({
        ...upgradeInput,
        periodStart: '2026-02-31T00:00:00.000Z',
      })
    ).toThrow('Invalid timestamp');
    expect(() =>
      proratedUpgradeDifferenceMinor({
        currentMonthlyMinor: 100,
        targetMonthlyMinor: 100,
        periodStart,
        periodEnd,
        chargeAt: periodStart,
      })
    ).toThrow('greater');
    expect(() =>
      applyUpgradePaymentEvent(pending, {
        kind: 'server_verified_payment',
        requestId: pending.requestId,
        providerPaymentId: 'pay-1',
        paidMinor: 1,
        verifiedAt: '2026-01-20T00:00:00.000Z',
      })
    ).toThrow('does not match');
    expect(() =>
      applyUpgradePaymentEvent(pending, {
        kind: 'server_verified_payment',
        requestId: pending.requestId,
        providerPaymentId: 'pay-1',
        paidMinor: pending.chargeMinor,
        verifiedAt: periodEnd,
      })
    ).toThrow('outside');
    expect(upgradeTierAt(pending, '2026-01-20T00:00:00.000Z')).toBe('starter');
  });

  it('schedules cancellation at the next renewal without ending current paid access early', () => {
    const cancellation = scheduleNextRenewalChange({
      ...renewalInput,
      targetTier: null,
    });
    expect(scheduledTierAt(cancellation, '2026-01-31T23:59:59.999Z')).toBe(
      'ultimate'
    );
    expect(scheduledTierAt(cancellation, periodEnd)).toBeNull();
    expect(scheduledTierAt(cancellation, periodStart)).toBe('ultimate');
    expect(
      scheduledTierAt(cancellation, '2025-12-31T23:59:59.999Z')
    ).toBeNull();
  });

  it('waits until renewal, verified payment, and explicit over-cap branch resolution for downgrade', () => {
    const scheduled = scheduleNextRenewalChange(renewalInput);
    const evidence = {
      requestId: scheduled.requestId,
      providerPaymentId: 'renew-pay-1',
      verifiedAt: periodEnd,
      nextPaidThroughEnd: '2026-03-01T00:00:00.000Z',
    };
    const afterOwnerArchives = fiveBranches.map((branch) =>
      archiveFour.includes(branch.account_id)
        ? { ...branch, branch_status: 'archived' as const }
        : branch
    );
    expect(scheduledTierAt(scheduled, '2026-01-31T23:59:59.999Z')).toBe(
      'ultimate'
    );
    expect(scheduledTierAt(scheduled, periodEnd)).toBeNull();
    expect(() =>
      commitScheduledDowngrade(scheduled, evidence, {
        branches: fiveBranches,
        purchases: [],
      })
    ).toThrow('Branch resolution');
    expect(() =>
      commitScheduledDowngrade(
        scheduled,
        { ...evidence, verifiedAt: '2026-01-31T23:00:00.000Z' },
        {
          branches: afterOwnerArchives,
          purchases: [],
        }
      )
    ).toThrow('before renewal');
    expect(() =>
      commitScheduledDowngrade(
        scheduled,
        { ...evidence, nextPaidThroughEnd: periodEnd },
        { branches: afterOwnerArchives, purchases: [] }
      )
    ).toThrow('must follow confirmation');
    const committed = commitScheduledDowngrade(scheduled, evidence, {
      branches: afterOwnerArchives,
      purchases: [],
    });
    expect(scheduledTierAt(committed, periodEnd)).toBe('starter');
    expect(scheduledTierAt(committed, evidence.nextPaidThroughEnd)).toBeNull();
    expect(
      commitScheduledDowngrade(committed, evidence, {
        branches: afterOwnerArchives,
        purchases: [],
      })
    ).toBe(committed);
    expect(() =>
      commitScheduledDowngrade(
        committed,
        { ...evidence, providerPaymentId: 'renew-pay-2' },
        {
          branches: afterOwnerArchives,
          purchases: [],
        }
      )
    ).toThrow('another payment');
    expect(() =>
      commitScheduledDowngrade(
        committed,
        { ...evidence, nextPaidThroughEnd: '2026-04-01T00:00:00.000Z' },
        { branches: afterOwnerArchives, purchases: [] }
      )
    ).toThrow('another payment');
    expect(fiveBranches).toHaveLength(5); // Pure preview never archives them.
  });

  it('rejects an upward scheduled change and out-of-period requests', () => {
    expect(() =>
      scheduleNextRenewalChange({
        ...renewalInput,
        fromTier: 'starter',
        targetTier: 'growth',
      })
    ).toThrow('lower tier');
    expect(() =>
      scheduleNextRenewalChange({ ...renewalInput, requestedAt: periodEnd })
    ).toThrow('valid paid billing period');
  });
});
