/**
 * Generic column→field mapping for the contacts import wizard.
 *
 * Unlike the legacy fixed-header parser (`parseContactCsv`), this reads an
 * arbitrary CSV's headers and lets the caller map each column to a contact
 * field (standard, tags, or a custom field) — or ignore it. All functions
 * here are pure so mapping/validation stay unit-tested; DB writes live in
 * the wizard component.
 */

import { parseTagCell } from './parse-contact-csv';

/** Sentinel target meaning "don't import this column". */
export const IGNORE_KEY = '__ignore__';

/**
 * Sentinel dropdown value that opens the "create custom field" flow for a
 * column. Never stored in a mapping — the wizard swaps it for the real
 * `custom:${id}` once the field is created.
 */
export const CREATE_FIELD_KEY = '__create__';

export interface CustomFieldType {
  value: string;
  label: string;
}

/**
 * Data types offered when creating a custom field on the fly. Stored in
 * `custom_fields.field_type`; today it's captured metadata (nothing renders
 * differently per type yet) but it drives future type-aware formatting.
 */
export const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'url', label: 'URL' },
];

/** Reserved names a new custom field cannot collide with. */
export const RESERVED_FIELD_NAMES = [
  'phone',
  'name',
  'email',
  'company',
  'tags',
];

export type TargetKind =
  | 'standard'
  | 'tags'
  | 'custom'
  | 'option'
  | 'assignee'
  | 'member'
  | 'profile'
  | 'payment';

export interface TargetField {
  /** 'phone' | 'name' | 'email' | 'company' | 'tags' | `custom:${id}`,
   *  plus (leads) 'lead_status' | 'source' | 'gender' | 'assignee'. */
  key: string;
  label: string;
  kind: TargetKind;
  /** Only `phone` is required (contacts.phone is NOT NULL + unique). */
  required: boolean;
  /** Variant-owned aliases used by the shared intelligent auto-mapper. */
  synonyms?: string[];
  /** For kind 'option': which account option list validates the values. */
  optionsField?: 'status' | 'source' | 'gender';
}

const STANDARD_TARGETS: TargetField[] = [
  { key: 'phone', label: 'Phone', kind: 'standard', required: true },
  { key: 'name', label: 'Name', kind: 'standard', required: false },
  { key: 'email', label: 'Email', kind: 'standard', required: false },
  { key: 'company', label: 'Company', kind: 'standard', required: false },
];

/** Lead-field targets — offered by `buildLeadTargets` (Leads import only).
 *  Raw cell text lands on `MappedRow` untouched; the wizard coerces it
 *  against the account's option lists via `lib/leads/import-coerce`. */
const LEAD_TARGETS: TargetField[] = [
  {
    key: 'lead_status',
    label: 'Status',
    kind: 'option',
    required: false,
    optionsField: 'status',
  },
  {
    key: 'source',
    label: 'Source',
    kind: 'option',
    required: false,
    optionsField: 'source',
  },
  {
    key: 'gender',
    label: 'Gender',
    kind: 'option',
    required: false,
    optionsField: 'gender',
  },
  { key: 'assignee', label: 'Assigned to', kind: 'assignee', required: false },
];

/** Header synonyms used by auto-map, keyed by target key. */
const HEADER_SYNONYMS: Record<string, string[]> = {
  phone: [
    'phone',
    'mobile',
    'number',
    'whatsapp',
    'cell',
    'phone number',
    'contact number',
    'msisdn',
  ],
  name: ['name', 'full name', 'contact name', 'customer name'],
  email: ['email', 'e-mail', 'mail', 'email address'],
  company: ['company', 'organization', 'organisation', 'org', 'business'],
  tags: ['tags', 'tag', 'labels', 'label'],
  lead_status: ['status', 'lead status', 'stage', 'lead stage'],
  source: ['source', 'lead source', 'channel', 'came from', 'enquiry source'],
  gender: ['gender', 'sex'],
  assignee: [
    'assigned to',
    'assignee',
    'assigned',
    'owner',
    'rep',
    'agent',
    'trainer',
    'staff',
  ],
};

export interface CustomFieldRef {
  id: string;
  field_name: string;
  /** One of CUSTOM_FIELD_TYPES; defaults to 'text' when absent. */
  field_type?: string;
}

/**
 * Validate + normalize a raw cell for a typed custom field. Returns the
 * canonical string to store, or null when the value is invalid for the type
 * (the caller drops it and counts it). Kept deliberately light — no locale
 * pattern library; ambiguous slash dates use JS Date interpretation.
 */
export function coerceCustomValue(
  rawValue: string,
  type: string,
  dateOrder?: 'DMY' | 'MDY'
): string | null {
  const value = rawValue.trim();
  if (!value) return null;

  switch (type) {
    case 'number': {
      // Drop spaces + thousands commas; keep a single dot decimal.
      const cleaned = value.replace(/[\s,]/g, '');
      if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
      const n = Number(cleaned);
      return Number.isFinite(n) ? String(n) : null;
    }
    case 'email': {
      const lower = value.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower) ? lower : null;
    }
    case 'url': {
      const withScheme = /^https?:\/\//i.test(value)
        ? value
        : `https://${value}`;
      try {
        const u = new URL(withScheme);
        return u.hostname.includes('.') ? u.toString() : null;
      } catch {
        return null;
      }
    }
    case 'phone': {
      const digits = value.replace(/\D/g, '');
      return digits.length >= 7 ? value : null;
    }
    case 'date':
      return coerceDate(value, dateOrder);
    case 'text':
    default:
      return value;
  }
}

/**
 * Normalize a date string to ISO `YYYY-MM-DD`, or null if unparseable.
 * `dateOrder` disambiguates slash/dash dates ("02/07/2026"): 'DMY' reads
 * day-first (India default), 'MDY' month-first. Without it, ambiguous
 * dates fall through to JS `Date.parse` (month-first bias) — the
 * pre-existing contacts-import behaviour.
 */
function coerceDate(value: string, dateOrder?: 'DMY' | 'MDY'): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  if (dateOrder) {
    const m = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      let year = Number(m[3]);
      if (m[3].length === 2) year += 2000;
      // A part > 12 can only be the day, whichever order was chosen.
      let day = dateOrder === 'DMY' ? a : b;
      let month = dateOrder === 'DMY' ? b : a;
      if (month > 12 && day <= 12) [day, month] = [month, day];
      const d = new Date(Date.UTC(year, month - 1, day));
      const valid =
        d.getUTCFullYear() === year &&
        d.getUTCMonth() === month - 1 &&
        d.getUTCDate() === day;
      if (!valid) return null;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build the full target list for a module's mapping dropdowns. */
export function buildTargets(customFields: CustomFieldRef[]): TargetField[] {
  return [
    ...STANDARD_TARGETS,
    { key: 'tags', label: 'Tags', kind: 'tags', required: false },
    ...customFields.map((f) => ({
      key: `custom:${f.id}`,
      label: f.field_name,
      kind: 'custom' as const,
      required: false,
    })),
  ];
}

/**
 * Target list for the Leads import variant — the contacts targets plus
 * the lead fields (Status / Source / Gender / Assigned to). Contacts
 * import keeps using `buildTargets`; behaviour there is unchanged.
 */
export function buildLeadTargets(
  customFields: CustomFieldRef[]
): TargetField[] {
  return [
    ...STANDARD_TARGETS,
    ...LEAD_TARGETS,
    { key: 'tags', label: 'Tags', kind: 'tags', required: false },
    ...customFields.map((f) => ({
      key: `custom:${f.id}`,
      label: f.field_name,
      kind: 'custom' as const,
      required: false,
    })),
  ];
}

/** Extract the custom-field id from a `custom:${id}` target key, else null. */
export function customFieldId(targetKey: string): string | null {
  return targetKey.startsWith('custom:')
    ? targetKey.slice('custom:'.length)
    : null;
}

export interface RawCsv {
  headers: string[];
  /** Data rows, each already split into cells aligned to `headers`. */
  rows: string[][];
}

/**
 * Parse a CSV into raw headers + rows without interpreting columns. Handles
 * RFC 4180-style quoted commas, escaped quotes, CRLF, BOM-prefixed exports,
 * and embedded newlines — common in Notes/Address columns from gym systems.
 */
export function parseCsvRaw(text: string): RawCsv {
  const records = parseCsvRecords(text);
  if (records.length === 0 || !records[0].some((cell) => cell.trim())) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map((cell, index) =>
    (index === 0 ? cell.replace(/^\uFEFF/, '') : cell).trim()
  );
  return {
    headers,
    rows: records.slice(1).filter((row) => row.some((cell) => cell.trim())),
  };
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    records.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      pushField();
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += char;
    }
  }

  // Do not turn a terminal newline into a phantom row, but preserve a
  // terminal comma as the final empty cell of the real row.
  if (field.length > 0 || row.length > 0) pushRow();
  return records;
}

/**
 * Guess a target for each header by name. Returns an array aligned to
 * `headers` where each entry is a target key or `IGNORE_KEY`. Each target
 * is assigned to at most one column (first match wins) so two columns never
 * both claim `phone`.
 */
export function autoMapColumns(
  headers: string[],
  targets: TargetField[]
): string[] {
  const used = new Set<string>();

  return headers.map((header) => {
    const norm = normalizeImportHeader(header);
    if (!norm) return IGNORE_KEY;

    for (const target of targets) {
      if (used.has(target.key)) continue;
      if (headerMatchesTarget(norm, target)) {
        used.add(target.key);
        return target.key;
      }
    }
    return IGNORE_KEY;
  });
}

function headerMatchesTarget(normHeader: string, target: TargetField): boolean {
  if (target.kind === 'custom') {
    return normHeader === normalizeImportHeader(target.label);
  }
  const synonyms = [
    ...(target.synonyms ?? []),
    ...(HEADER_SYNONYMS[target.key] ?? []),
    target.label,
  ].map(normalizeImportHeader);
  const stripped = stripHeaderContext(normHeader);
  return synonyms.some((synonym) => {
    if (!synonym) return false;
    return (
      synonym === normHeader ||
      stripHeaderContext(synonym) === stripped ||
      squashHeader(synonym) === squashHeader(normHeader)
    );
  });
}

/** Normalize separators/casing used by exports such as `Member_Name`,
 * `member-name`, `Membership Expiry (Date)`, and camelCase API dumps. */
export function normalizeImportHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADER_CONTEXT = new Set([
  'member',
  'members',
  'membership',
  'customer',
  'client',
  'current',
  'primary',
  'details',
  'detail',
  'info',
  'information',
  'field',
]);

function stripHeaderContext(value: string): string {
  return value
    .split(' ')
    .filter((token) => token && !HEADER_CONTEXT.has(token))
    .join(' ');
}

function squashHeader(value: string): string {
  return value.replace(/\s+/g, '');
}

export interface MappingValidation {
  /** True when some column maps to `phone`. */
  phoneMapped: boolean;
  /** Target keys assigned to more than one column (excluding IGNORE). */
  duplicateTargets: string[];
  /** True when the mapping is safe to import. */
  ok: boolean;
}

/** Validate a mapping array (aligned to headers) against the phone rule. */
export function validateMapping(mapping: string[]): MappingValidation {
  const counts = new Map<string, number>();
  for (const key of mapping) {
    if (key === IGNORE_KEY) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const phoneMapped = (counts.get('phone') ?? 0) >= 1;
  const duplicateTargets: string[] = [];
  for (const [key, count] of counts) {
    if (count > 1) duplicateTargets.push(key);
  }

  return {
    phoneMapped,
    duplicateTargets,
    ok: phoneMapped && duplicateTargets.length === 0,
  };
}

export interface MappedCustomValue {
  fieldId: string;
  value: string;
}

export interface MappedRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  tagNames: string[];
  customValues: MappedCustomValue[];
  // Lead-field columns (leads variant only) — RAW cell text. Coercion to
  // option keys / staff ids is layered on top by `lib/leads/import-coerce`
  // so this engine stays dependency-free.
  leadStatus?: string;
  source?: string;
  gender?: string;
  assignedTo?: string;
}

export interface ApplyMappingResult {
  rows: MappedRow[];
  /** Rows dropped because the mapped phone column was empty. */
  droppedNoPhone: number;
  /** Custom values dropped because they failed their field's type check. */
  invalidCustomValues: number;
}

/**
 * Turn raw CSV rows into structured contact rows using `mapping` (aligned to
 * `raw.headers`). Rows with an empty phone are dropped and counted — phone is
 * the required field and the match key for update/upsert.
 *
 * `fieldTypeById` maps a custom field id to its `field_type`; each custom
 * value is validated/normalized against it, and values failing the check are
 * dropped and counted in `invalidCustomValues`.
 */
export function applyMapping(
  raw: RawCsv,
  mapping: string[],
  fieldTypeById?: Map<string, string>,
  dateOrder?: 'DMY' | 'MDY'
): ApplyMappingResult {
  // Precompute column indexes per target so we scan the mapping once.
  const phoneCols: number[] = [];
  const nameCols: number[] = [];
  const emailCols: number[] = [];
  const companyCols: number[] = [];
  const tagCols: number[] = [];
  const leadStatusCols: number[] = [];
  const sourceCols: number[] = [];
  const genderCols: number[] = [];
  const assigneeCols: number[] = [];
  const customCols: { col: number; fieldId: string }[] = [];

  mapping.forEach((key, col) => {
    if (key === IGNORE_KEY) return;
    if (key === 'phone') phoneCols.push(col);
    else if (key === 'name') nameCols.push(col);
    else if (key === 'email') emailCols.push(col);
    else if (key === 'company') companyCols.push(col);
    else if (key === 'tags') tagCols.push(col);
    else if (key === 'lead_status') leadStatusCols.push(col);
    else if (key === 'source') sourceCols.push(col);
    else if (key === 'gender') genderCols.push(col);
    else if (key === 'assignee') assigneeCols.push(col);
    else {
      const id = customFieldId(key);
      if (id) customCols.push({ col, fieldId: id });
    }
  });

  const first = (row: string[], cols: number[]): string =>
    cols.map((c) => row[c]?.trim()).find((v) => v) ?? '';

  const rows: MappedRow[] = [];
  let droppedNoPhone = 0;
  let invalidCustomValues = 0;

  for (const row of raw.rows) {
    const phone = first(row, phoneCols);
    if (!phone) {
      droppedNoPhone++;
      continue;
    }

    const tagNames: string[] = [];
    for (const col of tagCols) {
      for (const name of parseTagCell(row[col])) tagNames.push(name);
    }

    const customValues: MappedCustomValue[] = [];
    for (const { col, fieldId } of customCols) {
      const rawValue = row[col]?.trim();
      if (!rawValue) continue;
      const type = fieldTypeById?.get(fieldId) ?? 'text';
      const value = coerceCustomValue(rawValue, type, dateOrder);
      if (value === null) {
        invalidCustomValues++;
        continue;
      }
      customValues.push({ fieldId, value });
    }

    rows.push({
      phone,
      name: first(row, nameCols) || undefined,
      email: first(row, emailCols) || undefined,
      company: first(row, companyCols) || undefined,
      tagNames,
      customValues,
      leadStatus: first(row, leadStatusCols) || undefined,
      source: first(row, sourceCols) || undefined,
      gender: first(row, genderCols) || undefined,
      assignedTo: first(row, assigneeCols) || undefined,
    });
  }

  return { rows, droppedNoPhone, invalidCustomValues };
}
