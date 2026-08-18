import {
  normalizeImportHeader,
  type RawCsv,
} from '@/lib/contacts/field-mapping';
import { parseImportDate, parseMoney } from './import-commit';

export const MIGRATION_TARGETS = [
  'phone',
  'name',
  'legacy_member_id',
  'membership_plan',
  'membership_option',
  'membership_trainer',
  'start_date',
  'end_date',
  'status',
  'membership_list_price',
  'membership_discount_amount',
  'membership_discount_percent',
  'fee_amount',
  'amount_paid',
  'amount_due',
  'notes',
  'offering',
  'service',
  'service_option',
  'service_trainer',
  'service_start',
  'service_end',
  'service_list_price',
  'service_discount_amount',
  'service_discount_percent',
  'service_sold_price',
  'service_status',
  // Kept so saved v1 AI recipes made before service-aware imports still validate.
  'plan',
  'pricing_option',
] as const;
export type MigrationTarget = (typeof MIGRATION_TARGETS)[number];

export interface MemberMigrationRecipe {
  version: 1;
  mappings: Partial<Record<MigrationTarget, string>>;
  excludeSummaryRows: boolean;
  identityColumn: string | null;
  latestByDateColumn: string | null;
  statusRules: {
    inactiveWithPastEndDate: 'expired';
    cancelled: 'cancelled';
  };
  splitPlanDuration: boolean;
  explicitEndDateWins: boolean;
  money: {
    listPriceColumn: string | null;
    feeColumn: string | null;
    paidColumn: string | null;
    balanceColumn: string | null;
  };
  legacyId: 'notes' | 'exclude';
  confidence: number;
  summary: string[];
  warnings: string[];
  questions: string[];
}

const HEADER_ALIASES: Record<MigrationTarget, string[]> = {
  phone: ['phone', 'contact', 'mobile', 'phone number'],
  name: ['name', 'member name', 'customer name'],
  legacy_member_id: ['member id', 'customer id', 'legacy id', 'member no'],
  membership_plan: ['membership plan', 'membership package', 'membership'],
  membership_trainer: ['trainer', 'coach', 'personal trainer'],
  membership_option: [
    'membership option',
    'billing option',
    'membership duration',
    'term',
    'duration',
  ],
  start_date: ['start date', 'joining date'],
  end_date: ['end date', 'expiry', 'expiry date'],
  status: ['status', 'membership status'],
  membership_list_price: [
    'actual amt',
    'actual amount',
    'list price',
    'gross amount',
    'mrp',
  ],
  membership_discount_amount: [
    'discount',
    'discount amt',
    'discount amount',
    'concession',
  ],
  membership_discount_percent: ['discount percent', 'discount percentage'],
  fee_amount: ['discounted amt', 'discounted amount', 'final fee', 'fee'],
  amount_paid: ['paid amp', 'paid amt', 'paid amount', 'amount paid'],
  amount_due: ['balance', 'amount due', 'due amount', 'outstanding'],
  notes: ['notes', 'remarks'],
  offering: ['package', 'offering', 'plan or service', 'product or service'],
  service: ['service', 'service name'],
  service_option: ['service option', 'service package', 'service duration'],
  service_trainer: ['service trainer', 'service coach'],
  service_start: ['service start', 'service start date'],
  service_end: ['service end', 'service end date', 'service expiry'],
  service_list_price: ['service list price', 'service actual amount'],
  service_discount_amount: ['service discount', 'service discount amount'],
  service_discount_percent: ['service discount percent'],
  service_sold_price: ['service sold price', 'service price', 'sold price'],
  service_status: ['service status'],
  plan: [],
  pricing_option: [],
};

function findHeader(headers: string[], aliases: string[]): string | null {
  const wanted = new Set(aliases.map(normalizeImportHeader));
  return (
    headers.find((header) => wanted.has(normalizeImportHeader(header))) ?? null
  );
}

export function suggestMemberMigrationRecipe(
  headers: string[]
): MemberMigrationRecipe {
  const mappings: Partial<Record<MigrationTarget, string>> = {};
  for (const target of MIGRATION_TARGETS) {
    const header = findHeader(headers, HEADER_ALIASES[target]);
    if (header) mappings[target] = header;
  }
  const identityColumn =
    mappings.legacy_member_id ??
    findHeader(headers, ['member id', 'customer id', 'legacy id']);
  if (identityColumn) mappings.legacy_member_id = identityColumn;
  return {
    version: 1,
    mappings,
    excludeSummaryRows: true,
    identityColumn,
    latestByDateColumn: mappings.start_date ?? null,
    statusRules: { inactiveWithPastEndDate: 'expired', cancelled: 'cancelled' },
    splitPlanDuration: true,
    explicitEndDateWins: true,
    // `money` stays for saved v1 recipes, but every column it names is also
    // a visible mapping now: a column the owner sees as "Don't import" must
    // never quietly steer the import.
    money: {
      listPriceColumn: mappings.membership_list_price ?? null,
      feeColumn: mappings.fee_amount ?? null,
      paidColumn: mappings.amount_paid ?? null,
      balanceColumn: mappings.amount_due ?? null,
    },
    legacyId: identityColumn ? 'notes' : 'exclude',
    confidence: 0.75,
    summary: [
      'Import the latest membership row for each source member.',
      'Keep older membership history out of this first import.',
    ],
    warnings: [
      'Plans are matched for review and are never created automatically.',
    ],
    questions: [],
  };
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function validateMemberMigrationRecipe(
  value: unknown,
  headers: string[]
): { ok: true; recipe: MemberMigrationRecipe } | { ok: false; error: string } {
  if (!value || typeof value !== 'object')
    return { ok: false, error: 'Recipe must be an object.' };
  const candidate = value as Partial<MemberMigrationRecipe>;
  const headerSet = new Set(headers);
  if (
    candidate.version !== 1 ||
    !candidate.mappings ||
    typeof candidate.mappings !== 'object'
  ) {
    return { ok: false, error: 'Unsupported recipe version.' };
  }
  const mappings: Partial<Record<MigrationTarget, string>> = {};
  for (const [key, column] of Object.entries(candidate.mappings)) {
    if (
      !MIGRATION_TARGETS.includes(key as MigrationTarget) ||
      typeof column !== 'string' ||
      !headerSet.has(column)
    ) {
      return { ok: false, error: `Unsafe mapping: ${key}.` };
    }
    mappings[key as MigrationTarget] = column;
  }
  for (const column of [
    candidate.identityColumn,
    candidate.latestByDateColumn,
  ]) {
    if (!isStringOrNull(column) || (column && !headerSet.has(column))) {
      return { ok: false, error: 'Recipe refers to an unknown column.' };
    }
  }
  const money = candidate.money;
  if (
    !money ||
    ![
      money.listPriceColumn,
      money.feeColumn,
      money.paidColumn,
      money.balanceColumn,
    ].every(
      (column) => isStringOrNull(column) && (!column || headerSet.has(column))
    )
  ) {
    return {
      ok: false,
      error: 'Money interpretation refers to an unknown column.',
    };
  }
  const strings = (items: unknown) =>
    Array.isArray(items) &&
    items.length <= 12 &&
    items.every((item) => typeof item === 'string' && item.length <= 300);
  if (
    !strings(candidate.summary) ||
    !strings(candidate.warnings) ||
    !strings(candidate.questions)
  ) {
    return { ok: false, error: 'Recipe explanations are invalid.' };
  }
  return {
    ok: true,
    recipe: {
      version: 1,
      mappings,
      excludeSummaryRows: candidate.excludeSummaryRows === true,
      identityColumn: candidate.identityColumn ?? null,
      latestByDateColumn: candidate.latestByDateColumn ?? null,
      statusRules: {
        inactiveWithPastEndDate: 'expired',
        cancelled: 'cancelled',
      },
      splitPlanDuration: candidate.splitPlanDuration === true,
      explicitEndDateWins: candidate.explicitEndDateWins !== false,
      money,
      legacyId: candidate.legacyId === 'notes' ? 'notes' : 'exclude',
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0)),
      summary: candidate.summary as string[],
      warnings: candidate.warnings as string[],
      questions: candidate.questions as string[],
    },
  };
}

const DURATION =
  /\s+(\d+)\s*(M|MONTHS?|Y|YEARS?|D|DAYS?|SESSIONS?|SESSION|PER SESSION)$/i;
export function splitPlanDuration(value: string): {
  plan: string;
  option: string;
} {
  const trimmed = value.trim();
  if (/\s+PER SESSION$/i.test(trimmed)) {
    return {
      plan: trimmed.replace(/\s+PER SESSION$/i, '').trim(),
      option: 'Per session',
    };
  }
  const match = trimmed.match(DURATION);
  if (!match) return { plan: trimmed, option: '' };
  const count = match[1];
  const unit = match[2].toUpperCase();
  const option = unit.startsWith('M')
    ? `${count} month`
    : unit.startsWith('Y')
      ? `${count} year`
      : unit.startsWith('D')
        ? `${count} day`
        : unit === 'PER SESSION'
          ? 'Per session'
          : `${count} sessions`;
  return { plan: trimmed.slice(0, match.index).trim(), option };
}

export function normalizeMemberMigrationStatus(
  status: string | null | undefined,
  explicitEndDate: string | null | undefined,
  dateOrder: 'DMY' | 'MDY',
  today: string
): string {
  const value = status?.trim() ?? '';
  if (value.toLowerCase() !== 'inactive') return value;
  const end = explicitEndDate
    ? parseImportDate(explicitEndDate, dateOrder)
    : null;
  return end && end < today ? 'expired' : 'cancelled';
}

export type MigrationValueFormat =
  'text' | 'number' | 'date' | 'email' | 'phone' | 'url' | 'blank';

export interface MemberMigrationAnalysis {
  headers: string[];
  rowCount: number;
  inferredTypes: Record<string, Exclude<MigrationValueFormat, 'blank'>>;
  blankCounts: Record<string, number>;
  distinctCounts: Record<string, number>;
  formatStatistics: Record<
    string,
    Partial<Record<MigrationValueFormat, number>>
  >;
}

function migrationValueFormat(
  header: string,
  value: string
): MigrationValueFormat {
  const trimmed = value.trim();
  if (!trimmed) return 'blank';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email';
  if (/^https?:\/\/\S+$/i.test(trimmed)) return 'url';

  const normalizedHeader = normalizeImportHeader(header);
  const dateHeader = /(?:date|dob|birth|expiry|expire|valid until|joined)/.test(
    normalizedHeader
  );
  if (dateHeader && parseImportDate(trimmed)) return 'date';

  const phoneHeader = /(?:phone|mobile|contact|whatsapp|cell)/.test(
    normalizedHeader
  );
  const phoneDigits = trimmed.replace(/\D/g, '');
  if (
    phoneHeader &&
    phoneDigits.length >= 7 &&
    phoneDigits.length <= 15 &&
    /^[+()\d\s.-]+$/.test(trimmed)
  ) {
    return 'phone';
  }
  if (parseMoney(trimmed) !== null) return 'number';
  if (parseImportDate(trimmed)) return 'date';
  return 'text';
}

/**
 * Build the complete analysis request without retaining a single source
 * value. The endpoint receives schema and value-pattern counts only; local
 * deterministic parsing remains the authority for every row decision.
 */
export function buildMigrationAnalysis(raw: RawCsv): MemberMigrationAnalysis {
  const inferredTypes: MemberMigrationAnalysis['inferredTypes'] = {};
  const blankCounts: MemberMigrationAnalysis['blankCounts'] = {};
  const distinctCounts: MemberMigrationAnalysis['distinctCounts'] = {};
  const formatStatistics: MemberMigrationAnalysis['formatStatistics'] = {};

  raw.headers.forEach((header, column) => {
    const formats: Partial<Record<MigrationValueFormat, number>> = {};
    const distinct = new Set<string>();
    for (const row of raw.rows) {
      const value = row[column]?.trim() ?? '';
      const format = migrationValueFormat(header, value);
      formats[format] = (formats[format] ?? 0) + 1;
      if (value) distinct.add(value);
    }
    formatStatistics[header] = formats;
    blankCounts[header] = formats.blank ?? 0;
    distinctCounts[header] = distinct.size;
    const ranked: Exclude<MigrationValueFormat, 'blank'>[] = [
      'phone',
      'email',
      'url',
      'date',
      'number',
      'text',
    ];
    ranked.sort((left, right) => (formats[right] ?? 0) - (formats[left] ?? 0));
    inferredTypes[header] = ranked[0] ?? 'text';
  });

  return {
    headers: raw.headers,
    rowCount: raw.rows.length,
    inferredTypes,
    blankCounts,
    distinctCounts,
    formatStatistics,
  };
}
