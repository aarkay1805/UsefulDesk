import { describe, expect, it } from 'vitest';

import {
  activityReason,
  parseActivityCursor,
  isIsoDate,
  ruleForLifecycleKind,
  serializeActivityCursor,
  type AutomatedMessageActivityRow,
} from './activity';

const row: AutomatedMessageActivityRow = {
  activity_id: 'lifecycle:123e4567-e89b-42d3-a456-426614174000',
  account_id: 'account',
  rule_id: 'invoice_collection',
  source_kind: 'invoice_due',
  contact_id: 'contact',
  contact_name: 'Asha',
  membership_id: null,
  member_service_id: null,
  invoice_id: null,
  conversation_id: null,
  follow_up_id: null,
  occurred_at: '2026-09-12T10:00:00.000Z',
  scheduled_for: null,
  outcome: 'accepted',
  job_state: 'accepted',
  reason_code: null,
  provider_message_id: 'wamid',
  message_status: 'sent',
  provider_error_title: null,
  provider_error_detail: null,
};

describe('automated message activity semantics', () => {
  it('does not turn provider acceptance into delivery', () => {
    expect(activityReason(row)).toBe(
      'WhatsApp accepted the message; delivery has not been confirmed.'
    );
  });

  it('translates provider delivery failures without exposing or guessing the cause', () => {
    expect(
      activityReason({
        ...row,
        outcome: 'failed',
        reason_code: 'provider_delivery_failed',
      })
    ).toBe(
      'WhatsApp could not deliver this message. Check the member’s phone number, then open the chat for details.'
    );

    expect(
      activityReason({
        ...row,
        outcome: 'failed',
        reason_code: 'provider_delivery_failed',
        provider_error_title: 'Message undeliverable',
        provider_error_detail: 'Message Undeliverable.',
      })
    ).toBe(
      'WhatsApp could not deliver this message. Check the member’s phone number, then open the chat for details.'
    );

    expect(
      activityReason({
        ...row,
        outcome: 'failed',
        reason_code: 'provider_delivery_failed',
        provider_error_title:
          'This message was not delivered to maintain healthy ecosystem engagement.',
        provider_error_detail:
          'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.',
      })
    ).toBe(
      'WhatsApp limited this reminder based on engagement. Open the chat before contacting the member another way.'
    );
  });

  it('keeps an unknown provider outcome uncertain even when diagnostics were retained', () => {
    expect(
      activityReason({
        ...row,
        outcome: 'ambiguous',
        reason_code: 'provider_outcome_unknown',
        provider_error_title: 'Message undeliverable',
        provider_error_detail: 'The request ended before status was confirmed.',
      })
    ).toBe(
      'WhatsApp did not confirm what happened. Open the chat before sending anything again.'
    );

    expect(
      activityReason({
        ...row,
        outcome: 'unconfirmed',
        reason_code: 'legacy_claim_unconfirmed',
        provider_error_title: 'Message undeliverable',
        provider_error_detail: 'No final status was saved.',
      })
    ).toBe(
      'There is no saved WhatsApp status for this older reminder. Open the chat if you need to confirm what happened.'
    );
  });

  it.each([
    ['missing', 'Set up this WhatsApp message before it can send.'],
    [
      'pending',
      'This WhatsApp message is waiting for approval. Check its setup for the latest status.',
    ],
    [
      'rejected',
      'This WhatsApp message was not approved. Review its setup before using it.',
    ],
    [
      'paused',
      'WhatsApp paused this message. Review its setup before using it.',
    ],
    [
      'disabled',
      'WhatsApp disabled this message. Review its setup before using it.',
    ],
    ['not_approved', 'Get this WhatsApp message approved before it can send.'],
    [
      'wrong_category',
      'This WhatsApp message no longer matches the required setup. Review its setup before using it.',
    ],
    [
      'wrong_parameter_format',
      'This WhatsApp message no longer matches the required setup. Review its setup before using it.',
    ],
    [
      'parameter_drift',
      'This WhatsApp message no longer matches the required setup. Review its setup before using it.',
    ],
    [
      'component_drift',
      'This WhatsApp message no longer matches the required setup. Review its setup before using it.',
    ],
    [
      'provider_sync_required',
      'Check this WhatsApp message’s latest approval status before it can send.',
    ],
  ])('translates the %s setup state', (reasonCode, expected) => {
    expect(
      activityReason({
        ...row,
        outcome: 'blocked',
        reason_code: reasonCode,
      })
    ).toBe(expected);
  });

  it.each([
    [
      'daily_coordination_unavailable',
      'UsefulDesk couldn’t safely schedule this message. It will check again automatically.',
    ],
    [
      'reply_history_unavailable',
      'UsefulDesk couldn’t check recent replies. Open the chat before sending anything manually.',
    ],
    [
      'manual_fallback_needs_staff_review',
      'Review the invoice and AutoPay result before asking the member to pay another way.',
    ],
    [
      'provider_outcome_unknown',
      'WhatsApp did not confirm what happened. Open the chat before sending anything again.',
    ],
    ['outside_send_window', 'Waiting until this branch’s sending hours begin.'],
    ['waiting_for_send_window', 'Waiting until the scheduled sending time.'],
    [
      'missing_phone',
      'Check the member’s phone number before this message can send.',
    ],
    [
      'whatsapp_not_connected',
      'Connect WhatsApp for this branch before this message can send.',
    ],
    [
      'lease_expired_before_outcome',
      'WhatsApp did not confirm what happened. Open the chat before sending anything again.',
    ],
    [
      'lease_expired_before_provider',
      'This message did not reach WhatsApp. UsefulDesk will check again automatically if it is still due.',
    ],
    [
      'legacy_claim_unconfirmed',
      'There is no saved WhatsApp status for this older reminder. Open the chat if you need to confirm what happened.',
    ],
    [
      'post_expiry_subject_changed',
      'Stopped because the membership or service details changed.',
    ],
    [
      'post_expiry_no_longer_active',
      'Stopped because this message was turned off or replaced.',
    ],
    ['invoice_hold_open', 'Paused while this invoice is on hold.'],
    [
      'invoice_commitment_or_hold_open',
      'Paused while a payment promise or invoice hold is active.',
    ],
    [
      'provider_request_failed',
      'This message did not reach WhatsApp. UsefulDesk will check again automatically if it is still due.',
    ],
    ['customer_replied', 'Stopped because the member replied.'],
    [
      'daily_contact_budget',
      'Waiting because another automated message is already scheduled or sent to this member today.',
    ],
    [
      'superseded_or_expired_milestone',
      'Stopped because a newer reminder now applies.',
    ],
    [
      'invoice_no_longer_collectible',
      'Stopped because this invoice no longer needs collection.',
    ],
    [
      'template_not_ready',
      'Get this WhatsApp message approved before it can send.',
    ],
    [
      'payment_confirmations_disabled_or_regenerated',
      'Stopped because this message was turned off or replaced.',
    ],
    [
      'autopay_recovery_disabled_or_regenerated',
      'Stopped because this message was turned off or replaced.',
    ],
  ])('translates the %s activity reason', (reasonCode, expected) => {
    expect(activityReason({ ...row, reason_code: reasonCode })).toBe(expected);
  });

  it.each([
    [
      'created',
      'A staff follow-up was created because no reply was recorded. Open the member to review it.',
    ],
    [
      'existing',
      'A staff follow-up is already open. Open the member to review it.',
    ],
    [
      'owner_unavailable',
      'No available staff member could be assigned. Open the member to assign the follow-up.',
    ],
    ['replied', 'The member replied, so no staff follow-up was created.'],
    [
      'stopped',
      'The staff follow-up was closed because this message no longer applies.',
    ],
  ] as const)(
    'translates the %s follow-up state',
    (escalationState, expected) => {
      expect(
        activityReason({
          ...row,
          reason_code: null,
          escalation_state: escalationState,
        })
      ).toBe(expected);
    }
  );

  it.each([
    [
      'failed',
      'WhatsApp could not deliver this message. Check the member’s phone number, then open the chat for details.',
    ],
    [
      'blocked',
      'This message needs setup or a member detail before it can send. Review the message and member.',
    ],
    ['stopped', 'This message no longer applies to this member.'],
    [
      'ambiguous',
      'WhatsApp did not confirm what happened. Open the chat before sending anything again.',
    ],
    ['attempting', 'UsefulDesk is sending this message.'],
    ['waiting', 'Waiting until the scheduled sending time.'],
    ['paused', 'Paused until the current hold or payment promise is resolved.'],
    [
      'unconfirmed',
      'There is no saved WhatsApp status for this older reminder. Open the chat if you need to confirm what happened.',
    ],
  ] as const)('uses a plain fallback for %s', (outcome, expected) => {
    expect(
      activityReason({
        ...row,
        outcome,
        reason_code: null,
        provider_error_title: null,
        provider_error_detail: null,
      })
    ).toBe(expected);
  });

  it('only accepts a strict opaque keyset cursor', () => {
    expect(parseActivityCursor(serializeActivityCursor(row))).toEqual({
      occurredAt: row.occurred_at,
      activityId: row.activity_id,
    });
    expect(
      parseActivityCursor('eyJvY2N1cnJlZEF0IjoieCIsImFjdGl2aXR5SWQiOiJ4In0')
    ).toBeUndefined();
    const databaseTimestamp = '2026-09-12T10:20:30.123456+00:00';
    expect(
      parseActivityCursor(
        serializeActivityCursor({ ...row, occurred_at: databaseTimestamp })
      )
    ).toEqual({ occurredAt: databaseTimestamp, activityId: row.activity_id });
    expect(isIsoDate('2026-02-30')).toBe(false);
  });

  it('groups every lifecycle kind under its catalogue rule without hiding specialized kinds', () => {
    expect(ruleForLifecycleKind('invoice_due')).toBe('invoice_collection');
    expect(ruleForLifecycleKind('installment_overdue')).toBe(
      'invoice_collection'
    );
    expect(ruleForLifecycleKind('session_pack_exhausted')).toBe('session_pack');
    expect(ruleForLifecycleKind('membership_post_expiry')).toBe(
      'membership_post_expiry'
    );
    expect(ruleForLifecycleKind('payment_confirmation')).toBe(
      'payment_confirmation'
    );
  });
});
