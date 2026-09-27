import { parseSubscriptionInstant } from './billing-transitions';
import type { FirstPaymentRefundClaim } from './refund-policy';
import type { SubscriptionTier } from './plans';

export interface PaidSubscriptionRefundState {
  organizationId: string;
  paidGrantId: string;
  firstPaymentId: string;
  firstPaymentPaidMinor: number;
  tier: SubscriptionTier;
  paidTermStart: string;
  paidThroughEnd: string;
  claim: FirstPaymentRefundClaim;
  refundStatus: 'requested' | 'pending' | 'failed' | 'confirmed';
  confirmedProviderRefundId: string | null;
  confirmedAt: string | null;
  /** Policy effect to apply transactionally; this does not cancel a provider subscription. */
  renewalMustStop: boolean;
}

/** Bind an eligible first-payment claim to the exact existing paid grant. */
export function prepareFirstPaymentRefundOutcome({
  organizationId,
  paidGrantId,
  firstPaymentId,
  firstPaymentPaidMinor,
  tier,
  paidTermStart,
  paidThroughEnd,
  claim,
}: Omit<
  PaidSubscriptionRefundState,
  | 'refundStatus'
  | 'confirmedProviderRefundId'
  | 'confirmedAt'
  | 'renewalMustStop'
>): PaidSubscriptionRefundState {
  if (
    !organizationId.trim() ||
    !paidGrantId.trim() ||
    !firstPaymentId.trim() ||
    claim.organizationId !== organizationId ||
    claim.firstPaymentId !== firstPaymentId ||
    !Number.isSafeInteger(firstPaymentPaidMinor) ||
    firstPaymentPaidMinor < 1 ||
    claim.refundMinor !== firstPaymentPaidMinor
  ) {
    throw new Error('Refund claim does not match the existing paid grant');
  }
  if (
    parseSubscriptionInstant(paidTermStart) >=
    parseSubscriptionInstant(paidThroughEnd)
  )
    throw new RangeError('A valid paid term is required');
  return {
    organizationId,
    paidGrantId,
    firstPaymentId,
    firstPaymentPaidMinor,
    tier,
    paidTermStart,
    paidThroughEnd,
    claim,
    refundStatus: 'requested',
    confirmedProviderRefundId: null,
    confirmedAt: null,
    renewalMustStop: false,
  };
}

export type FirstPaymentRefundEvent =
  | {
      kind: 'refund_pending' | 'refund_failed';
      requestId: string;
      organizationId: string;
      paymentId: string;
    }
  | {
      /** Build only after trusted Usefulmade provider verification of a settled full refund. */
      kind: 'server_confirmed_full_refund';
      requestId: string;
      organizationId: string;
      paymentId: string;
      providerRefundId: string;
      refundedMinor: number;
      confirmedAt: string;
    };

/** Pure policy transition. No provider call, database write, sign-in change, or data deletion. */
export function applyFirstPaymentRefundEvent(
  current: PaidSubscriptionRefundState,
  event: FirstPaymentRefundEvent
): PaidSubscriptionRefundState {
  if (
    event.requestId !== current.claim.requestId ||
    event.organizationId !== current.organizationId ||
    event.paymentId !== current.firstPaymentId
  ) {
    throw new Error(
      'Refund event does not match the organization and first payment'
    );
  }
  if (event.kind !== 'server_confirmed_full_refund') {
    if (current.refundStatus === 'confirmed') return current;
    return {
      ...current,
      refundStatus: event.kind === 'refund_pending' ? 'pending' : 'failed',
    };
  }
  if (
    !event.providerRefundId.trim() ||
    event.refundedMinor !== current.claim.refundMinor
  ) {
    throw new Error('Confirmed refund is not the full first payment');
  }
  if (current.refundStatus === 'confirmed') {
    if (current.confirmedProviderRefundId === event.providerRefundId)
      return current;
    throw new Error(
      'First payment was already refunded with another provider refund'
    );
  }
  const confirmedAt = parseSubscriptionInstant(event.confirmedAt);
  if (confirmedAt < parseSubscriptionInstant(current.claim.requestedAt))
    throw new RangeError('Refund confirmation precedes the request');
  return {
    ...current,
    refundStatus: 'confirmed',
    confirmedProviderRefundId: event.providerRefundId,
    confirmedAt: event.confirmedAt,
    renewalMustStop: true,
  };
}

/** Paid operations stop at confirmation or the original term end, whichever is first. */
export function paidAccessAfterFirstPaymentRefundAt(
  state: PaidSubscriptionRefundState,
  at: string
): boolean {
  const time = parseSubscriptionInstant(at);
  return (
    time >= parseSubscriptionInstant(state.paidTermStart) &&
    time < parseSubscriptionInstant(state.paidThroughEnd) &&
    (state.refundStatus !== 'confirmed' ||
      (state.confirmedAt !== null &&
        time < parseSubscriptionInstant(state.confirmedAt)))
  );
}
