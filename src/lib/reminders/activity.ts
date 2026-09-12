import type { TemplateReadinessCode } from '@/lib/whatsapp/template-readiness';
import type { LifecycleReminderState } from './types';
import type { LifecycleReminderKind } from './types';

export const ACTIVITY_PAGE_SIZE = 30;
export const ACTIVITY_OUTCOMES = [
  'waiting',
  'paused',
  'attempting',
  'accepted',
  'delivered',
  'read',
  'blocked',
  'stopped',
  'failed',
  'ambiguous',
  'unconfirmed',
] as const;

export type AutomatedMessageActivityOutcome =
  (typeof ACTIVITY_OUTCOMES)[number];

export interface AutomatedMessageActivityRow {
  activity_id: string;
  account_id: string;
  rule_id: string;
  source_kind: string;
  contact_id: string;
  contact_name: string | null;
  contact_avatar_url?: string | null;
  membership_id: string | null;
  member_service_id: string | null;
  invoice_id: string | null;
  conversation_id: string | null;
  follow_up_id: string | null;
  occurred_at: string;
  scheduled_for: string | null;
  outcome: AutomatedMessageActivityOutcome;
  job_state: LifecycleReminderState | null;
  escalation_state?:
    'created' | 'existing' | 'owner_unavailable' | 'replied' | 'stopped' | null;
  next_attempt_at?: string | null;
  reason_code: string | null;
  provider_message_id: string | null;
  message_status: string | null;
  provider_error_title: string | null;
  provider_error_detail: string | null;
}

export interface ActivityCursor {
  occurredAt: string;
  activityId: string;
}

export interface ActivityFilters {
  ruleId?: string;
  outcome?: AutomatedMessageActivityOutcome;
  from?: string;
  to?: string;
  cursor?: ActivityCursor;
}

/** Matches the durable-view grouping; legacy renewal ledgers already carry
 * their catalogue rule IDs. */
export function ruleForLifecycleKind(kind: LifecycleReminderKind): string {
  switch (kind) {
    case 'invoice_due':
    case 'invoice_overdue':
    case 'installment_overdue':
      return 'invoice_collection';
    case 'session_pack_low':
    case 'session_pack_exhausted':
      return 'session_pack';
    default:
      return kind;
  }
}

const templateReasonLabels: Record<
  Exclude<TemplateReadinessCode, 'ready'>,
  string
> = {
  missing:
    'Create the required template in Templates using this rule’s locked preset.',
  pending: 'The required template is awaiting Meta approval.',
  rejected: 'Meta rejected the required template. Review it in Templates.',
  paused:
    'Meta paused the required template. Review its provider status in Templates.',
  disabled: 'Meta disabled the required template. Review it in Templates.',
  not_approved: 'The required template is not approved for sending.',
  wrong_category:
    'The template category does not match this rule. Open its exact preset in Templates.',
  wrong_parameter_format:
    'This rule requires a POSITIONAL template. Review its exact preset in Templates.',
  parameter_drift:
    'The template variables differ from this rule’s contract. Review its exact preset in Templates.',
  component_drift:
    'The template content or buttons differ from this rule’s contract. Review its exact preset in Templates.',
  provider_sync_required:
    'Sync the approved template from Meta before this rule can send.',
};

const reasonLabels: Record<string, string> = {
  ...templateReasonLabels,
  daily_coordination_unavailable:
    'The message coordination check is temporarily unavailable; a retry is scheduled.',
  reply_history_unavailable:
    'Reply history could not be checked. Review the conversation before retrying.',
  manual_fallback_needs_staff_review:
    'Review this invoice and AutoPay outcome before requesting manual payment.',
  provider_outcome_unknown:
    'The provider outcome is unknown. Review the conversation before any resend.',
  outside_send_window: 'Waiting for this branch’s send window.',
  waiting_for_send_window: 'Waiting for the scheduled send window.',
  missing_phone: 'The member has no phone number.',
  whatsapp_not_connected: 'WhatsApp is not connected for this branch.',
  provider_delivery_failed: 'WhatsApp reported that delivery failed.',
  lease_expired_before_outcome:
    'A provider attempt needs review before another send.',
  lease_expired_before_provider:
    'The worker stopped before a provider attempt; it can be retried.',
  legacy_claim_unconfirmed:
    'A legacy claim was recorded, but no provider outcome was retained.',
  post_expiry_subject_changed:
    'Stopped because the membership or service changed.',
  post_expiry_no_longer_active:
    'Stopped because this rule was paused or replaced.',
  invoice_hold_open: 'Paused while an invoice hold is open.',
  invoice_commitment_or_hold_open:
    'Paused while a payment promise or hold is open.',
  provider_request_failed:
    'The provider request failed and will be retried if eligible.',
  customer_replied: 'Stopped because the member replied.',
  daily_contact_budget:
    'Waiting because another customer message already has today’s contact slot.',
  superseded_or_expired_milestone:
    'Stopped because a newer milestone replaced this one.',
  invoice_no_longer_collectible:
    'Stopped because the invoice is no longer collectible.',
  template_not_ready:
    'Sending is blocked until the required WhatsApp template is ready.',
  payment_confirmations_disabled_or_regenerated:
    'Stopped because this rule was paused or replaced.',
  autopay_recovery_disabled_or_regenerated:
    'Stopped because this rule was paused or replaced.',
};

export function activityReason(
  row: Pick<
    AutomatedMessageActivityRow,
    | 'outcome'
    | 'reason_code'
    | 'provider_error_title'
    | 'provider_error_detail'
    | 'escalation_state'
  >
): string {
  if (row.provider_error_title || row.provider_error_detail) {
    return [row.provider_error_title, row.provider_error_detail]
      .filter(Boolean)
      .join(' — ');
  }
  if (row.reason_code && reasonLabels[row.reason_code])
    return reasonLabels[row.reason_code];
  if (row.escalation_state === 'created')
    return 'A staff follow-up was created after the unanswered sequence.';
  if (row.escalation_state === 'existing')
    return 'An existing staff follow-up already owns the next action.';
  if (row.escalation_state === 'owner_unavailable')
    return 'A staff follow-up could not be assigned because the owner is unavailable.';
  if (row.escalation_state === 'replied')
    return 'The member replied, so no staff follow-up was created.';
  if (row.escalation_state === 'stopped')
    return 'The staff follow-up was stopped because the sequence no longer applies.';
  switch (row.outcome) {
    case 'read':
      return 'The member read this WhatsApp message.';
    case 'delivered':
      return 'WhatsApp confirmed delivery.';
    case 'accepted':
      return 'WhatsApp accepted the message; delivery has not been confirmed.';
    case 'failed':
      return 'The message could not be delivered.';
    case 'blocked':
      return 'Sending is blocked until the required setup or member detail is fixed.';
    case 'stopped':
      return 'The sequence no longer applies to this member.';
    case 'ambiguous':
      return 'The provider outcome is unknown and needs review.';
    case 'attempting':
      return 'A provider attempt is in progress.';
    case 'waiting':
      return 'Waiting for its next scheduled attempt.';
    case 'paused':
      return 'Paused until the current hold or promise is resolved.';
    case 'unconfirmed':
      return 'A legacy reminder claim has no retained provider outcome.';
  }
}

export function parseActivityCursor(
  value: string | null
): ActivityCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(
      atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    ) as ActivityCursor;
    return isActivityCursor(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function serializeActivityCursor(
  row: Pick<AutomatedMessageActivityRow, 'occurred_at' | 'activity_id'>
): string {
  return btoa(
    JSON.stringify({ occurredAt: row.occurred_at, activityId: row.activity_id })
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseActivityOutcome(
  value: string | null
): AutomatedMessageActivityOutcome | undefined {
  return ACTIVITY_OUTCOMES.includes(value as AutomatedMessageActivityOutcome)
    ? (value as AutomatedMessageActivityOutcome)
    : undefined;
}

const activityIdPattern =
  /^(?:lifecycle|membership-renewal|service-renewal|installment):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const instantPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isActivityCursor(value: unknown): value is ActivityCursor {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as ActivityCursor;
  return (
    instantPattern.test(cursor.occurredAt) &&
    !Number.isNaN(Date.parse(cursor.occurredAt)) &&
    activityIdPattern.test(cursor.activityId)
  );
}
