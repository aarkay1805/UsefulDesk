import {
  commitScheduledDowngrade,
  parseSubscriptionInstant,
  type ScheduledRenewalChange,
} from './billing-transitions';
import type { BranchSlotPurchase } from './branch-slots';
import type { SubscriptionBranch, SubscriptionTier } from './plans';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export type PaidRenewalPlan =
  | { kind: 'same_tier' }
  | { kind: 'scheduled_downgrade'; change: ScheduledRenewalChange };

export interface FailedPaidRenewal {
  kind: 'failed_paid_renewal';
  requestId: string;
  existingPaidGrantId: string;
  organizationId: string;
  fromTier: SubscriptionTier;
  periodStart: string;
  paidThroughEnd: string;
  firstFailedAt: string;
  graceEndsAt: string;
  plan: PaidRenewalPlan;
  state: 'failed' | 'verified';
  verifiedProviderPaymentId: string | null;
  verifiedAt: string | null;
  nextPaidThroughEnd: string | null;
}

/** Only a failed renewal of an existing paid grant can enter grace. A cancelled renewal has no plan here. */
export function startFailedPaidRenewal({
  requestId,
  existingPaidGrantId,
  organizationId,
  fromTier,
  periodStart,
  paidThroughEnd,
  firstFailedAt,
  scheduledChange,
}: Omit<
  FailedPaidRenewal,
  | 'kind'
  | 'graceEndsAt'
  | 'state'
  | 'verifiedProviderPaymentId'
  | 'verifiedAt'
  | 'nextPaidThroughEnd'
  | 'plan'
> & { scheduledChange: ScheduledRenewalChange | null }): FailedPaidRenewal {
  if (
    !requestId.trim() ||
    !existingPaidGrantId.trim() ||
    !organizationId.trim()
  )
    throw new RangeError('An existing paid renewal identity is required');
  const start = parseSubscriptionInstant(periodStart);
  const end = parseSubscriptionInstant(paidThroughEnd);
  const failedAt = parseSubscriptionInstant(firstFailedAt);
  if (start >= end || failedAt < start)
    throw new RangeError('A valid existing paid term is required');
  let plan: PaidRenewalPlan = { kind: 'same_tier' };
  if (scheduledChange) {
    const change = scheduledChange;
    if (change.targetTier === null) {
      throw new RangeError('Cancelled renewals cannot enter payment grace');
    }
    if (
      change.state !== 'scheduled' ||
      change.organizationId !== organizationId ||
      change.fromTier !== fromTier ||
      parseSubscriptionInstant(change.periodStart) !== start ||
      parseSubscriptionInstant(change.paidThroughEnd) !== end
    ) {
      throw new RangeError('Scheduled downgrade does not match the paid term');
    }
    plan = { kind: 'scheduled_downgrade', change };
  }
  const graceEnd = end + THREE_DAYS_MS;
  if (
    !Number.isFinite(graceEnd) ||
    !Number.isFinite(new Date(graceEnd).getTime())
  )
    throw new RangeError('Grace deadline is out of range');
  return {
    kind: 'failed_paid_renewal',
    requestId,
    existingPaidGrantId,
    organizationId,
    fromTier,
    periodStart,
    paidThroughEnd,
    firstFailedAt,
    graceEndsAt: new Date(graceEnd).toISOString(),
    plan,
    state: 'failed',
    verifiedProviderPaymentId: null,
    verifiedAt: null,
    nextPaidThroughEnd: null,
  };
}

export type PaidRenewalEvent =
  | { kind: 'payment_failed'; requestId: string; failedAt: string }
  | {
      /** Construct only after trusted server verification of the Usefulmade renewal payment. */
      kind: 'server_verified_payment';
      requestId: string;
      providerPaymentId: string;
      verifiedAt: string;
      nextPaidThroughEnd: string;
      downgradeResolution?: {
        branches: readonly SubscriptionBranch[];
        purchases: readonly BranchSlotPurchase[];
      };
    };

/** Failed retries do not change the deadline. A verified renewal grants one paid term. */
export function applyPaidRenewalEvent(
  renewal: FailedPaidRenewal,
  event: PaidRenewalEvent
): FailedPaidRenewal {
  if (event.requestId !== renewal.requestId)
    throw new Error('Paid renewal request does not match');
  if (event.kind === 'payment_failed') {
    parseSubscriptionInstant(event.failedAt);
    return renewal;
  }
  if (!event.providerPaymentId.trim())
    throw new Error('Verified renewal payment ID is required');
  if (renewal.state === 'verified') {
    if (
      renewal.verifiedProviderPaymentId === event.providerPaymentId &&
      renewal.nextPaidThroughEnd === event.nextPaidThroughEnd
    )
      return renewal;
    throw new Error('Renewal was already verified with another payment');
  }
  const verifiedAt = parseSubscriptionInstant(event.verifiedAt);
  const nextEnd = parseSubscriptionInstant(event.nextPaidThroughEnd);
  if (verifiedAt < parseSubscriptionInstant(renewal.paidThroughEnd))
    throw new RangeError('Renewal cannot activate before the paid-through end');
  if (nextEnd <= verifiedAt)
    throw new RangeError('The next paid-through end must follow verification');
  let plan = renewal.plan;
  if (plan.kind === 'scheduled_downgrade') {
    if (!event.downgradeResolution)
      throw new Error('Post-archive downgrade resolution is required');
    const committedChange = commitScheduledDowngrade(
      plan.change,
      {
        requestId: plan.change.requestId,
        providerPaymentId: event.providerPaymentId,
        verifiedAt: event.verifiedAt,
        nextPaidThroughEnd: event.nextPaidThroughEnd,
      },
      event.downgradeResolution
    );
    plan = { kind: 'scheduled_downgrade', change: committedChange };
  }
  return {
    ...renewal,
    plan,
    state: 'verified',
    verifiedProviderPaymentId: event.providerPaymentId,
    verifiedAt: event.verifiedAt,
    nextPaidThroughEnd: event.nextPaidThroughEnd,
  };
}

export type PaidRenewalAccess =
  | { status: 'paid'; tier: SubscriptionTier; mayStartPaidExpansion: true }
  | { status: 'grace'; tier: SubscriptionTier; mayStartPaidExpansion: false }
  | { status: 'expired'; tier: null; mayStartPaidExpansion: false };

/** Grace is [paidThroughEnd, paidThroughEnd + 72h), anchored to the original term. */
export function paidRenewalAccessAt(
  renewal: FailedPaidRenewal,
  at: string
): PaidRenewalAccess {
  const time = parseSubscriptionInstant(at);
  const start = parseSubscriptionInstant(renewal.periodStart);
  const end = parseSubscriptionInstant(renewal.paidThroughEnd);
  if (time < start)
    return { status: 'expired', tier: null, mayStartPaidExpansion: false };
  if (time < end)
    return {
      status: 'paid',
      tier: renewal.fromTier,
      mayStartPaidExpansion: true,
    };
  if (
    renewal.state === 'verified' &&
    renewal.verifiedAt &&
    renewal.nextPaidThroughEnd &&
    time >= parseSubscriptionInstant(renewal.verifiedAt)
  ) {
    if (time >= parseSubscriptionInstant(renewal.nextPaidThroughEnd))
      return { status: 'expired', tier: null, mayStartPaidExpansion: false };
    const tier =
      renewal.plan.kind === 'same_tier'
        ? renewal.fromTier
        : renewal.plan.change.targetTier;
    if (tier === null)
      return { status: 'expired', tier: null, mayStartPaidExpansion: false };
    return {
      status: 'paid',
      tier,
      mayStartPaidExpansion: true,
    };
  }
  if (
    time < parseSubscriptionInstant(renewal.graceEndsAt) &&
    (renewal.state === 'failed' ||
      (renewal.verifiedAt &&
        time < parseSubscriptionInstant(renewal.verifiedAt)))
  ) {
    return {
      status: 'grace',
      tier: renewal.fromTier,
      mayStartPaidExpansion: false,
    };
  }
  return { status: 'expired', tier: null, mayStartPaidExpansion: false };
}
