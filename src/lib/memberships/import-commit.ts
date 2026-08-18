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
import { addDuration } from '@/lib/memberships/expiry';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';
import type { MembershipPlan, PaymentMethod, PlanPricingOption } from '@/types';
import type { MemberImportCandidate } from './member-import-candidates';

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

/**
 * Header normalization strips punctuation, so "Discount %" and "Discount"
 * collapse to the same token and a percentage column would claim the flat
 * amount target. Disambiguate before matching rather than after, so the
 * mapper's one-target-per-column bookkeeping stays correct.
 */
const PERCENT_MARK = /%|\bpercent\b|\bpct\b/i;
const DISCOUNT_WORD = /discount|concession|rebate/i;

/** Intelligent, punctuation/case/camelCase-insensitive member header map. */
export function autoMapMemberColumns(
  headers: string[],
  customFields: CustomFieldRef[] = []
): string[] {
  const disambiguated = headers.map((header) =>
    PERCENT_MARK.test(header) && DISCOUNT_WORD.test(header)
      ? `${header} percent`
      : header
  );
  const mapped = autoMapColumns(
    disambiguated,
    buildMemberTargets(customFields)
  );
  return headers.map((header, index) => {
    const normalized = header
      .trim()
      .toLowerCase()
      .replace(/[_./-]+/g, ' ')
      .replace(/\s+/g, ' ');
    if (normalized === 'package' || normalized === 'offering') {
      return 'offering';
    }
    if (
      normalized === 'membership plan' ||
      normalized === 'membership package'
    ) {
      return 'membership_plan';
    }
    if (normalized === 'service' || normalized === 'service name') {
      return 'service';
    }
    return mapped[index];
  });
}

export interface MemberMappingValidation {
  phoneMapped: boolean;
  planMapped: boolean;
  offeringMapped: boolean;
  duplicateTargets: string[];
  ok: boolean;
}

export function validateMemberMapping(
  mapping: string[]
): MemberMappingValidation {
  const base = validateMapping(mapping);
  const planMapped = mapping.some((key) =>
    ['plan', 'membership_plan', 'offering', 'service'].includes(key)
  );
  return {
    phoneMapped: base.phoneMapped,
    planMapped,
    offeringMapped: planMapped,
    duplicateTargets: base.duplicateTargets,
    ok: base.ok && planMapped,
  };
}

/** One CSV row after column mapping, before plan/staff/value resolution. */
export interface MemberImportRow {
  sourceRowIndex?: number;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  offering?: string;
  planName?: string;
  pricingOption?: string;
  membershipTrainer?: string;
  listPrice?: string;
  discountAmount?: string;
  discountPercent?: string;
  serviceName?: string;
  serviceOption?: string;
  serviceTrainer?: string;
  serviceStart?: string;
  serviceEnd?: string;
  serviceListPrice?: string;
  serviceDiscountAmount?: string;
  serviceDiscountPercent?: string;
  serviceSoldPrice?: string;
  serviceStatus?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  freezeDate?: string;
  assignedTo?: string;
  fee?: string;
  amountPaid?: string;
  amountDue?: string;
  feeStatus?: string;
  paymentMethod?: string;
  paidAt?: string;
  churnRisk?: string;
  legacyMemberId?: string;
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

export interface PreservedMemberMappingResult {
  rows: MemberImportRow[];
  invalidCustomValues: number;
}

type MemberStringProp = Exclude<
  keyof MemberImportRow,
  'sourceRowIndex' | 'phone' | 'tagNames' | 'customValues'
>;

const ROW_PROP: Record<
  Exclude<MemberImportFieldKey, 'phone' | 'tags'>,
  MemberStringProp
> = {
  name: 'name',
  email: 'email',
  company: 'company',
  offering: 'offering',
  membership_plan: 'planName',
  membership_option: 'pricingOption',
  membership_trainer: 'membershipTrainer',
  membership_list_price: 'listPrice',
  membership_discount_amount: 'discountAmount',
  membership_discount_percent: 'discountPercent',
  service: 'serviceName',
  service_option: 'serviceOption',
  service_trainer: 'serviceTrainer',
  service_start: 'serviceStart',
  service_end: 'serviceEnd',
  service_list_price: 'serviceListPrice',
  service_discount_amount: 'serviceDiscountAmount',
  service_discount_percent: 'serviceDiscountPercent',
  service_sold_price: 'serviceSoldPrice',
  service_status: 'serviceStatus',
  plan: 'planName',
  pricing_option: 'pricingOption',
  start_date: 'startDate',
  end_date: 'endDate',
  status: 'status',
  freeze_date: 'freezeDate',
  assigned_to: 'assignedTo',
  fee_amount: 'fee',
  amount_paid: 'amountPaid',
  amount_due: 'amountDue',
  fee_status: 'feeStatus',
  payment_method: 'paymentMethod',
  paid_at: 'paidAt',
  churn_risk: 'churnRisk',
  legacy_member_id: 'legacyMemberId',
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

  for (const [sourceRowIndex, source] of rows.entries()) {
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
      sourceRowIndex,
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

/**
 * Apply the configured fields without filtering or de-duplicating source
 * rows. Validation belongs to the candidate state machine, which must retain
 * every original row so reviewers can repair or explicitly exclude it.
 */
export function applyMemberMappingPreservingRows(
  rows: string[][],
  mapping: string[],
  options: {
    dialCode?: string;
    customFieldTypes?: Map<string, string>;
    dateOrder?: DateOrder;
  } = {}
): PreservedMemberMappingResult {
  const indexes = new Map<string, number[]>();
  mapping.forEach((key, index) => {
    if (key === MEMBER_IGNORE_KEY) return;
    indexes.set(key, [...(indexes.get(key) ?? []), index]);
  });
  const first = (row: string[], key: string): string =>
    (indexes.get(key) ?? []).map((index) => row[index]?.trim()).find(Boolean) ??
    '';
  let invalidCustomValues = 0;
  const output = rows.map((source, sourceRowIndex) => {
    const rawPhone = first(source, 'phone');
    const mapped: MemberImportRow = {
      sourceRowIndex,
      phone:
        normalizeSubmittedPhone(rawPhone, options.dialCode ?? '') ?? rawPhone,
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
    return mapped;
  });
  return { rows: output, invalidCustomValues };
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

  const dayName = /^(\d{1,2})(?:\s+|-)([a-z]+)(?:[,\s]+|-)(\d{2,4})$/i.exec(
    input
  );
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
  plans = plans.filter((plan) => plan.is_active !== false);
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
  if (/^(frozen|freezed|freeze|paused|pause|on hold|hold)$/.test(key)) {
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

/**
 * Money is compared and derived in integer paise. Postgres stores these as
 * exact NUMERIC and the discount CHECK constraints recompute
 * `ROUND(list * value / 100, 2)`, so float drift here would be rejected at
 * the database boundary rather than merely look untidy.
 */
const toPaise = (value: number): number => Math.round(value * 100);
const fromPaise = (paise: number): number => paise / 100;
/** Half-up, matching Postgres ROUND on positive NUMERIC. */
const percentPaise = (listPaise: number, hundredths: number): number =>
  Math.floor((listPaise * hundredths) / 10000 + 0.5);

export interface ImportedPricing {
  /** Price before any discount. Equals `charged` when nothing was given. */
  listPrice: number;
  discountType: 'amount' | 'percentage' | null;
  discountValue: number | null;
  discountAmount: number;
  /** What the customer was actually billed. */
  charged: number;
}

export type ImportedPricingError =
  | 'bad-list-price'
  | 'bad-discount'
  | 'bad-charged'
  | 'discount-exceeds-list'
  | 'pricing-mismatch';

/**
 * Solve `listPaise` so that a percentage discount reconciles to the charged
 * amount exactly. A percentage of an arbitrary price rarely lands on a whole
 * paise, so the list price is nudged until it does; a percentage that cannot
 * be expressed exactly returns null and the caller records a flat amount
 * instead. Money stays exact either way — only the label changes.
 */
function listFromChargedPercent(
  chargedPaise: number,
  hundredths: number
): number | null {
  if (hundredths >= 10000) return null;
  let listPaise = Math.round((chargedPaise * 10000) / (10000 - hundredths));
  for (let attempt = 0; attempt < 4; attempt++) {
    const discount = percentPaise(listPaise, hundredths);
    if (listPaise - discount === chargedPaise) return listPaise;
    listPaise = chargedPaise + discount;
  }
  return null;
}

/**
 * Resolve one purchase's list price, discount, and charged amount from
 * whichever columns a gym export happens to carry.
 *
 * List - discount = charged. Give any two and the third is derived; give all
 * three and they must reconcile. The common Indian-gym export supplies an
 * "actual" and a "discounted" column with no discount column at all, so the
 * discount is derived from that pair rather than being lost.
 */
export function resolveImportedPricing(input: {
  listPrice?: string;
  discountAmount?: string;
  discountPercent?: string;
  charged?: string;
  /** Configured plan/option price, used when the file omits the charge. */
  fallbackCharged?: number | null;
}): { pricing: ImportedPricing | null; errors: ImportedPricingError[] } {
  const errors: ImportedPricingError[] = [];
  const read = (
    raw: string | undefined,
    code: ImportedPricingError
  ): number | null => {
    if (!raw?.trim()) return null;
    const parsed = parseMoney(raw);
    if (parsed === null) {
      errors.push(code);
      return null;
    }
    return parsed;
  };

  const listGiven = read(input.listPrice, 'bad-list-price');
  const amountGiven = read(input.discountAmount, 'bad-discount');
  const percentGiven = read(input.discountPercent, 'bad-discount');
  const chargedGiven = read(input.charged, 'bad-charged');
  if (percentGiven !== null && (percentGiven <= 0 || percentGiven > 100)) {
    errors.push('bad-discount');
  }
  if (amountGiven !== null && percentGiven !== null) {
    errors.push('bad-discount');
  }
  if (errors.length > 0) return { pricing: null, errors };

  const chargedInput = chargedGiven ?? input.fallbackCharged ?? null;
  const chargedPaise = chargedInput === null ? null : toPaise(chargedInput);
  let listPaise = listGiven === null ? null : toPaise(listGiven);
  let discountType: ImportedPricing['discountType'] = null;
  let discountValue: number | null = null;
  let discountPaise = 0;

  if (percentGiven !== null) {
    const hundredths = Math.round(percentGiven * 100);
    if (listPaise === null && chargedPaise !== null) {
      listPaise = listFromChargedPercent(chargedPaise, hundredths);
    }
    if (listPaise === null) {
      // An inexact percentage: keep the money and record a flat discount.
      if (chargedPaise === null) return { pricing: null, errors };
      listPaise = Math.round((chargedPaise * 10000) / (10000 - hundredths));
      discountPaise = listPaise - chargedPaise;
      discountType = 'amount';
      discountValue = fromPaise(discountPaise);
    } else {
      discountPaise = percentPaise(listPaise, hundredths);
      discountType = 'percentage';
      discountValue = hundredths / 100;
    }
  } else if (amountGiven !== null) {
    discountPaise = toPaise(amountGiven);
    discountType = 'amount';
    discountValue = fromPaise(discountPaise);
    if (listPaise === null && chargedPaise !== null) {
      listPaise = chargedPaise + discountPaise;
    }
  } else if (
    listPaise !== null &&
    chargedPaise !== null &&
    listPaise > chargedPaise
  ) {
    // The "actual amount / discounted amount" pair every legacy gym export
    // carries. Without this the whole discount would vanish on import.
    discountPaise = listPaise - chargedPaise;
    discountType = 'amount';
    discountValue = fromPaise(discountPaise);
  }

  const finalChargedPaise =
    chargedPaise ?? (listPaise === null ? null : listPaise - discountPaise);
  if (finalChargedPaise === null) return { pricing: null, errors };
  if (finalChargedPaise < 0) errors.push('bad-charged');
  const finalListPaise = listPaise ?? finalChargedPaise + discountPaise;
  if (discountPaise > finalListPaise) errors.push('discount-exceeds-list');
  if (finalListPaise - discountPaise !== finalChargedPaise) {
    errors.push('pricing-mismatch');
  }
  if (errors.length > 0) return { pricing: null, errors };

  const discounted = discountPaise > 0;
  return {
    pricing: {
      listPrice: fromPaise(finalListPaise),
      discountType: discounted ? discountType : null,
      discountValue: discounted ? discountValue : null,
      discountAmount: fromPaise(discountPaise),
      charged: fromPaise(finalChargedPaise),
    },
    errors,
  };
}

/**
 * Resolve a source trainer cell against the active trainer roster, mirroring
 * `coerceAssignee`'s exact-then-unambiguous-prefix tiers. Unlike an assignee,
 * a trainer needs no login seat, so a small gym's "Mohit" resolves without
 * anyone being invited to the platform.
 */
export function coerceTrainer(
  raw: string,
  trainers: { id: string; display_name: string; is_active: boolean }[]
): string | null {
  const query = raw.trim().toLowerCase();
  if (!query) return null;
  const active = trainers.filter((trainer) => trainer.is_active);
  const exact = active.filter(
    (trainer) => trainer.display_name.trim().toLowerCase() === query
  );
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;
  const prefix = active.filter((trainer) => {
    const name = trainer.display_name.trim().toLowerCase();
    return name.startsWith(query) || name.split(/\s+/)[0] === query;
  });
  return prefix.length === 1 ? prefix[0].id : null;
}

export interface BuiltMembership {
  plan_id: string;
  pricing_option_id: string;
  start_date: string;
  end_date: string;
  status: StoredImportStatus;
  frozen_at: string | null;
  fee_amount: number;
  list_price: number;
  discount_type: 'amount' | 'percentage' | null;
  discount_value: number | null;
  discount_amount: number;
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
  | 'bad-discount'
  | 'pricing-mismatch'
  | 'expiry-not-after-start'
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
    trainer_id: string | null;
  };
  errors: MemberRowError[];
  warnings: (
    | 'unknown-assignee'
    | 'unknown-trainer'
    | 'unknown-churn-risk'
    | 'invalid-profile-value'
    | 'cancelled-dues-written-off'
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
  staff: StaffRef[] = [],
  trainers: { id: string; display_name: string; is_active: boolean }[] = []
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

  const resolvedPricing = resolveImportedPricing({
    listPrice: row.listPrice,
    discountAmount: row.discountAmount,
    discountPercent: row.discountPercent,
    charged: row.fee,
    fallbackCharged: pricing ? Number(pricing.price) : 0,
  });
  for (const code of resolvedPricing.errors) {
    if (code === 'pricing-mismatch' || code === 'discount-exceeds-list') {
      if (!errors.includes('pricing-mismatch')) errors.push('pricing-mismatch');
    } else if (code === 'bad-charged') {
      if (!errors.includes('bad-fee')) errors.push('bad-fee');
    } else if (!errors.includes('bad-discount')) {
      errors.push('bad-discount');
    }
  }
  const feeAmount = resolvedPricing.pricing?.charged ?? 0;

  let amountPaid = row.amountPaid ? parseMoney(row.amountPaid) : null;
  if (row.amountPaid && amountPaid === null) errors.push('bad-payment');
  if (amountPaid === null && parseFeeStatus(row.feeStatus ?? '') === 'paid') {
    amountPaid = feeAmount;
  }
  if ((amountPaid ?? 0) > feeAmount) errors.push('payment-exceeds-fee');

  const parsedStatus = parseMembershipStatus(row.status ?? '');
  if (!parsedStatus.matched) errors.push('unknown-status');
  // A cancelled membership has its current period voided by
  // `set_membership_cancellation`, so an unpaid balance is written off on
  // import. Right for a real cancellation, lossy for a migration — the row
  // still imports, but the write-off must never be silent. Compared in whole
  // paise so 2dp float drift cannot invent a balance.
  if (
    parsedStatus.status === 'cancelled' &&
    Math.round((feeAmount - (amountPaid ?? 0)) * 100) > 0
  ) {
    warnings.push('cancelled-dues-written-off');
  }
  const derivedEnd =
    explicitEnd ?? (start && pricing ? optionEndDate(start, pricing) : null);
  // A legacy per-session or day-pass row repeats one date in both columns:
  // the source has no way to say "one day", so this is a shape, not an error.
  // Import it as a one-day membership. When the plan term disagrees, the
  // existing expiry-duration-mismatch notice still surfaces it.
  const end =
    start && explicitEnd && explicitEnd === start
      ? addDuration(start, 1, 'day')
      : derivedEnd;
  // An expiry that genuinely precedes its start stays blocking, and mirrors
  // `perform_member_import_group`'s own guard: a customer group commits as
  // one transaction, so a row the preview calls ready but the database
  // rejects would abort every other row for that member.
  if (start && end && end <= start) {
    errors.push('expiry-not-after-start');
  }
  if (parsedStatus.expired && end && end >= today) {
    errors.push('expired-needs-expiry');
  }

  let assignedTo: string | null = null;
  if (row.assignedTo?.trim()) {
    assignedTo = coerceAssignee(row.assignedTo, staff);
    if (!assignedTo) warnings.push('unknown-assignee');
  }

  let trainerId: string | null = null;
  if (row.membershipTrainer?.trim()) {
    trainerId = coerceTrainer(row.membershipTrainer, trainers);
    if (!trainerId) warnings.push('unknown-trainer');
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
    trainer_id: trainerId,
  };

  if (
    errors.length > 0 ||
    !plan ||
    !pricing ||
    !start ||
    !end ||
    !resolvedPricing.pricing
  ) {
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
      list_price: resolvedPricing.pricing.listPrice,
      discount_type: resolvedPricing.pricing.discountType,
      discount_value: resolvedPricing.pricing.discountValue,
      discount_amount: resolvedPricing.pricing.discountAmount,
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

/**
 * The commit boundary receives candidates after a caller has resolved its
 * preview. Keeping that resolution explicit prevents a stale UI action from
 * silently importing rows the reviewer excluded or still needs to resolve.
 */
export type MemberImportCommitCandidate = MemberImportCandidate;

export type MemberImportDisposition =
  'imported' | 'partial' | 'failed' | 'excluded' | 'unresolved' | 'invalid';

export type MemberImportMemberOutcome =
  'created' | 'attached' | 'failed' | 'not-processed';

export type MemberImportPaymentOutcome =
  'recorded' | 'failed' | 'not-requested' | 'not-processed';

/** One durable-in-memory result per source row, including rows never written. */
export interface MemberImportCommitResult {
  sourceRowIndex: number;
  disposition: MemberImportDisposition;
  memberOutcome: MemberImportMemberOutcome;
  paymentOutcome: MemberImportPaymentOutcome;
  reason: string | null;
  contactId: string | null;
  membershipId: string | null;
}

/**
 * Database work is injected so callers can retain their existing persistence
 * and tenancy checks while this engine owns candidate gating and outcome
 * accounting. Existing contacts are attached before their membership is made.
 */
export interface MemberImportCommitExecutor {
  createContact?: (
    candidate: MemberImportCommitCandidate
  ) => Promise<{ contactId: string }>;
  attachExistingContact?: (
    contactId: string,
    candidate: MemberImportCommitCandidate
  ) => Promise<void>;
  createMembership: (
    candidate: MemberImportCommitCandidate,
    contactId: string
  ) => Promise<{ membershipId: string }>;
  recordPayment?: (
    candidate: MemberImportCommitCandidate,
    membershipId: string
  ) => Promise<void>;
}

function errorReason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function skippedCommitResult(
  candidate: MemberImportCommitCandidate,
  disposition: 'excluded' | 'unresolved' | 'invalid',
  reason: string
): MemberImportCommitResult {
  return {
    sourceRowIndex: candidate.sourceRow,
    disposition,
    memberOutcome: 'not-processed',
    paymentOutcome: 'not-processed',
    reason,
    contactId: null,
    membershipId: null,
  };
}

/**
 * Commit only reviewer-included, fully resolved candidates. The returned list
 * deliberately retains every input candidate so a receipt can explain rows
 * which were excluded, unresolved, invalid, or only partially persisted.
 */
export async function commitMemberImportCandidates(
  candidates: MemberImportCommitCandidate[],
  executor: MemberImportCommitExecutor
): Promise<MemberImportCommitResult[]> {
  const results: MemberImportCommitResult[] = [];

  for (const candidate of candidates) {
    if (candidate.disposition !== 'included') {
      results.push(
        skippedCommitResult(candidate, 'excluded', 'candidate-excluded')
      );
      continue;
    }
    if (!candidate.isReady) {
      results.push(
        skippedCommitResult(candidate, 'unresolved', 'candidate-unresolved')
      );
      continue;
    }
    if (!candidate.built.membership || candidate.built.errors.length > 0) {
      results.push(
        skippedCommitResult(candidate, 'invalid', 'candidate-not-ready')
      );
      continue;
    }

    const existingContactId = candidate.existingMatch?.contactId.trim() || null;
    let contactId: string;
    let memberOutcome: MemberImportMemberOutcome;
    try {
      if (existingContactId) {
        await executor.attachExistingContact?.(existingContactId, candidate);
        contactId = existingContactId;
        memberOutcome = 'attached';
      } else {
        if (!executor.createContact) {
          throw new Error('contact executor unavailable');
        }
        contactId = (await executor.createContact(candidate)).contactId;
        if (!contactId) throw new Error('contact creation returned no id');
        memberOutcome = 'created';
      }
    } catch (error) {
      results.push({
        sourceRowIndex: candidate.sourceRow,
        disposition: 'failed',
        memberOutcome: 'failed',
        paymentOutcome: 'not-processed',
        reason: errorReason(error, 'contact import failed'),
        contactId: null,
        membershipId: null,
      });
      continue;
    }

    let membershipId: string;
    try {
      membershipId = (await executor.createMembership(candidate, contactId))
        .membershipId;
      if (!membershipId) throw new Error('membership creation returned no id');
    } catch (error) {
      results.push({
        sourceRowIndex: candidate.sourceRow,
        disposition: 'failed',
        memberOutcome: 'failed',
        paymentOutcome: 'not-processed',
        reason: errorReason(error, 'membership import failed'),
        contactId,
        membershipId: null,
      });
      continue;
    }

    if (!candidate.built.payment) {
      results.push({
        sourceRowIndex: candidate.sourceRow,
        disposition: 'imported',
        memberOutcome,
        paymentOutcome: 'not-requested',
        reason:
          candidate.resolutions.payment === 'member_only'
            ? 'member-only-import'
            : 'no-payment-supplied',
        contactId,
        membershipId,
      });
      continue;
    }

    try {
      if (!executor.recordPayment)
        throw new Error('payment executor unavailable');
      await executor.recordPayment(candidate, membershipId);
      results.push({
        sourceRowIndex: candidate.sourceRow,
        disposition: 'imported',
        memberOutcome,
        paymentOutcome: 'recorded',
        reason: null,
        contactId,
        membershipId,
      });
    } catch (error) {
      results.push({
        sourceRowIndex: candidate.sourceRow,
        disposition: 'partial',
        memberOutcome,
        paymentOutcome: 'failed',
        reason: errorReason(error, 'payment import failed'),
        contactId,
        membershipId,
      });
    }
  }

  return results;
}

export interface MemberImportReceiptRow {
  source_row: number;
  legacy_id: string;
  phone_suffix: string;
  outcome_type: string;
  offering_name: string;
  disposition: MemberImportDisposition;
  customer_outcome: MemberImportMemberOutcome;
  membership_outcome: string;
  service_outcome: string;
  invoice_outcome: string;
  member_outcome: MemberImportMemberOutcome;
  payment_outcome: MemberImportPaymentOutcome;
  reason: string;
}

function phoneSuffix(phone: string): string {
  return phone.replace(/\D/g, '').slice(-4);
}

function receiptFallback(
  candidate: MemberImportCommitCandidate
): Pick<
  MemberImportCommitResult,
  'disposition' | 'memberOutcome' | 'paymentOutcome' | 'reason'
> {
  if (candidate.disposition !== 'included') {
    return {
      disposition: 'excluded',
      memberOutcome: 'not-processed',
      paymentOutcome: 'not-processed',
      reason: 'candidate-excluded',
    };
  }
  if (!candidate.isReady) {
    return {
      disposition: 'unresolved',
      memberOutcome: 'not-processed',
      paymentOutcome: 'not-processed',
      reason: 'candidate-unresolved',
    };
  }
  return {
    disposition: 'invalid',
    memberOutcome: 'not-processed',
    paymentOutcome: 'not-processed',
    reason: 'candidate-not-committed',
  };
}

/**
 * Build a privacy-safe, deterministic receipt from the complete candidate
 * set. It never emits a full phone number, contact ID, or membership ID.
 */
export function buildMemberImportReceiptRows(
  candidates: MemberImportCommitCandidate[],
  results: MemberImportCommitResult[]
): MemberImportReceiptRow[] {
  const resultBySourceRow = new Map(
    results.map((result) => [result.sourceRowIndex, result])
  );

  return candidates
    .map((candidate, originalIndex) => ({ candidate, originalIndex }))
    .sort(
      (left, right) =>
        left.candidate.sourceRow - right.candidate.sourceRow ||
        left.originalIndex - right.originalIndex
    )
    .map(({ candidate }) => {
      const result = resultBySourceRow.get(candidate.sourceRow);
      const fallback = receiptFallback(candidate);
      return {
        source_row: candidate.sourceRow,
        legacy_id: candidate.legacyMemberId?.trim() ?? '',
        phone_suffix: phoneSuffix(candidate.draftValues.phone),
        outcome_type: candidate.outcomeKind.replace('_', ' + '),
        offering_name: [
          candidate.membershipComponent?.included
            ? candidate.draftValues.planName
            : null,
          candidate.serviceComponent?.intent.itemName,
        ]
          .filter(Boolean)
          .join(' + '),
        disposition: result?.disposition ?? fallback.disposition,
        customer_outcome: result?.memberOutcome ?? fallback.memberOutcome,
        membership_outcome: candidate.membershipComponent?.included
          ? result?.disposition === 'imported' ||
            result?.disposition === 'partial'
            ? 'created'
            : result?.disposition === 'failed'
              ? 'failed'
              : 'not-processed'
          : 'not-requested',
        service_outcome: candidate.serviceComponent
          ? result?.disposition === 'imported' ||
            result?.disposition === 'partial'
            ? 'created'
            : result?.disposition === 'failed'
              ? 'failed'
              : 'not-processed'
          : 'not-requested',
        invoice_outcome:
          result?.disposition === 'imported' ||
          result?.disposition === 'partial'
            ? 'created'
            : result?.disposition === 'failed'
              ? 'failed'
              : 'not-processed',
        member_outcome: result?.memberOutcome ?? fallback.memberOutcome,
        payment_outcome: result?.paymentOutcome ?? fallback.paymentOutcome,
        // A committed row reports `reason: null`, so `??` would fall through
        // to the fallback and stamp every success with a failure reason.
        // The fallback only applies when the row produced no result at all.
        reason: result ? (result.reason ?? '') : (fallback.reason ?? ''),
      };
    });
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialize receipt rows as a downloadable RFC 4180-compatible CSV. */
export function serializeMemberImportReceiptCsv(
  rows: MemberImportReceiptRow[]
): string {
  const header = [
    'source_row',
    'legacy_id',
    'phone_suffix',
    'outcome_type',
    'offering_name',
    'disposition',
    'customer_outcome',
    'membership_outcome',
    'service_outcome',
    'invoice_outcome',
    'member_outcome',
    'payment_outcome',
    'reason',
  ];
  return [
    header.join(','),
    ...rows.map((row) =>
      header
        .map((key) => escapeCsv(row[key as keyof MemberImportReceiptRow]))
        .join(',')
    ),
  ].join('\n');
}

/** Sample offered on Upload. It demonstrates membership, service-only, and
 * combined purchases. Phone plus at least one offering is required. */
export const MEMBER_TEMPLATE_CSV = [
  'Name,Phone,Email,Plan,Billing option,Start date,Expiry,Status,Service,Service option,Service trainer,Service start date,Service expiry,Service sold price,Service status,Fee,Amount paid,Payment method,Payment date,Assigned to,Churn risk,Birthday,Gender,Height,Weight,City,State,Postal code,Notes,Tags',
  'Asha Rao,+91 98765 43210,asha@example.com,Gold,Monthly,01/07/2026,,Active,Personal training,1 month,Aakash,01/07/2026,01/08/2026,3500,Active,5000,5000,UPI,01/07/2026,Aakash,No,14/08/1993,Female,165 cm,58 kg,Pune,Maharashtra,411001,"Prefers morning classes","VIP, Morning"',
  'Vikram Shah,+91 91234 56780,,,,,,,Personal training,Quarterly,Aakash,15/06/2026,15/09/2026,9000,Active,9000,4500,Cash,15/06/2026,,Yes,22/02/1988,Male,"5\'10""",176 lb,Mumbai,Maharashtra,400001,"Old ID: GYM-204",At risk',
].join('\n');
