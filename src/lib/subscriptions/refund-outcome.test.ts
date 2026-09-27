import { describe, expect, it } from 'vitest';
import { requestFirstPaymentRefund } from './refund-policy';
import {
  applyFirstPaymentRefundEvent,
  paidAccessAfterFirstPaymentRefundAt,
  prepareFirstPaymentRefundOutcome,
} from './refund-outcome';

const request = {
  requestId: 'refund-request-1',
  organizationId: 'org-1',
  paymentId: 'saas-first-1',
  requestedAt: '2026-09-03T10:00:00.000Z',
};
const decision = requestFirstPaymentRefund(
  {
    organizationId: 'org-1',
    firstPaymentId: 'saas-first-1',
    paidAt: '2026-09-01T10:00:00.000Z',
    paidMinor: 149900,
    billingTimeZone: 'Asia/Kolkata',
  },
  request,
  null
);
if (!decision.eligible) throw new Error('Expected eligible first payment');

const paid = {
  organizationId: 'org-1',
  paidGrantId: 'grant-1',
  firstPaymentId: 'saas-first-1',
  firstPaymentPaidMinor: 149900,
  tier: 'growth' as const,
  paidTermStart: '2026-09-01T10:00:00.000Z',
  paidThroughEnd: '2026-10-01T10:00:00.000Z',
  claim: decision.claim,
};
const confirmedEvent = {
  kind: 'server_confirmed_full_refund' as const,
  requestId: request.requestId,
  organizationId: paid.organizationId,
  paymentId: paid.firstPaymentId,
  providerRefundId: 'rfnd-1',
  refundedMinor: 149900,
  confirmedAt: '2026-09-04T12:00:00.000Z',
};

describe('confirmed first-payment refund access outcome', () => {
  it('keeps paid access and renewal unchanged while refund is requested, pending, or failed', () => {
    const requested = prepareFirstPaymentRefundOutcome(paid);
    const pending = applyFirstPaymentRefundEvent(requested, {
      kind: 'refund_pending',
      requestId: request.requestId,
      organizationId: paid.organizationId,
      paymentId: paid.firstPaymentId,
    });
    const failed = applyFirstPaymentRefundEvent(pending, {
      kind: 'refund_failed',
      requestId: request.requestId,
      organizationId: paid.organizationId,
      paymentId: paid.firstPaymentId,
    });
    for (const state of [requested, pending, failed]) {
      expect(state.confirmedAt).toBeNull();
      expect(state.renewalMustStop).toBe(false);
      expect(
        paidAccessAfterFirstPaymentRefundAt(state, confirmedEvent.confirmedAt)
      ).toBe(true);
    }
    expect(
      paidAccessAfterFirstPaymentRefundAt(failed, paid.paidThroughEnd)
    ).toBe(false);
  });

  it('ends paid access at a matching confirmed full refund and requires renewal to stop once', () => {
    const requested = prepareFirstPaymentRefundOutcome(paid);
    const confirmed = applyFirstPaymentRefundEvent(requested, confirmedEvent);
    expect(confirmed.refundStatus).toBe('confirmed');
    expect(confirmed.renewalMustStop).toBe(true);
    expect(confirmed.confirmedProviderRefundId).toBe('rfnd-1');
    expect(
      paidAccessAfterFirstPaymentRefundAt(confirmed, '2026-09-04T11:59:59.999Z')
    ).toBe(true);
    expect(
      paidAccessAfterFirstPaymentRefundAt(confirmed, confirmedEvent.confirmedAt)
    ).toBe(false);
    expect(confirmed.organizationId).toBe('org-1');
    expect(confirmed.tier).toBe('growth');
    expect(confirmed.claim).toBe(requested.claim);
    expect(requested.refundStatus).toBe('requested'); // Pure transition changes no existing row.
    expect(applyFirstPaymentRefundEvent(confirmed, confirmedEvent)).toBe(
      confirmed
    );
    expect(
      applyFirstPaymentRefundEvent(confirmed, {
        kind: 'refund_failed',
        requestId: request.requestId,
        organizationId: paid.organizationId,
        paymentId: paid.firstPaymentId,
      })
    ).toBe(confirmed);
    expect(() =>
      applyFirstPaymentRefundEvent(confirmed, {
        ...confirmedEvent,
        providerRefundId: 'rfnd-2',
      })
    ).toThrow('another provider refund');
  });

  it('rejects wrong organization, payment, amount, and premature confirmation', () => {
    const requested = prepareFirstPaymentRefundOutcome(paid);
    expect(() =>
      prepareFirstPaymentRefundOutcome({ ...paid, organizationId: 'org-2' })
    ).toThrow('does not match');
    expect(() =>
      prepareFirstPaymentRefundOutcome({
        ...paid,
        firstPaymentPaidMinor: 79900,
      })
    ).toThrow('does not match');
    expect(() =>
      applyFirstPaymentRefundEvent(requested, {
        ...confirmedEvent,
        organizationId: 'org-2',
      })
    ).toThrow('does not match');
    expect(() =>
      applyFirstPaymentRefundEvent(requested, {
        ...confirmedEvent,
        paymentId: 'another-payment',
      })
    ).toThrow('does not match');
    expect(() =>
      applyFirstPaymentRefundEvent(requested, {
        ...confirmedEvent,
        refundedMinor: 149899,
      })
    ).toThrow('not the full first payment');
    expect(() =>
      applyFirstPaymentRefundEvent(requested, {
        ...confirmedEvent,
        confirmedAt: '2026-09-03T09:59:59.999Z',
      })
    ).toThrow('precedes the request');
    expect(requested.renewalMustStop).toBe(false);
  });

  it('keeps access ended if the full refund confirms after the original paid term', () => {
    const requested = prepareFirstPaymentRefundOutcome(paid);
    const late = applyFirstPaymentRefundEvent(requested, {
      ...confirmedEvent,
      confirmedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(paidAccessAfterFirstPaymentRefundAt(late, paid.paidThroughEnd)).toBe(
      false
    );
    expect(late.renewalMustStop).toBe(true);
  });
});
