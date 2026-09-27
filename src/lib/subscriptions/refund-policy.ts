import { isValidTimeZone } from '@/lib/locale/config';
import { todayInTz } from '@/lib/locale/format';
import { parseSubscriptionInstant } from './billing-transitions';

const FIRST_PAYMENT_REFUND_DAYS = 7;

export interface FirstSubscriptionPaymentFacts {
  organizationId: string;
  /** The first verified Usefulmade SaaS payment for this organization, from the billing ledger. */
  firstPaymentId: string;
  paidAt: string;
  paidMinor: number;
  /** Capture the billing account's IANA zone with the first payment; never use the requester's current zone. */
  billingTimeZone: string;
}

export interface FirstPaymentRefundRequest {
  requestId: string;
  organizationId: string;
  paymentId: string;
  requestedAt: string;
}

/** A local request reservation, not provider refund approval or settlement. */
export interface FirstPaymentRefundClaim {
  requestId: string;
  organizationId: string;
  firstPaymentId: string;
  requestedAt: string;
  billingTimeZone: string;
  refundMinor: number;
  state: 'requested';
}

export type FirstPaymentRefundDecision =
  | { eligible: true; claim: FirstPaymentRefundClaim; replay: boolean }
  | {
      eligible: false;
      reason: 'not_first_payment' | 'outside_window' | 'already_claimed';
      claim: null;
    };

function calendarDayNumber(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** Payment date is day 0; requests through local day 7 are timely. */
export function firstPaymentRefundLastRequestDate(
  facts: FirstSubscriptionPaymentFacts
): string {
  if (!isValidTimeZone(facts.billingTimeZone))
    throw new RangeError('A valid billing timezone is required');
  const paidAt = parseSubscriptionInstant(facts.paidAt);
  const localPaymentDate = todayInTz(facts.billingTimeZone, new Date(paidAt));
  return new Date(
    (calendarDayNumber(localPaymentDate) + FIRST_PAYMENT_REFUND_DAYS) *
      86_400_000
  )
    .toISOString()
    .slice(0, 10);
}

/** Pure eligibility and one-per-organization reservation; a future transaction must re-read payment and claim facts. */
export function requestFirstPaymentRefund(
  facts: FirstSubscriptionPaymentFacts,
  request: FirstPaymentRefundRequest,
  existingClaim: FirstPaymentRefundClaim | null
): FirstPaymentRefundDecision {
  if (
    !facts.organizationId.trim() ||
    !facts.firstPaymentId.trim() ||
    !request.requestId.trim() ||
    request.organizationId !== facts.organizationId ||
    !Number.isSafeInteger(facts.paidMinor) ||
    facts.paidMinor < 1
  ) {
    throw new RangeError(
      'Verified first-payment facts must match the organization'
    );
  }
  if (!isValidTimeZone(facts.billingTimeZone))
    throw new RangeError('A valid billing timezone is required');
  const paidAt = parseSubscriptionInstant(facts.paidAt);
  const requestedAt = parseSubscriptionInstant(request.requestedAt);
  if (existingClaim) {
    if (existingClaim.organizationId !== facts.organizationId)
      throw new Error('Existing refund claim belongs to another organization');
    if (existingClaim.requestId === request.requestId) {
      if (
        existingClaim.firstPaymentId !== facts.firstPaymentId ||
        existingClaim.firstPaymentId !== request.paymentId ||
        existingClaim.requestedAt !== request.requestedAt ||
        existingClaim.billingTimeZone !== facts.billingTimeZone ||
        existingClaim.refundMinor !== facts.paidMinor
      ) {
        throw new Error('Refund request ID was reused with different facts');
      }
      return { eligible: true, claim: existingClaim, replay: true };
    }
    return { eligible: false, reason: 'already_claimed', claim: null };
  }
  if (request.paymentId !== facts.firstPaymentId)
    return { eligible: false, reason: 'not_first_payment', claim: null };
  const paymentDay = todayInTz(facts.billingTimeZone, new Date(paidAt));
  const requestDay = todayInTz(facts.billingTimeZone, new Date(requestedAt));
  const elapsedDays =
    calendarDayNumber(requestDay) - calendarDayNumber(paymentDay);
  if (
    requestedAt < paidAt ||
    elapsedDays < 0 ||
    elapsedDays > FIRST_PAYMENT_REFUND_DAYS
  ) {
    return { eligible: false, reason: 'outside_window', claim: null };
  }
  return {
    eligible: true,
    replay: false,
    claim: {
      requestId: request.requestId,
      organizationId: facts.organizationId,
      firstPaymentId: facts.firstPaymentId,
      requestedAt: request.requestedAt,
      billingTimeZone: facts.billingTimeZone,
      refundMinor: facts.paidMinor,
      state: 'requested',
    },
  };
}
