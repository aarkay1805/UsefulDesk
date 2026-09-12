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
  label: 'Catch-up days',
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
    id: 'membership_renewal',
    group: 'renewals',
    title: 'Membership renewal',
    templateContracts: ['membership_renewal'],
    fields: [booleanField('enabled'), reminderDays('days_before')],
    configurable: true,
  },
  {
    id: 'service_renewal',
    group: 'renewals',
    title: 'Service renewal',
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
    title: 'Invoice collection',
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
        'Send window start'
      ),
      sendHour(
        'sendWindowEnd',
        'invoice_collection_send_window_end',
        'Send window end'
      ),
    ],
    configurable: true,
  },
  {
    id: 'joining_installments',
    group: 'collections',
    title: 'Joining installments',
    templateContracts: ['installment_reminder'],
    fields: [],
    configurable: false,
  },
  {
    id: 'promise_to_pay',
    group: 'collections',
    title: 'Promise to pay',
    templateContracts: ['payment_promise_reminder'],
    fields: [booleanField('promise_to_pay_reminders_enabled')],
    configurable: true,
  },
  {
    id: 'payment_link_follow_up',
    group: 'collections',
    title: 'Payment link follow-up',
    templateContracts: ['payment_link'],
    fields: [booleanField('payment_link_follow_up_enabled')],
    configurable: true,
  },
  {
    id: 'autopay_recovery',
    group: 'collections',
    title: 'AutoPay recovery',
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
    templateContracts: ['session_pack_low', 'session_pack_exhausted'],
    fields: [booleanField('session_pack_reminders_enabled')],
    configurable: true,
  },
  {
    id: 'freeze_return',
    group: 'retention',
    title: 'Planned return',
    templateContracts: ['freeze_return'],
    fields: [booleanField('freeze_return_reminders_enabled')],
    configurable: true,
  },
  {
    id: 'membership_win_back',
    group: 'retention',
    title: 'Membership win-back',
    templateContracts: ['membership_win_back'],
    fields: [booleanField('membership_win_back_enabled')],
    configurable: true,
  },
  {
    id: 'service_win_back',
    group: 'retention',
    title: 'Service win-back',
    templateContracts: ['service_win_back'],
    fields: [booleanField('service_win_back_enabled')],
    configurable: true,
  },
  {
    id: 'payment_confirmation',
    group: 'confirmations',
    title: 'Payment confirmation',
    templateContracts: ['payment_confirmation'],
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
