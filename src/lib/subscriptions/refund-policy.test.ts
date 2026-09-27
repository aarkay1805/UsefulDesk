import { describe, expect, it } from 'vitest';
import {
  firstPaymentRefundLastRequestDate,
  requestFirstPaymentRefund,
  type FirstSubscriptionPaymentFacts,
} from './refund-policy';

const facts: FirstSubscriptionPaymentFacts = {
  organizationId: 'org-1',
  firstPaymentId: 'first-pay-1',
  paidAt: '2026-09-01T18:45:00.000Z', // 2026-09-02 in Asia/Kolkata
  paidMinor: 149900,
  billingTimeZone: 'Asia/Kolkata',
};
const request = {
  requestId: 'refund-1',
  organizationId: 'org-1',
  paymentId: 'first-pay-1',
  requestedAt: '2026-09-09T18:29:59.999Z', // end of local day 7
};

describe('first UsefulDesk subscription payment refund policy', () => {
  it('accepts the full first payment through local calendar day seven and excludes day eight', () => {
    expect(firstPaymentRefundLastRequestDate(facts)).toBe('2026-09-09');
    const decision = requestFirstPaymentRefund(facts, request, null);
    expect(decision).toEqual({
      eligible: true,
      replay: false,
      claim: {
        requestId: 'refund-1',
        organizationId: 'org-1',
        firstPaymentId: 'first-pay-1',
        requestedAt: request.requestedAt,
        billingTimeZone: 'Asia/Kolkata',
        refundMinor: 149900,
        state: 'requested',
      },
    });
    expect(
      requestFirstPaymentRefund(
        facts,
        { ...request, requestedAt: '2026-09-09T18:30:00.000Z' },
        null
      )
    ).toEqual({ eligible: false, reason: 'outside_window', claim: null });
  });

  it('uses the frozen billing timezone across DST and refuses an invalid zone', () => {
    const nyFacts = {
      ...facts,
      paidAt: '2026-10-31T03:30:00.000Z', // Oct 30 in New York
      billingTimeZone: 'America/New_York',
    };
    expect(firstPaymentRefundLastRequestDate(nyFacts)).toBe('2026-11-06');
    expect(
      requestFirstPaymentRefund(
        nyFacts,
        { ...request, requestedAt: '2026-11-07T04:59:59.999Z' },
        null
      ).eligible
    ).toBe(true);
    expect(
      requestFirstPaymentRefund(
        nyFacts,
        { ...request, requestedAt: '2026-11-07T05:00:00.000Z' },
        null
      )
    ).toEqual({ eligible: false, reason: 'outside_window', claim: null });
    expect(() =>
      requestFirstPaymentRefund(
        { ...facts, billingTimeZone: 'Mars/Olympus_Mons' },
        request,
        null
      )
    ).toThrow('billing timezone');
  });

  it('requires an actual first subscription payment in the same organization', () => {
    expect(
      requestFirstPaymentRefund(
        facts,
        { ...request, paymentId: 'later-renewal' },
        null
      )
    ).toEqual({ eligible: false, reason: 'not_first_payment', claim: null });
    expect(() =>
      requestFirstPaymentRefund(
        facts,
        { ...request, organizationId: 'org-2' },
        null
      )
    ).toThrow('match the organization');
    expect(
      requestFirstPaymentRefund(
        facts,
        { ...request, requestedAt: '2026-09-01T18:44:59.999Z' },
        null
      )
    ).toEqual({ eligible: false, reason: 'outside_window', claim: null });
  });

  it('reserves one claim per organization and replays the same request without a second grant', () => {
    const first = requestFirstPaymentRefund(facts, request, null);
    if (!first.eligible) throw new Error('Expected eligible first request');
    const replay = requestFirstPaymentRefund(facts, request, first.claim);
    expect(replay).toEqual({
      eligible: true,
      claim: first.claim,
      replay: true,
    });
    expect(replay.claim).toBe(first.claim);
    expect(
      requestFirstPaymentRefund(
        facts,
        { ...request, requestId: 'refund-2' },
        first.claim
      )
    ).toEqual({ eligible: false, reason: 'already_claimed', claim: null });
    expect(() =>
      requestFirstPaymentRefund(
        facts,
        { ...request, requestedAt: '2026-09-08T00:00:00.000Z' },
        first.claim
      )
    ).toThrow('reused with different facts');
    expect(() =>
      requestFirstPaymentRefund(
        { ...facts, billingTimeZone: 'UTC' },
        request,
        first.claim
      )
    ).toThrow('reused with different facts');
    expect(() =>
      requestFirstPaymentRefund(
        { ...facts, organizationId: 'org-2' },
        { ...request, organizationId: 'org-2' },
        first.claim
      )
    ).toThrow('another organization');
    const otherOrganization = requestFirstPaymentRefund(
      { ...facts, organizationId: 'org-2', firstPaymentId: 'first-pay-2' },
      {
        ...request,
        requestId: 'refund-org-2',
        organizationId: 'org-2',
        paymentId: 'first-pay-2',
      },
      null
    );
    expect(otherOrganization.eligible).toBe(true);
  });
});
