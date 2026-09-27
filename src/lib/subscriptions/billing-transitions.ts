import { reviewSubscriptionConversion } from './conversion';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_TIERS,
  type SubscriptionBranch,
  type SubscriptionTier,
} from './plans';
import type { BranchSlotPurchase } from './branch-slots';

function instant(value: string): number {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value
    );
  if (!parts) {
    throw new RangeError('An ISO timestamp with a timezone is required');
  }
  const [, year, month, day, hour, minute, second, zone] = parts;
  const calendarDate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day))
  );
  if (
    calendarDate.getUTCFullYear() !== Number(year) ||
    calendarDate.getUTCMonth() + 1 !== Number(month) ||
    calendarDate.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== 'Z' &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  ) {
    throw new RangeError('Invalid timestamp');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError('Invalid timestamp');
  return parsed;
}

/** Shared strict instant parser for pure subscription timing contracts. */
export const parseSubscriptionInstant = instant;

function periodBounds(
  start: string,
  end: string,
  at: string
): {
  start: number;
  end: number;
  at: number;
} {
  const bounds = { start: instant(start), end: instant(end), at: instant(at) };
  if (
    bounds.start >= bounds.end ||
    bounds.at < bounds.start ||
    bounds.at >= bounds.end
  ) {
    throw new RangeError('Time must be within a valid paid billing period');
  }
  return bounds;
}

function tierRank(tier: SubscriptionTier): number {
  return SUBSCRIPTION_TIERS.indexOf(tier);
}

export function baseMonthlySoftwareMinor(tier: SubscriptionTier): number {
  return SUBSCRIPTION_PLANS[tier].monthlySoftwareInr * 100;
}

/** Difference × actual remaining milliseconds / actual period milliseconds, rounded half-up to one paise. */
export function proratedUpgradeDifferenceMinor({
  currentMonthlyMinor,
  targetMonthlyMinor,
  periodStart,
  periodEnd,
  chargeAt,
}: {
  currentMonthlyMinor: number;
  targetMonthlyMinor: number;
  periodStart: string;
  periodEnd: string;
  chargeAt: string;
}): number {
  if (
    !Number.isSafeInteger(currentMonthlyMinor) ||
    !Number.isSafeInteger(targetMonthlyMinor) ||
    currentMonthlyMinor < 0 ||
    targetMonthlyMinor <= currentMonthlyMinor
  ) {
    throw new RangeError('Target monthly software amount must be greater');
  }
  const { start, end, at } = periodBounds(periodStart, periodEnd, chargeAt);
  const numerator =
    BigInt(targetMonthlyMinor - currentMonthlyMinor) * BigInt(end - at);
  const denominator = BigInt(end - start);
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded =
    whole + (remainder * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Prorated amount is too large');
  return Number(rounded);
}

export interface UpgradeIntent {
  requestId: string;
  organizationId: string;
  fromTier: SubscriptionTier;
  toTier: SubscriptionTier;
  periodStart: string;
  periodEnd: string;
  requestedAt: string;
  chargeMinor: number;
  state: 'pending' | 'failed' | 'verified';
  verifiedProviderPaymentId: string | null;
  verifiedAt: string | null;
}

/** Base tier price only. Add-on changes require their own approved quote policy. */
export function prepareBaseTierUpgrade({
  requestId,
  organizationId,
  fromTier,
  toTier,
  periodStart,
  periodEnd,
  requestedAt,
}: Omit<
  UpgradeIntent,
  'chargeMinor' | 'state' | 'verifiedProviderPaymentId' | 'verifiedAt'
>): UpgradeIntent {
  if (
    !requestId.trim() ||
    !organizationId.trim() ||
    tierRank(toTier) <= tierRank(fromTier)
  ) {
    throw new RangeError(
      'A higher tier and valid request identity are required'
    );
  }
  const chargeMinor = proratedUpgradeDifferenceMinor({
    currentMonthlyMinor: baseMonthlySoftwareMinor(fromTier),
    targetMonthlyMinor: baseMonthlySoftwareMinor(toTier),
    periodStart,
    periodEnd,
    chargeAt: requestedAt,
  });
  if (chargeMinor < 1)
    throw new RangeError('Upgrade must wait for the next billing period');
  return {
    requestId,
    organizationId,
    fromTier,
    toTier,
    periodStart,
    periodEnd,
    requestedAt,
    chargeMinor,
    state: 'pending',
    verifiedProviderPaymentId: null,
    verifiedAt: null,
  };
}

export type UpgradePaymentEvent =
  | { kind: 'payment_failed'; requestId: string }
  | {
      /** This fact must be built only after trusted provider verification. */
      kind: 'server_verified_payment';
      requestId: string;
      providerPaymentId: string;
      paidMinor: number;
      verifiedAt: string;
    };

/** Pure event reducer. It does not call Razorpay or verify merchant/currency/order. */
export function applyUpgradePaymentEvent(
  intent: UpgradeIntent,
  event: UpgradePaymentEvent
): UpgradeIntent {
  if (event.requestId !== intent.requestId)
    throw new Error('Upgrade request does not match');
  if (event.kind === 'payment_failed') {
    return intent.state === 'verified'
      ? intent
      : { ...intent, state: 'failed' };
  }
  if (
    !event.providerPaymentId.trim() ||
    event.paidMinor !== intent.chargeMinor
  ) {
    throw new Error('Verified upgrade payment does not match the quote');
  }
  if (intent.state === 'verified') {
    if (intent.verifiedProviderPaymentId === event.providerPaymentId)
      return intent;
    throw new Error('Upgrade was already verified with another payment');
  }
  const verifiedAt = instant(event.verifiedAt);
  if (
    verifiedAt < instant(intent.requestedAt) ||
    verifiedAt >= instant(intent.periodEnd)
  ) {
    throw new RangeError('Payment confirmation is outside the quoted period');
  }
  return {
    ...intent,
    state: 'verified',
    verifiedProviderPaymentId: event.providerPaymentId,
    verifiedAt: event.verifiedAt,
  };
}

/** Projected tier within this paid term; a new renewal needs its own verified grant. */
export function upgradeTierAt(
  intent: UpgradeIntent,
  at: string
): SubscriptionTier | null {
  const time = instant(at);
  if (time < instant(intent.periodStart) || time >= instant(intent.periodEnd))
    return null;
  if (
    intent.state === 'verified' &&
    intent.verifiedAt &&
    time >= instant(intent.verifiedAt)
  ) {
    return intent.toTier;
  }
  return intent.fromTier;
}

export interface ScheduledRenewalChange {
  requestId: string;
  organizationId: string;
  fromTier: SubscriptionTier;
  targetTier: SubscriptionTier | null;
  periodStart: string;
  requestedAt: string;
  paidThroughEnd: string;
  state: 'scheduled' | 'committed';
  verifiedRenewalPaymentId: string | null;
  committedAt: string | null;
  targetPaidThroughEnd: string | null;
}

/** Null target schedules cancellation; a lower target schedules a downgrade. */
export function scheduleNextRenewalChange({
  requestId,
  organizationId,
  fromTier,
  targetTier,
  periodStart,
  paidThroughEnd,
  requestedAt,
}: Omit<
  ScheduledRenewalChange,
  'state' | 'verifiedRenewalPaymentId' | 'committedAt' | 'targetPaidThroughEnd'
>): ScheduledRenewalChange {
  if (
    !requestId.trim() ||
    !organizationId.trim() ||
    (targetTier !== null && tierRank(targetTier) >= tierRank(fromTier))
  ) {
    throw new RangeError('A lower tier or cancellation is required');
  }
  periodBounds(periodStart, paidThroughEnd, requestedAt);
  return {
    requestId,
    organizationId,
    fromTier,
    targetTier,
    periodStart,
    requestedAt,
    paidThroughEnd,
    state: 'scheduled',
    verifiedRenewalPaymentId: null,
    committedAt: null,
    targetPaidThroughEnd: null,
  };
}

/** Projection only: current access lasts through the paid-through end, never beyond it. */
export function scheduledTierAt(
  change: ScheduledRenewalChange,
  at: string
): SubscriptionTier | null {
  const time = instant(at);
  if (time < instant(change.periodStart)) return null;
  if (time < instant(change.paidThroughEnd)) return change.fromTier;
  if (
    change.targetTier !== null &&
    change.state === 'committed' &&
    change.committedAt &&
    change.targetPaidThroughEnd &&
    time >= instant(change.committedAt) &&
    time < instant(change.targetPaidThroughEnd)
  ) {
    return change.targetTier;
  }
  return null;
}

/**
 * Pure downgrade commit contract. The future database transaction must re-read
 * branches, target-term slot payments, and exact owner archive choices under the organization lock,
 * archive only selected branches, then recheck the resulting roster and commit
 * the new paid entitlement in the same transaction.
 */
export function commitScheduledDowngrade(
  change: ScheduledRenewalChange,
  evidence: {
    requestId: string;
    providerPaymentId: string;
    verifiedAt: string;
    nextPaidThroughEnd: string;
  },
  resolution: {
    branches: readonly SubscriptionBranch[];
    purchases: readonly BranchSlotPurchase[];
  }
): ScheduledRenewalChange {
  if (change.targetTier === null)
    throw new Error('Cancellation has no downgrade payment');
  if (
    evidence.requestId !== change.requestId ||
    !evidence.providerPaymentId.trim()
  ) {
    throw new Error('Verified renewal payment does not match the request');
  }
  if (change.state === 'committed') {
    if (
      change.verifiedRenewalPaymentId === evidence.providerPaymentId &&
      change.targetPaidThroughEnd === evidence.nextPaidThroughEnd
    )
      return change;
    throw new Error('Downgrade was already committed with another payment');
  }
  if (instant(evidence.verifiedAt) < instant(change.paidThroughEnd)) {
    throw new RangeError('Downgrade cannot take effect before renewal');
  }
  if (instant(evidence.nextPaidThroughEnd) <= instant(evidence.verifiedAt)) {
    throw new RangeError('The new paid-through end must follow confirmation');
  }
  const review = reviewSubscriptionConversion({
    organizationId: change.organizationId,
    tier: change.targetTier,
    branches: resolution.branches,
    purchases: resolution.purchases,
    archiveAccountIds: [],
  });
  if (!review.ready)
    throw new Error(`Branch resolution is not ready: ${review.blocker}`);
  return {
    ...change,
    state: 'committed',
    verifiedRenewalPaymentId: evidence.providerPaymentId,
    committedAt: evidence.verifiedAt,
    targetPaidThroughEnd: evidence.nextPaidThroughEnd,
  };
}
