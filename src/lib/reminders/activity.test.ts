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
    expect(activityReason(row)).toContain('accepted');
    expect(
      activityReason({
        ...row,
        outcome: 'blocked',
        reason_code: 'provider_sync_required',
      })
    ).toContain('Sync');
    expect(
      activityReason({
        ...row,
        outcome: 'blocked',
        reason_code: 'wrong_category',
      })
    ).toContain('category');
    expect(
      activityReason({
        ...row,
        outcome: 'unconfirmed',
        reason_code: 'legacy_claim_unconfirmed',
      })
    ).toContain('no provider outcome');
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
