// Pure engine for the four-step Members CSV import. The member-field
// registry owns the mapping vocabulary; this module owns resilient CSV
// coercion and row validation. Database writes stay in the dialog.

import {
  autoMapColumns,
  coerceCustomValue,
  customFieldId,
  IGNORE_KEY,
  validateMapping,
  type CustomFieldRef,
  type MappedCustomValue,
  type TargetField,
} from '@/lib/contacts/field-mapping';
import { normalizeKey } from '@/lib/contacts/dedupe';
import { parseTagCell } from '@/lib/contacts/parse-contact-csv';
import { normalizeSubmittedPhone } from '@/lib/leads/capture-form';
import {
  coerceAssignee,
  type DateOrder,
  type StaffRef,
} from '@/lib/leads/import-coerce';
import {
  MEMBER_IMPORT_FIELDS,
  type MemberImportFieldKey,
} from '@/lib/memberships/member-field-registry';
import {
  activeOptions,
  defaultOption,
  durationLabel,
  optionEndDate,
} from '@/lib/memberships/pricing';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';
import type { MembershipPlan, PaymentMethod, PlanPricingOption } from '@/types';

export const MEMBER_IGNORE_KEY = IGNORE_KEY;

export function buildMemberTargets(
  customFields: CustomFieldRef[]
): TargetField[] {
  return [
    ...MEMBER_IMPORT_FIELDS.map((item) => ({
      key: item.key,
      label: item.label,
      kind: item.kind,
      required: item.required ?? false,
      synonyms: item.synonyms,
    })),
    ...customFields.map((item) => ({
      key: `custom:${item.id}`,
      label: item.field_name,
      kind: 'custom' as const,
      required: false,
    })),
  ];
}

/** Intelligent, punctuation/case/camelCase-insensitive member header map. */
export function autoMapMemberColumns(
  headers: string[],
  customFields: CustomFieldRef[] = []
): string[] {
  return autoMapColumns(headers, buildMemberTargets(customFields));
}

export interface MemberMappingValidation {
  phoneMapped: boolean;
  planMapped: boolean;
  duplicateTargets: string[];
  ok: boolean;
}

export function validateMemberMapping(
  mapping: string[]
): MemberMappingValidation {
  const base = validateMapping(mapping);
  const planMapped = mapping.includes('plan');
  return {
    phoneMapped: base.phoneMapped,
    planMapped,
    duplicateTargets: base.duplicateTargets,
    ok: base.ok && planMapped,
  };
}

/** One CSV row after column mapping, before plan/staff/value resolution. */
export interface MemberImportRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  planName?: string;
  pricingOption?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  freezeDate?: string;
  assignedTo?: string;
  fee?: string;
  amountPaid?: string;
  feeStatus?: string;
  paymentMethod?: string;
  paidAt?: string;
  churnRisk?: string;
  dateOfBirth?: string;
  gender?: string;
  nickname?: string;
  height?: string;
  weight?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
  tagNames: string[];
  customValues: MappedCustomValue[];
}

export interface MemberMappingResult {
  rows: MemberImportRow[];
  skippedNoPhone: number;
  skippedInvalidPhone: number;
  skippedDuplicate: number;
  invalidCustomValues: number;
}

type MemberStringProp = Exclude<
  keyof MemberImportRow,
  'phone' | 'tagNames' | 'customValues'
>;

const ROW_PROP: Record<
  Exclude<MemberImportFieldKey, 'phone' | 'tags'>,
  MemberStringProp
> = {
  name: 'name',
  email: 'email',
  company: 'company',
  plan: 'planName',
  pricing_option: 'pricingOption',
  start_date: 'startDate',
  end_date: 'endDate',
  status: 'status',
  freeze_date: 'freezeDate',
  assigned_to: 'assignedTo',
  fee_amount: 'fee',
  amount_paid: 'amountPaid',
  fee_status: 'feeStatus',
  payment_method: 'paymentMethod',
  paid_at: 'paidAt',
  churn_risk: 'churnRisk',
  date_of_birth: 'dateOfBirth',
  gender: 'gender',
  nickname: 'nickname',
  height_cm: 'height',
  weight_kg: 'weight',
  address_line1: 'addressLine1',
  address_line2: 'addressLine2',
  city: 'city',
  state: 'state',
  postal_code: 'postalCode',
  country: 'country',
  notes: 'notes',
};

/**
 * Apply a mapping, qualify local phones with the account dial code, validate
 * typed custom values, and de-duplicate by the same normalized phone key the
 * database uses. This is deliberately tolerant of arbitrary column order.
 */
export function applyMemberMapping(
  rows: string[][],
  mapping: string[],
  options: {
    dialCode?: string;
    customFieldTypes?: Map<string, string>;
    dateOrder?: DateOrder;
  } = {}
): MemberMappingResult {
  const indexes = new Map<string, number[]>();
  mapping.forEach((key, index) => {
    if (key === MEMBER_IGNORE_KEY) return;
    indexes.set(key, [...(indexes.get(key) ?? []), index]);
  });

  const first = (row: string[], key: string): string =>
    (indexes.get(key) ?? []).map((index) => row[index]?.trim()).find(Boolean) ??
    '';

  const seen = new Set<string>();
  const output: MemberImportRow[] = [];
  let skippedNoPhone = 0;
  let skippedInvalidPhone = 0;
  let skippedDuplicate = 0;
  let invalidCustomValues = 0;

  for (const source of rows) {
    const rawPhone = first(source, 'phone');
    if (!rawPhone) {
      skippedNoPhone++;
      continue;
    }

    const phone =
      normalizeSubmittedPhone(rawPhone, options.dialCode ?? '') ??
      normalizeKey(rawPhone);
    if (!phone || !isValidE164(phone)) {
      skippedInvalidPhone++;
      continue;
    }
    const phoneKey = normalizeKey(phone);
    if (seen.has(phoneKey)) {
      skippedDuplicate++;
      continue;
    }
    seen.add(phoneKey);

    const mapped: MemberImportRow = {
      phone,
      tagNames: [],
      customValues: [],
    };
    for (const [key, prop] of Object.entries(ROW_PROP)) {
      const value = first(source, key);
      if (value) mapped[prop as MemberStringProp] = value;
    }

    for (const index of indexes.get('tags') ?? []) {
      for (const tag of parseTagCell(source[index])) mapped.tagNames.push(tag);
    }
    for (const [key, cols] of indexes) {
      const fieldId = customFieldId(key);
      if (!fieldId) continue;
      const rawValue = cols.map((index) => source[index]?.trim()).find(Boolean);
      if (!rawValue) continue;
      const value = coerceCustomValue(
        rawValue,
        options.customFieldTypes?.get(fieldId) ?? 'text',
        options.dateOrder
      );
      if (value === null) invalidCustomValues++;
      else mapped.customValues.push({ fieldId, value });
    }
    output.push(mapped);
  }

  return {
    rows: output,
    skippedNoPhone,
    skippedInvalidPhone,
    skippedDuplicate,
    invalidCustomValues,
  };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Parse ISO, numeric DMY/MDY, month-name dates, timestamps, YYYYMMDD, and
 * Excel serial dates without letting the runtime timezone move the day.
 */
export function parseImportDate(
  value: string,
  order: DateOrder = 'DMY'
): string | null {
  const input = value.trim();
  if (!input) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(input);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(input);
  if (compact) {
    return ymd(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  }

  // Excel's 1900 date system (including its historical leap-year bug) is
  // conventionally anchored at 1899-12-30.
  if (/^\d{4,5}(?:\.\d+)?$/.test(input)) {
    const serial = Number(input);
    if (serial >= 1 && serial <= 100_000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return ymd(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate()
      );
    }
  }

  const numeric = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[T\s].*)?$/.exec(
    input
  );
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    let day = order === 'DMY' ? a : b;
    let month = order === 'DMY' ? b : a;
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return ymd(year, month, day);
  }

  const dayName = /^(\d{1,2})\s+([a-z]+)[,\s]+(\d{2,4})$/i.exec(input);
  const nameDay = /^([a-z]+)\s+(\d{1,2})(?:,)?\s+(\d{2,4})$/i.exec(input);
  if (dayName || nameDay) {
    const monthName = (dayName?.[2] ?? nameDay?.[1] ?? '').toLowerCase();
    const month = MONTHS[monthName];
    const day = Number(dayName?.[1] ?? nameDay?.[2]);
    let year = Number(dayName?.[3] ?? nameDay?.[3]);
    if (year < 100) year += 2000;
    return month ? ymd(year, month, day) : null;
  }

  return null;
}

function ymd(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizedWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Exact first, then punctuation-insensitive, then one unambiguous plan-name
 * containment match (`Gold Monthly` → `Gold`). */
export function resolvePlan(
  planName: string,
  plans: MembershipPlan[]
): MembershipPlan | null {
  const query = normalizedWords(planName);
  if (!query) return null;
  const exact = plans.find((plan) => normalizedWords(plan.name) === query);
  if (exact) return exact;
  const compact = query.replace(/\s/g, '');
  const compactMatch = plans.filter(
    (plan) => normalizedWords(plan.name).replace(/\s/g, '') === compact
  );
  if (compactMatch.length === 1) return compactMatch[0];
  const contained = plans.filter((plan) => {
    const name = normalizedWords(plan.name);
    return name.length >= 3 && ` ${query} `.includes(` ${name} `);
  });
  return contained.length === 1 ? contained[0] : null;
}

function optionAliases(option: PlanPricingOption): string[] {
  const duration = durationLabel(option.duration_count, option.duration_unit);
  const aliases = [duration, duration.replace(/s$/, '')];
  if (option.duration_unit === 'month' && option.duration_count === 1) {
    aliases.push('monthly', 'month', 'per month');
  }
  if (option.duration_unit === 'month' && option.duration_count === 3) {
    aliases.push('quarterly', 'quarter', '3 months');
  }
  if (option.duration_unit === 'month' && option.duration_count === 6) {
    aliases.push('half yearly', 'half year', 'semi annual', '6 months');
  }
  if (option.duration_unit === 'year' && option.duration_count === 1) {
    aliases.push('annual', 'annually', 'yearly', 'year', '12 months');
  }
  if (option.duration_unit === 'week' && option.duration_count === 1) {
    aliases.push('weekly', 'week');
  }
  return aliases.map(normalizedWords);
}

export function resolvePricingOption(
  plan: MembershipPlan,
  rawOption: string,
  rawPlan = ''
): PlanPricingOption | null {
  const options = activeOptions(plan);
  if (options.length === 0) return null;
  const query = normalizedWords(rawOption || rawPlan);
  if (!query) return defaultOption(plan);
  const matches = options.filter((option) =>
    optionAliases(option).some(
      (alias) => query === alias || ` ${query} `.includes(` ${alias} `)
    )
  );
  return matches.length === 1 ? matches[0] : defaultOption(plan);
}

export function parseMoney(value: string): number | null {
  let input = value.trim();
  if (!input) return null;
  const negative = /^\(.*\)$/.test(input) || input.includes('-');
  input = input.replace(/[^0-9.,]/g, '');
  if (!input) return null;

  const lastDot = input.lastIndexOf('.');
  const lastComma = input.lastIndexOf(',');
  let normalized = input;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    normalized = input
      .replace(decimal === '.' ? /,/g : /\./g, '')
      .replace(decimal, '.');
  } else if (lastComma >= 0) {
    const decimals = input.length - lastComma - 1;
    normalized =
      decimals > 0 && decimals <= 2
        ? input.replace(/\./g, '').replace(',', '.')
        : input.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const groups = input.split('.');
    const thousands =
      groups.length > 1 && groups.slice(1).every((group) => group.length === 3);
    normalized = thousands ? groups.join('') : input;
  } else {
    normalized = input.replace(/,/g, '');
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || negative) return null;
  return number;
}

export function parseFeeStatus(value: string): 'paid' | 'due' {
  return /^(paid|yes|done|cleared|complete|completed|settled|received|y|true)$/i.test(
    value.trim()
  )
    ? 'paid'
    : 'due';
}

export function parsePaymentMethod(value: string): PaymentMethod {
  const key = normalizedWords(value);
  if (/cash/.test(key)) return 'cash';
  if (/upi|gpay|google pay|phonepe|paytm|bhim/.test(key)) return 'upi';
  if (/card|visa|mastercard|debit|credit/.test(key)) return 'card';
  if (/bank|transfer|neft|imps|rtgs|cheque|check/.test(key)) return 'bank';
  return 'other';
}

export function parseBoolean(value: string): boolean | null {
  const key = normalizedWords(value);
  if (!key) return null;
  if (/^(yes|y|true|1|high|at risk|risk)$/.test(key)) return true;
  if (/^(no|n|false|0|low|safe)$/.test(key)) return false;
  return null;
}

export type StoredImportStatus = 'active' | 'frozen' | 'cancelled';

export function parseMembershipStatus(value: string): {
  status: StoredImportStatus;
  matched: boolean;
  expired: boolean;
} {
  const key = normalizedWords(value);
  if (!key || /^(active|current|valid|live|enabled)$/.test(key)) {
    return { status: 'active', matched: true, expired: false };
  }
  if (/^(expired|lapsed|ended|overdue)$/.test(key)) {
    return { status: 'active', matched: true, expired: true };
  }
  if (/^(frozen|freeze|paused|pause|on hold|hold)$/.test(key)) {
    return { status: 'frozen', matched: true, expired: false };
  }
  if (/^(cancelled|canceled|inactive|terminated|closed)$/.test(key)) {
    return { status: 'cancelled', matched: true, expired: false };
  }
  return { status: 'active', matched: false, expired: false };
}

export function parseHeightCm(value: string): number | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  const feet =
    /^(\d{1,2})\s*(?:ft|feet|')\s*(\d{1,2})?\s*(?:in|inches|")?$/.exec(input);
  if (feet) {
    const cm = (Number(feet[1]) * 12 + Number(feet[2] ?? 0)) * 2.54;
    return Math.round(cm * 10) / 10;
  }
  const number = parseMoney(input);
  if (number === null) return null;
  if (/\bm\b|metre|meter/.test(input) && !/cm|centi/.test(input)) {
    return Math.round(number * 1000) / 10;
  }
  return number >= 50 && number <= 300 ? number : null;
}

export function parseWeightKg(value: string): number | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  const number = parseMoney(input);
  if (number === null) return null;
  const kg = /lb|pound/.test(input) ? number * 0.45359237 : number;
  return kg > 0 && kg <= 500 ? Math.round(kg * 10) / 10 : null;
}

export interface BuiltMembership {
  plan_id: string;
  pricing_option_id: string;
  start_date: string;
  end_date: string;
  status: StoredImportStatus;
  frozen_at: string | null;
  fee_amount: number;
  notes: string | null;
}

export interface BuiltPayment {
  amount: number;
  method: PaymentMethod;
  paidOn: string;
}

export type MemberRowError =
  | 'unknown-plan'
  | 'no-pricing'
  | 'bad-date'
  | 'bad-fee'
  | 'bad-payment'
  | 'payment-exceeds-fee'
  | 'unknown-status'
  | 'expired-needs-expiry';

export interface BuiltMemberRow {
  membership: BuiltMembership | null;
  payment: BuiltPayment | null;
  assignedTo: string | null;
  churnRisk: boolean | null;
  contact: {
    name: string | null;
    email: string | null;
    company: string | null;
    date_of_birth: string | null;
    gender: string | null;
    nickname: string | null;
    height_cm: number | null;
    weight_kg: number | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  errors: MemberRowError[];
  warnings: (
    'unknown-assignee' | 'unknown-churn-risk' | 'invalid-profile-value'
  )[];
}

/** Resolve one mapped row into contact, membership, and optional payment
 * payloads. `fee_status=paid` becomes a real ledger payment, never a forged
 * membership flag — the database remains authoritative. */
export function buildMembershipRow(
  row: MemberImportRow,
  plans: MembershipPlan[],
  order: DateOrder,
  today: string,
  staff: StaffRef[] = []
): BuiltMemberRow {
  const errors: MemberRowError[] = [];
  const warnings: BuiltMemberRow['warnings'] = [];
  const plan = resolvePlan(row.planName ?? '', plans);
  if (!plan) errors.push('unknown-plan');
  const pricing = plan
    ? resolvePricingOption(plan, row.pricingOption ?? '', row.planName)
    : null;
  if (plan && !pricing) errors.push('no-pricing');

  const start = row.startDate ? parseImportDate(row.startDate, order) : today;
  const explicitEnd = row.endDate ? parseImportDate(row.endDate, order) : null;
  const freezeDate = row.freezeDate
    ? parseImportDate(row.freezeDate, order)
    : null;
  const paidOn = row.paidAt ? parseImportDate(row.paidAt, order) : null;
  const birthday = row.dateOfBirth
    ? parseImportDate(row.dateOfBirth, order)
    : null;
  if (
    !start ||
    (row.endDate && !explicitEnd) ||
    (row.freezeDate && !freezeDate) ||
    (row.paidAt && !paidOn) ||
    (row.dateOfBirth && !birthday)
  ) {
    errors.push('bad-date');
  }

  const fee = row.fee ? parseMoney(row.fee) : null;
  if (row.fee && fee === null) errors.push('bad-fee');
  const feeAmount = fee ?? (pricing ? Number(pricing.price) : 0);

  let amountPaid = row.amountPaid ? parseMoney(row.amountPaid) : null;
  if (row.amountPaid && amountPaid === null) errors.push('bad-payment');
  if (amountPaid === null && parseFeeStatus(row.feeStatus ?? '') === 'paid') {
    amountPaid = feeAmount;
  }
  if ((amountPaid ?? 0) > feeAmount) errors.push('payment-exceeds-fee');

  const parsedStatus = parseMembershipStatus(row.status ?? '');
  if (!parsedStatus.matched) errors.push('unknown-status');
  const end =
    explicitEnd ?? (start && pricing ? optionEndDate(start, pricing) : null);
  if (parsedStatus.expired && end && end >= today) {
    errors.push('expired-needs-expiry');
  }

  let assignedTo: string | null = null;
  if (row.assignedTo?.trim()) {
    assignedTo = coerceAssignee(row.assignedTo, staff);
    if (!assignedTo) warnings.push('unknown-assignee');
  }

  const churnRisk = row.churnRisk ? parseBoolean(row.churnRisk) : null;
  if (row.churnRisk && churnRisk === null) warnings.push('unknown-churn-risk');

  const height = row.height ? parseHeightCm(row.height) : null;
  const weight = row.weight ? parseWeightKg(row.weight) : null;
  if ((row.height && height === null) || (row.weight && weight === null)) {
    warnings.push('invalid-profile-value');
  }

  const contact = {
    name: row.name?.trim() || null,
    email: row.email?.trim().toLowerCase() || null,
    company: row.company?.trim() || null,
    date_of_birth: birthday,
    gender: row.gender?.trim() || null,
    nickname: row.nickname?.trim() || null,
    height_cm: height,
    weight_kg: weight,
    address_line1: row.addressLine1?.trim() || null,
    address_line2: row.addressLine2?.trim() || null,
    city: row.city?.trim() || null,
    state: row.state?.trim() || null,
    postal_code: row.postalCode?.trim() || null,
    country: row.country?.trim() || null,
  };

  if (errors.length > 0 || !plan || !pricing || !start || !end) {
    return {
      membership: null,
      payment: null,
      assignedTo,
      churnRisk,
      contact,
      errors,
      warnings,
    };
  }

  return {
    membership: {
      plan_id: plan.id,
      pricing_option_id: pricing.id,
      start_date: start,
      end_date: end,
      status: parsedStatus.status,
      frozen_at:
        parsedStatus.status === 'frozen' ? (freezeDate ?? today) : null,
      fee_amount: feeAmount,
      notes: row.notes?.trim() || null,
    },
    payment:
      amountPaid && amountPaid > 0
        ? {
            amount: amountPaid,
            method: parsePaymentMethod(row.paymentMethod ?? ''),
            paidOn: paidOn ?? start,
          }
        : null,
    assignedTo,
    churnRisk,
    contact,
    errors,
    warnings,
  };
}

/** Sample offered on Upload. It intentionally demonstrates broad migration
 * coverage while keeping every column optional except Phone and Plan. */
export const MEMBER_TEMPLATE_CSV = [
  'Name,Phone,Email,Plan,Billing option,Start date,Expiry,Status,Fee,Amount paid,Payment method,Payment date,Assigned to,Churn risk,Birthday,Gender,Height,Weight,City,State,Postal code,Notes,Tags',
  'Asha Rao,+91 98765 43210,asha@example.com,Gold,Monthly,01/07/2026,,Active,"₹1,500","₹1,500",UPI,01/07/2026,Aakash,No,14/08/1993,Female,165 cm,58 kg,Pune,Maharashtra,411001,"Prefers morning classes","VIP, Morning"',
  'Vikram Shah,+91 91234 56780,,Quarterly,,15 Jun 2026,14 Sep 2026,Active,4000,2000,Cash,15/06/2026,,Yes,22/02/1988,Male,"5\'10""",176 lb,Mumbai,Maharashtra,400001,"Old ID: GYM-204",At risk',
].join('\n');
