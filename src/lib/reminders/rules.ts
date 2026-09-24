import {
  TEMPLATE_CONTRACTS,
  type TemplateContractId,
} from '@/lib/whatsapp/template-contracts';

export const REMINDER_RULE_GROUPS = [
  'renewals',
  'collections',
  'retention',
  'confirmations',
] as const;

export type ReminderRuleGroup = (typeof REMINDER_RULE_GROUPS)[number];

/** Owner-facing group names: the Rules section headings and the Activity
 *  rule filter's option groups. */
export const REMINDER_RULE_GROUP_LABELS: Record<ReminderRuleGroup, string> = {
  renewals: 'Renewals',
  collections: 'Payment reminders',
  retention: 'Keep members coming back',
  confirmations: 'Confirmations',
};

export type ReminderScheduleCapability =
  | 'editable-date-offsets'
  | 'fixed-date-offsets'
  | 'session-count'
  | 'event-driven'
  | 'checkout-managed';

export type ReminderRuleSchedule = {
  capability: ReminderScheduleCapability;
  /** Fallback and fixed timing copy. Editable schedules replace this with the
   * saved day selection in the settings UI. */
  timing: string;
  explanation: string;
  anchorNote?: string;
};

export type ReminderRuleField = {
  key: string;
  column: string;
  label: string;
  type: 'boolean' | 'integer' | 'integer-array';
  defaultValue: boolean | number | readonly number[];
  min?: number;
  max?: number;
  maxItems?: number;
};

export type ReminderRule = {
  id: ReminderRuleId;
  group: ReminderRuleGroup;
  title: string;
  purpose: string;
  schedule: ReminderRuleSchedule;
  eligibility: string;
  stops: string;
  staff: string;
  templateContracts: readonly TemplateContractId[];
  fields: readonly ReminderRuleField[];
  /** The worker has no account-level switch yet, so do not present a fake one. */
  configurable: boolean;
};

type ReminderRuleDefinition = Omit<ReminderRule, 'id'> & { id: string };

const booleanField = (column: string): ReminderRuleField => ({
  key: 'enabled',
  column,
  label: 'Enabled',
  type: 'boolean',
  defaultValue: false,
});

const reminderDays = (column: string): ReminderRuleField => ({
  key: 'daysBefore',
  column,
  label: 'Days before',
  type: 'integer-array',
  defaultValue: [7, 3, 1],
  min: 0,
  max: 365,
  maxItems: 6,
});

const catchUpDays = (column: string): ReminderRuleField => ({
  key: 'catchUpDays',
  column,
  label: 'Days to send late messages',
  type: 'integer',
  defaultValue: 2,
  min: 0,
  max: 14,
});

const sendHour = (
  key: string,
  column: string,
  label: string
): ReminderRuleField => ({
  key,
  column,
  label,
  type: 'integer',
  defaultValue: key === 'sendWindowStart' ? 9 : 19,
  min: 0,
  max: 23,
});

const invoiceDays = (
  key: string,
  column: string,
  defaultValue: number[]
): ReminderRuleField => ({
  key,
  column,
  label: key === 'beforeDueDays' ? 'Days before due' : 'Days overdue',
  type: 'integer-array',
  defaultValue,
  min: 0,
  max: 365,
  maxItems: 6,
});

export const REMINDER_RULES = [
  {
    id: 'attendance_streak',
    group: 'retention',
    title: 'Missed gym visits',
    purpose:
      'Checks in after six days without a visit, then once more six days after the first message.',
    schedule: {
      capability: 'event-driven',
      timing:
        'On day six, then once more six days after the first send. One hour after assigned arrival, or 30 minutes before sending hours end.',
      explanation:
        'A new membership starts the count. Each check-in resets it. Members already away when this is enabled can receive a message on the next eligible day.',
    },
    eligibility:
      'Active members with a phone number and at least six consecutive account-local days without a check-in.',
    stops:
      'After two messages, a check-in, a member reply, an inactive membership, or this message being turned off.',
    staff:
      'After the second message, the branch owner gets a follow-up due the next day if the member has not visited or replied.',
    templateContracts: ['attendance_streak'],
    fields: [booleanField('attendance_streak_enabled')],
    configurable: true,
  },
  {
    id: 'membership_renewal',
    group: 'renewals',
    title: 'Membership renewal',
    purpose: 'Reminds members before their current membership ends.',
    schedule: {
      capability: 'editable-date-offsets',
      timing: 'Before the membership ends.',
      explanation: 'Choose when to send the reminder.',
    },
    eligibility:
      'Members with a phone number whose active membership is ending soon and who pay without AutoPay.',
    stops: 'The member renews, cancels, or changes the membership end date.',
    staff: 'Reply to members who ask about renewing.',
    templateContracts: ['membership_renewal'],
    fields: [booleanField('enabled'), reminderDays('days_before')],
    configurable: true,
  },
  {
    id: 'service_renewal',
    group: 'renewals',
    title: 'Service renewal',
    purpose:
      'Reminds members before a paid service, such as personal training, ends.',
    schedule: {
      capability: 'editable-date-offsets',
      timing: 'Before the service ends.',
      explanation: 'Choose when to send the reminder.',
    },
    eligibility:
      'Members with a phone number and a paid service ending soon, if a current price is set.',
    stops:
      'The service is renewed, cancelled, removed from sale, or its end date changes.',
    staff: 'Reply to questions about renewing and the price.',
    templateContracts: ['service_renewal'],
    fields: [
      booleanField('service_enabled'),
      reminderDays('service_days_before'),
    ],
    configurable: true,
  },
  {
    id: 'membership_post_expiry',
    group: 'renewals',
    title: 'Expired membership follow-up',
    purpose: 'Follows up after a membership ends without being renewed.',
    schedule: {
      capability: 'fixed-date-offsets',
      timing: '1, 3 and 7 days after membership expiry.',
      explanation: 'These days cannot be changed.',
    },
    eligibility:
      'Members whose membership has ended and has not changed since.',
    stops:
      'The member renews, puts renewal on hold, pauses, starts another membership, or replies.',
    staff:
      'If the member does not reply, UsefulDesk adds a follow-up for the branch owner after WhatsApp accepts the last message. If a follow-up is already open, it uses that one.',
    templateContracts: ['membership_post_expiry'],
    fields: [
      booleanField('membership_post_expiry_enabled'),
      catchUpDays('membership_post_expiry_catch_up_days'),
    ],
    configurable: true,
  },
  {
    id: 'service_post_expiry',
    group: 'renewals',
    title: 'Expired service follow-up',
    purpose: 'Follows up after a paid service ends without being renewed.',
    schedule: {
      capability: 'fixed-date-offsets',
      timing: '1, 3 and 7 days after service expiry.',
      explanation: 'These days cannot be changed.',
    },
    eligibility:
      'Members whose paid service has ended and has not changed since.',
    stops:
      'The member renews, puts renewal on hold, buys another service, or replies.',
    staff:
      'If the member does not reply, UsefulDesk adds a follow-up for the branch owner after WhatsApp accepts the last message. If a follow-up is already open, it uses that one.',
    templateContracts: ['service_post_expiry'],
    fields: [
      booleanField('service_post_expiry_enabled'),
      catchUpDays('service_post_expiry_catch_up_days'),
    ],
    configurable: true,
  },
  {
    id: 'invoice_collection',
    group: 'collections',
    title: 'Unpaid invoice reminders',
    purpose:
      'Reminds members about an unpaid invoice before and after its due date.',
    schedule: {
      capability: 'editable-date-offsets',
      timing: 'Before, on, and after the invoice due date.',
      explanation: 'Choose when to send the reminder.',
      anchorNote:
        'If an invoice has no due date, UsefulDesk uses the day it was created. It cannot send a reminder for an earlier day.',
    },
    eligibility:
      'Members with a phone number who still owe money on an invoice.',
    stops:
      'The invoice is paid, cancelled, or its amount due or due date changes.',
    staff:
      'Answer payment questions. Record payments received outside UsefulDesk.',
    templateContracts: ['invoice_due', 'invoice_overdue'],
    fields: [
      booleanField('invoice_collection_enabled'),
      invoiceDays(
        'beforeDueDays',
        'invoice_collection_before_due_days',
        [3, 1, 0]
      ),
      invoiceDays(
        'overdueDays',
        'invoice_collection_overdue_days',
        [1, 3, 7, 14]
      ),
      catchUpDays('invoice_collection_catch_up_days'),
      sendHour(
        'sendWindowStart',
        'invoice_collection_send_window_start',
        'Start sending at'
      ),
      sendHour(
        'sendWindowEnd',
        'invoice_collection_send_window_end',
        'Stop sending after'
      ),
    ],
    configurable: true,
  },
  {
    id: 'joining_installments',
    group: 'collections',
    title: 'Installment reminders',
    purpose: 'Reminds members when part of their joining payment is due.',
    schedule: {
      capability: 'checkout-managed',
      timing:
        '7, 3 and 1 days before each installment is due, and again on the due date.',
      explanation:
        'These days cannot be changed. Each due date comes from the member’s joining payment plan.',
    },
    eligibility:
      'Members with a phone number who still owe part of their joining payment.',
    stops: 'The payment is made, cancelled, or rescheduled.',
    staff: 'Follow up if payment is late. Record it when it arrives.',
    templateContracts: ['installment_reminder'],
    fields: [],
    configurable: false,
  },
  {
    id: 'promise_to_pay',
    group: 'collections',
    title: 'Promised payment reminder',
    purpose: 'Reminds members about the date they promised to pay.',
    schedule: {
      capability: 'fixed-date-offsets',
      timing: '1 day before, on, and 1 day after the promised payment date.',
      explanation: 'These days cannot be changed.',
    },
    eligibility:
      'Members with a phone number and an open promise to pay on a set date.',
    stops: 'The member pays, cancels the promise, or changes the date.',
    staff: 'Contact members whose promised date has passed without payment.',
    templateContracts: ['payment_promise_upcoming', 'payment_promise_missed'],
    fields: [booleanField('promise_to_pay_reminders_enabled')],
    configurable: true,
  },
  {
    id: 'payment_link_follow_up',
    group: 'collections',
    title: 'Payment link follow-up',
    purpose:
      'Follows up after a payment link is sent but payment is not complete.',
    schedule: {
      capability: 'fixed-date-offsets',
      timing: '1 and 3 days after WhatsApp accepts the payment-link message.',
      explanation: 'These days cannot be changed.',
    },
    eligibility:
      'Members with a phone number and an active payment link that is still unpaid.',
    stops: 'The link is paid, expires, is cancelled, or is replaced.',
    staff: 'Help with failed payment attempts or send a new link when needed.',
    templateContracts: ['payment_link'],
    fields: [booleanField('payment_link_follow_up_enabled')],
    configurable: true,
  },
  {
    id: 'autopay_recovery',
    group: 'collections',
    title: 'AutoPay payment problems',
    purpose: 'Tells members when AutoPay will try again or has stopped trying.',
    schedule: {
      capability: 'event-driven',
      timing: 'After Razorpay records a retry or final failure.',
      explanation:
        'UsefulDesk sends this when Razorpay reports the payment result, not on a day schedule.',
    },
    eligibility:
      'Members with a phone number whose AutoPay payment will be tried again or has finally failed.',
    stops:
      'The payment succeeds, AutoPay is ready to collect again, or Razorpay reports a different result.',
    staff:
      'Review final failures and help the member choose the next payment step.',
    templateContracts: [
      'autopay_recovery_pending',
      'autopay_recovery_terminal',
    ],
    fields: [booleanField('autopay_recovery_enabled')],
    configurable: true,
  },
  {
    id: 'session_pack',
    group: 'retention',
    title: 'Session pack reminders',
    purpose:
      'Warns members when only a few sessions remain or their pack is empty.',
    schedule: {
      capability: 'session-count',
      timing: 'At 2 or fewer sessions remaining, and again at 0.',
      explanation:
        'This message sends when the member has few sessions left, regardless of the date.',
    },
    eligibility:
      'Members with an active session pack and 2 or fewer sessions left.',
    stops: 'The member buys a new pack or their remaining sessions change.',
    staff: 'Reply with suitable pack options when the member asks.',
    templateContracts: ['session_pack_low', 'session_pack_exhausted'],
    fields: [booleanField('session_pack_reminders_enabled')],
    configurable: true,
  },
  {
    id: 'freeze_return',
    group: 'retention',
    title: 'Return after a membership pause',
    purpose:
      'Reminds members before they plan to return from a paused membership.',
    schedule: {
      capability: 'fixed-date-offsets',
      timing:
        '1 day before the planned return; staff follow-up is due on the return day.',
      explanation: 'This day cannot be changed.',
    },
    eligibility:
      'Members whose membership is paused and whose planned return date has not changed.',
    stops:
      'The member returns, the planned date changes, or the membership is cancelled.',
    staff: 'Confirm the member’s next step before the planned return.',
    templateContracts: ['freeze_return'],
    fields: [booleanField('freeze_return_reminders_enabled')],
    configurable: true,
  },
  {
    id: 'membership_win_back',
    group: 'retention',
    title: 'Invite expired members back',
    purpose:
      'Invites former members to renew after their membership has been expired for some time.',
    schedule: {
      capability: 'fixed-date-offsets',
      timing:
        '14, 30 and 60 days after expiry, after the first follow-ups end.',
      explanation: 'These days cannot be changed.',
    },
    eligibility:
      'Former members whose membership has ended and who have not renewed.',
    stops:
      'The member renews, starts another membership, puts renewal on hold or pause, promises to pay, or replies.',
    staff: 'Handle replies using the current membership price.',
    templateContracts: ['membership_win_back'],
    fields: [booleanField('membership_win_back_enabled')],
    configurable: true,
  },
  {
    id: 'service_win_back',
    group: 'retention',
    title: 'Invite members to renew a service',
    purpose:
      'Invites members to buy a paid service again after it has been expired for some time.',
    schedule: {
      capability: 'fixed-date-offsets',
      timing:
        '14, 30 and 60 days after expiry, after the first follow-ups end.',
      explanation: 'These days cannot be changed.',
    },
    eligibility:
      'Members whose paid service has ended and has a current price set.',
    stops:
      'The member renews, starts another service, puts renewal on hold, promises to pay, or replies.',
    staff: 'Handle replies using the current service price.',
    templateContracts: ['service_win_back'],
    fields: [booleanField('service_win_back_enabled')],
    configurable: true,
  },
  {
    id: 'payment_confirmation',
    group: 'confirmations',
    title: 'Payment confirmation',
    purpose: 'Sends a receipt after a payment is recorded as complete.',
    schedule: {
      capability: 'event-driven',
      timing: 'After a new completed payment is recorded.',
      explanation:
        'This message sends after a new payment is recorded. It does not send for older payments.',
    },
    eligibility: 'Members with a newly completed payment and a phone number.',
    stops: 'The payment is reversed or no longer needs a receipt message.',
    staff: 'Answer receipt questions and check any reversed payments.',
    templateContracts: [
      'payment_confirmation',
      'payment_membership_renewal_confirmation',
    ],
    fields: [booleanField('payment_confirmations_enabled')],
    configurable: true,
  },
] as const satisfies readonly ReminderRuleDefinition[];

export type ReminderRuleId = (typeof REMINDER_RULES)[number]['id'];
export type ReminderRulePatch = Record<string, boolean | number | number[]>;
export type ReminderRuleSettings = Record<string, boolean | number | number[]>;
export type ReminderRuleReadiness = {
  ready: boolean;
  code: string;
  message?: string;
  templateContractId?: TemplateContractId;
};
export type ReminderRuleResponse = ReminderRule & {
  settings: ReminderRuleSettings;
  readiness: ReminderRuleReadiness;
};
export type ReminderSettingsResponse = {
  whatsappConnected: boolean;
  rules: ReminderRuleResponse[];
};

export function getReminderRule(ruleId: string): ReminderRule | null {
  return (
    (REMINDER_RULES as readonly ReminderRule[]).find(
      (rule) => rule.id === ruleId
    ) ?? null
  );
}

export function ruleSettingsFromRow(
  rule: ReminderRule,
  row: Record<string, unknown> | null | undefined
): ReminderRuleSettings {
  return Object.fromEntries(
    rule.fields.map((field) => [
      field.key,
      row?.[field.column] ?? field.defaultValue,
    ])
  ) as ReminderRuleSettings;
}

function normaliseIntegerArray(
  field: ReminderRuleField,
  value: unknown
): number[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > (field.maxItems ?? Infinity)
  )
    return null;
  const values = value.map((item) =>
    typeof item === 'number' ? item : Number.NaN
  );
  if (
    values.some(
      (item) =>
        !Number.isInteger(item) ||
        item < (field.min ?? -Infinity) ||
        item > (field.max ?? Infinity)
    )
  )
    return null;
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Parse only the fields owned by one rule. Unknown keys never reach PostgREST. */
export function parseReminderRulePatch(
  rule: ReminderRule,
  patch: unknown
):
  | { ok: true; value: Record<string, boolean | number | number[]> }
  | { ok: false; error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    return { ok: false, error: 'patch must be an object' };
  const input = patch as Record<string, unknown>;
  const fields = new Map(rule.fields.map((field) => [field.key, field]));
  const keys = Object.keys(input);
  if (keys.length === 0) return { ok: false, error: 'patch cannot be empty' };
  if (keys.some((key) => !fields.has(key)))
    return {
      ok: false,
      error: 'patch contains a field this rule does not own',
    };
  const value: Record<string, boolean | number | number[]> = {};
  for (const key of keys) {
    const field = fields.get(key)!;
    const raw = input[key];
    if (field.type === 'boolean') {
      if (typeof raw !== 'boolean')
        return { ok: false, error: `${key} must be a boolean` };
      value[field.column] = raw;
    } else if (field.type === 'integer') {
      if (
        typeof raw !== 'number' ||
        !Number.isInteger(raw) ||
        raw < (field.min ?? -Infinity) ||
        raw > (field.max ?? Infinity)
      )
        return { ok: false, error: `${key} is outside its allowed range` };
      value[field.column] = raw;
    } else {
      const normalised = normaliseIntegerArray(field, raw);
      if (!normalised)
        return {
          ok: false,
          error: `${key} must be a non-empty list of valid whole days`,
        };
      value[field.column] = normalised;
    }
  }
  const start = value.invoice_collection_send_window_start;
  const end = value.invoice_collection_send_window_end;
  if (typeof start === 'number' && typeof end === 'number' && start > end)
    return {
      ok: false,
      error: 'sendWindowStart cannot be after sendWindowEnd',
    };
  return { ok: true, value };
}

export function reminderTemplateNames(rule: ReminderRule): string[] {
  return rule.templateContracts.map(
    (contractId) => TEMPLATE_CONTRACTS[contractId].payload.name
  );
}
