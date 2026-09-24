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
  missing: 'Set up this WhatsApp message before it can send.',
  pending:
    'This WhatsApp message is waiting for approval. Check its setup for the latest status.',
  rejected:
    'This WhatsApp message was not approved. Review its setup before using it.',
  paused: 'WhatsApp paused this message. Review its setup before using it.',
  disabled: 'WhatsApp disabled this message. Review its setup before using it.',
  not_approved: 'Get this WhatsApp message approved before it can send.',
  wrong_category:
    'This WhatsApp message no longer matches the required setup. Review its setup before using it.',
  wrong_parameter_format:
    'This WhatsApp message no longer matches the required setup. Review its setup before using it.',
  parameter_drift:
    'This WhatsApp message no longer matches the required setup. Review its setup before using it.',
  component_drift:
    'This WhatsApp message no longer matches the required setup. Review its setup before using it.',
  provider_sync_required:
    'Check this WhatsApp message’s latest approval status before it can send.',
};

const DELIVERY_FAILURE_REASON =
  'WhatsApp could not deliver this message. Check the member’s phone number, then open the chat for details.';
const UNKNOWN_OUTCOME_REASON =
  'WhatsApp did not confirm what happened. Open the chat before sending anything again.';
const BEFORE_WHATSAPP_RETRY_REASON =
  'This message did not reach WhatsApp. UsefulDesk will check again automatically if it is still due.';
const OLDER_STATUS_REASON =
  'There is no saved WhatsApp status for this older reminder. Open the chat if you need to confirm what happened.';
const MESSAGE_REPLACED_REASON =
  'Stopped because this message was turned off or replaced.';

const reasonLabels: Record<string, string> = {
  ...templateReasonLabels,
  daily_coordination_unavailable:
    'UsefulDesk couldn’t safely schedule this message. It will check again automatically.',
  reply_history_unavailable:
    'UsefulDesk couldn’t check recent replies. Open the chat before sending anything manually.',
  manual_fallback_needs_staff_review:
    'Review the invoice and AutoPay result before asking the member to pay another way.',
  provider_outcome_unknown: UNKNOWN_OUTCOME_REASON,
  outside_send_window: 'Waiting until this branch’s sending hours begin.',
  waiting_for_send_window: 'Waiting until the scheduled sending time.',
  missing_phone:
    'Check the member’s phone number before this message can send.',
  whatsapp_not_connected:
    'Connect WhatsApp for this branch before this message can send.',
  provider_delivery_failed: DELIVERY_FAILURE_REASON,
  lease_expired_before_outcome: UNKNOWN_OUTCOME_REASON,
  lease_expired_before_provider: BEFORE_WHATSAPP_RETRY_REASON,
  legacy_claim_unconfirmed: OLDER_STATUS_REASON,
  post_expiry_subject_changed:
    'Stopped because the membership or service details changed.',
  post_expiry_no_longer_active: MESSAGE_REPLACED_REASON,
  invoice_hold_open: 'Paused while this invoice is on hold.',
  invoice_commitment_or_hold_open:
    'Paused while a payment promise or invoice hold is active.',
  provider_request_failed: BEFORE_WHATSAPP_RETRY_REASON,
  customer_replied: 'Stopped because the member replied.',
  daily_contact_budget:
    'Waiting because another automated message is already scheduled or sent to this member today.',
  superseded_or_expired_milestone:
    'Stopped because a newer reminder now applies.',
  invoice_no_longer_collectible:
    'Stopped because this invoice no longer needs collection.',
  template_not_ready: templateReasonLabels.not_approved,
  payment_confirmations_disabled_or_regenerated: MESSAGE_REPLACED_REASON,
  autopay_recovery_disabled_or_regenerated: MESSAGE_REPLACED_REASON,
  attendance_absence_no_longer_eligible:
    'The member checked in or this missed-visit reminder no longer applies.',
  attendance_streak_no_longer_eligible:
    'The member checked in or this longer-absence reminder no longer applies.',
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
  // Retained provider diagnostics may describe a suspected failure, but these
  // outcomes explicitly mean UsefulDesk never received a conclusive status.
  if (row.outcome === 'ambiguous') return UNKNOWN_OUTCOME_REASON;
  if (row.outcome === 'unconfirmed') return OLDER_STATUS_REASON;
  if (row.provider_error_title || row.provider_error_detail) {
    const providerDiagnostic = [
      row.provider_error_title,
      row.provider_error_detail,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (providerDiagnostic.includes('ecosystem engagement')) {
      return 'WhatsApp limited this reminder based on engagement. Open the chat before contacting the member another way.';
    }
    return DELIVERY_FAILURE_REASON;
  }
  if (row.reason_code && reasonLabels[row.reason_code])
    return reasonLabels[row.reason_code];
  if (row.escalation_state === 'created')
    return 'A staff follow-up was created because no reply was recorded. Open the member to review it.';
  if (row.escalation_state === 'existing')
    return 'A staff follow-up is already open. Open the member to review it.';
  if (row.escalation_state === 'owner_unavailable')
    return 'No available staff member could be assigned. Open the member to assign the follow-up.';
  if (row.escalation_state === 'replied')
    return 'The member replied, so no staff follow-up was created.';
  if (row.escalation_state === 'stopped')
    return 'The staff follow-up was closed because this message no longer applies.';
  switch (row.outcome) {
    case 'read':
      return 'The member read this WhatsApp message.';
    case 'delivered':
      return 'WhatsApp confirmed delivery.';
    case 'accepted':
      return 'WhatsApp accepted the message; delivery has not been confirmed.';
    case 'failed':
      return DELIVERY_FAILURE_REASON;
    case 'blocked':
      return 'This message needs setup or a member detail before it can send. Review the message and member.';
    case 'stopped':
      return 'This message no longer applies to this member.';
    case 'attempting':
      return 'UsefulDesk is sending this message.';
    case 'waiting':
      return 'Waiting until the scheduled sending time.';
    case 'paused':
      return 'Paused until the current hold or payment promise is resolved.';
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
