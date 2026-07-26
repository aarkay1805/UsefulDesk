import { normalizeImportHeader, type RawCsv } from '@/lib/contacts/field-mapping';
import { normalizeKey } from '@/lib/contacts/dedupe';
import { parseImportDate, parseMoney } from './import-commit';

export const MIGRATION_TARGETS = [
  'phone', 'name', 'plan', 'pricing_option', 'start_date', 'end_date',
  'status', 'fee_amount', 'amount_paid', 'notes',
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

export interface MigrationIssue {
  code: 'shared-phone' | 'missing-phone' | 'payment-mismatch' | 'overpayment' | 'duration-mismatch';
  severity: 'review' | 'warning';
  sourceId: string;
  message: string;
  nextAction: string;
}

export interface MigrationTransform {
  raw: RawCsv;
  mapping: string[];
  issues: MigrationIssue[];
  counts: { ready: number; needsReview: number; excluded: number };
}

const HEADER_ALIASES: Record<MigrationTarget, string[]> = {
  phone: ['phone', 'contact', 'mobile', 'phone number'],
  name: ['name', 'member name', 'customer name'],
  plan: ['plan', 'membership', 'package'],
  pricing_option: ['pricing option', 'term', 'duration'],
  start_date: ['start date', 'joining date'],
  end_date: ['end date', 'expiry', 'expiry date'],
  status: ['status', 'membership status'],
  fee_amount: ['discounted amt', 'discounted amount', 'final fee', 'fee'],
  amount_paid: ['paid amp', 'paid amt', 'paid amount', 'amount paid'],
  notes: ['notes', 'remarks'],
};

function findHeader(headers: string[], aliases: string[]): string | null {
  const wanted = new Set(aliases.map(normalizeImportHeader));
  return headers.find((header) => wanted.has(normalizeImportHeader(header))) ?? null;
}

export function suggestMemberMigrationRecipe(headers: string[]): MemberMigrationRecipe {
  const mappings: Partial<Record<MigrationTarget, string>> = {};
  for (const target of MIGRATION_TARGETS) {
    const header = findHeader(headers, HEADER_ALIASES[target]);
    if (header) mappings[target] = header;
  }
  const identityColumn = findHeader(headers, ['member id', 'customer id', 'legacy id']);
  return {
    version: 1,
    mappings,
    excludeSummaryRows: true,
    identityColumn,
    latestByDateColumn: mappings.start_date ?? null,
    statusRules: { inactiveWithPastEndDate: 'expired', cancelled: 'cancelled' },
    splitPlanDuration: true,
    explicitEndDateWins: true,
    money: {
      listPriceColumn: findHeader(headers, ['actual amt', 'actual amount', 'list price']),
      feeColumn: mappings.fee_amount ?? null,
      paidColumn: mappings.amount_paid ?? null,
      balanceColumn: findHeader(headers, ['balance', 'amount due']),
    },
    legacyId: identityColumn ? 'notes' : 'exclude',
    confidence: 0.75,
    summary: ['Import the latest membership row for each source member.', 'Keep older membership history out of this first import.'],
    warnings: ['Plans are matched for review and are never created automatically.'],
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
  if (!value || typeof value !== 'object') return { ok: false, error: 'Recipe must be an object.' };
  const candidate = value as Partial<MemberMigrationRecipe>;
  const headerSet = new Set(headers);
  if (candidate.version !== 1 || !candidate.mappings || typeof candidate.mappings !== 'object') {
    return { ok: false, error: 'Unsupported recipe version.' };
  }
  const mappings: Partial<Record<MigrationTarget, string>> = {};
  for (const [key, column] of Object.entries(candidate.mappings)) {
    if (!MIGRATION_TARGETS.includes(key as MigrationTarget) || typeof column !== 'string' || !headerSet.has(column)) {
      return { ok: false, error: `Unsafe mapping: ${key}.` };
    }
    mappings[key as MigrationTarget] = column;
  }
  for (const column of [candidate.identityColumn, candidate.latestByDateColumn]) {
    if (!isStringOrNull(column) || (column && !headerSet.has(column))) {
      return { ok: false, error: 'Recipe refers to an unknown column.' };
    }
  }
  const money = candidate.money;
  if (!money || ![money.listPriceColumn, money.feeColumn, money.paidColumn, money.balanceColumn]
    .every((column) => isStringOrNull(column) && (!column || headerSet.has(column)))) {
    return { ok: false, error: 'Money interpretation refers to an unknown column.' };
  }
  const strings = (items: unknown) =>
    Array.isArray(items) && items.length <= 12 && items.every((item) => typeof item === 'string' && item.length <= 300);
  if (!strings(candidate.summary) || !strings(candidate.warnings) || !strings(candidate.questions)) {
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
      statusRules: { inactiveWithPastEndDate: 'expired', cancelled: 'cancelled' },
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

const DURATION = /\s+(\d+)\s*(M|MONTHS?|Y|YEARS?|D|DAYS?|SESSIONS?|SESSION|PER SESSION)$/i;
export function splitPlanDuration(value: string): { plan: string; option: string } {
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
  const option = unit.startsWith('M') ? `${count} month` : unit.startsWith('Y') ? `${count} year` :
    unit.startsWith('D') ? `${count} day` : unit === 'PER SESSION' ? 'Per session' : `${count} sessions`;
  return { plan: trimmed.slice(0, match.index).trim(), option };
}

function expectedEndDate(start: string, option: string): string | null {
  const match = /^(\d+)\s+(month|year|day)$/.exec(option);
  if (!match) return null;
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!parsed) return null;
  const date = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])));
  const count = Number(match[1]);
  if (match[2] === 'month') date.setUTCMonth(date.getUTCMonth() + count);
  if (match[2] === 'year') date.setUTCFullYear(date.getUTCFullYear() + count);
  if (match[2] === 'day') date.setUTCDate(date.getUTCDate() + count);
  // Source periods usually use inclusive end dates.
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function applyMemberMigrationRecipe(
  source: RawCsv,
  recipe: MemberMigrationRecipe,
  options: { today: string; dialCode: string }
): MigrationTransform {
  const index = new Map(source.headers.map((header, i) => [header, i]));
  const cell = (row: string[], header: string | null | undefined) =>
    header ? (row[index.get(header) ?? -1] ?? '').trim() : '';
  let excluded = 0;
  let rows = source.rows.filter((row) => {
    const summary = recipe.excludeSummaryRows &&
      row.some((value) => /^number of records\s*:/i.test(value.trim()));
    if (summary) excluded++;
    return !summary;
  });
  // Identity conflicts must be learned from the whole source, before older
  // history is excluded. Otherwise a shared phone present only on an older
  // row could make two distinct source members look safe after grouping.
  const phoneOwners = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = cell(row, recipe.identityColumn) || 'row';
    const phone = normalizeKey(cell(row, recipe.mappings.phone));
    if (!phone) continue;
    const owners = phoneOwners.get(phone) ?? new Set<string>();
    owners.add(id);
    phoneOwners.set(phone, owners);
  }
  if (recipe.identityColumn && recipe.latestByDateColumn) {
    const beforeGrouping = rows.length;
    const latest = new Map<string, { row: string[]; date: string }>();
    const passthrough: string[][] = [];
    for (const row of rows) {
      const id = cell(row, recipe.identityColumn);
      if (!id) { passthrough.push(row); continue; }
      const date = parseImportDate(cell(row, recipe.latestByDateColumn)) ?? '';
      const current = latest.get(id);
      if (!current || date > current.date) latest.set(id, { row, date });
    }
    rows = [...latest.values()].map((item) => item.row).concat(passthrough);
    excluded += beforeGrouping - rows.length;
  }

  const issues: MigrationIssue[] = [];
  const outputHeaders = [...MIGRATION_TARGETS.map(String)];
  const outputRows = rows.map((row) => {
    const id = cell(row, recipe.identityColumn) || 'Unknown';
    const values = new Map<MigrationTarget, string>();
    for (const target of MIGRATION_TARGETS) values.set(target, cell(row, recipe.mappings[target]));
    const phone = normalizeKey(values.get('phone') ?? '');
    if (!phone) {
      issues.push({ code: 'missing-phone', severity: 'review', sourceId: id, message: 'No usable phone number.', nextAction: 'Add a phone number or exclude this member.' });
    } else if ((phoneOwners.get(phone)?.size ?? 0) > 1) {
      issues.push({ code: 'shared-phone', severity: 'review', sourceId: id, message: 'This phone is shared by different source Member IDs.', nextAction: 'Choose the correct phone for each member; they will not be merged.' });
      values.set('phone', '');
    }
    if (recipe.splitPlanDuration) {
      const split = splitPlanDuration(values.get('plan') ?? '');
      values.set('plan', split.plan);
      if (split.option) values.set('pricing_option', split.option);
    }
    const parsedStart = parseImportDate(values.get('start_date') ?? '');
    const parsedEnd = parseImportDate(values.get('end_date') ?? '');
    const durationEnd = parsedStart
      ? expectedEndDate(parsedStart, values.get('pricing_option') ?? '')
      : null;
    if (recipe.explicitEndDateWins && parsedEnd && durationEnd && parsedEnd !== durationEnd) {
      issues.push({
        code: 'duration-mismatch',
        severity: 'warning',
        sourceId: id,
        message: `Explicit end date ${parsedEnd} differs from the plan term (${durationEnd}).`,
        nextAction: 'The explicit end date will win; verify it in preview.',
      });
    }
    const end = parsedEnd;
    const status = (values.get('status') ?? '').toLowerCase();
    if (status === 'inactive' && end && end < options.today) values.set('status', 'expired');
    else if (status === 'inactive') values.set('status', 'cancelled');
    const fee = parseMoney(cell(row, recipe.money.feeColumn));
    const paid = parseMoney(cell(row, recipe.money.paidColumn));
    const balance = parseMoney(cell(row, recipe.money.balanceColumn));
    if (fee !== null && paid !== null && paid > fee) {
      issues.push({ code: 'overpayment', severity: 'review', sourceId: id, message: 'Amount paid is greater than the final fee.', nextAction: 'Correct the amounts before recording a payment.' });
      values.set('amount_paid', '');
    } else if (fee !== null && paid !== null && balance !== null && Math.abs(paid + balance - fee) > 0.01) {
      issues.push({ code: 'payment-mismatch', severity: 'review', sourceId: id, message: 'Paid + balance does not equal the final fee.', nextAction: 'Verify the source amounts; no payment will be imported for this row.' });
      values.set('amount_paid', '');
    }
    values.set('fee_amount', fee === null ? '' : String(fee));
    if (recipe.legacyId === 'notes' && recipe.identityColumn) {
      const existing = values.get('notes');
      values.set('notes', [existing, `Legacy Member ID: ${id}`].filter(Boolean).join(' · '));
    }
    return outputHeaders.map((header) => values.get(header as MigrationTarget) ?? '');
  });
  const reviewIds = new Set(issues.filter((issue) => issue.severity === 'review').map((issue) => issue.sourceId));
  return {
    raw: { headers: outputHeaders, rows: outputRows },
    mapping: outputHeaders,
    issues,
    counts: { ready: outputRows.length - reviewIds.size, needsReview: reviewIds.size, excluded },
  };
}

export function buildMigrationAnalysis(raw: RawCsv) {
  return {
    headers: raw.headers,
    rowCount: raw.rows.length,
    samples: raw.headers.map((header, column) => ({
      header,
      values: [...new Set(raw.rows.map((row) => row[column]?.trim()).filter(Boolean))].slice(0, 5),
    })),
  };
}
