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
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'url', label: 'URL' },
];

/** Reserved names a new custom field cannot collide with. */
export const RESERVED_FIELD_NAMES = ['phone', 'name', 'email', 'company', 'tags'];

export type TargetKind = 'standard' | 'tags' | 'custom';

export interface TargetField {
  /** 'phone' | 'name' | 'email' | 'company' | 'tags' | `custom:${id}` */
  key: string;
  label: string;
  kind: TargetKind;
  /** Only `phone` is required (contacts.phone is NOT NULL + unique). */
  required: boolean;
}

const STANDARD_TARGETS: TargetField[] = [
  { key: 'phone', label: 'Phone', kind: 'standard', required: true },
  { key: 'name', label: 'Name', kind: 'standard', required: false },
  { key: 'email', label: 'Email', kind: 'standard', required: false },
  { key: 'company', label: 'Company', kind: 'standard', required: false },
];

/** Header synonyms used by auto-map, keyed by standard/tags target key. */
const HEADER_SYNONYMS: Record<string, string[]> = {
  phone: ['phone', 'mobile', 'number', 'whatsapp', 'cell', 'phone number', 'contact number', 'msisdn'],
  name: ['name', 'full name', 'contact name', 'customer name'],
  email: ['email', 'e-mail', 'mail', 'email address'],
  company: ['company', 'organization', 'organisation', 'org', 'business'],
  tags: ['tags', 'tag', 'labels', 'label'],
};

export interface CustomFieldRef {
  id: string;
  field_name: string;
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

/** Extract the custom-field id from a `custom:${id}` target key, else null. */
export function customFieldId(targetKey: string): string | null {
  return targetKey.startsWith('custom:') ? targetKey.slice('custom:'.length) : null;
}

export interface RawCsv {
  headers: string[];
  /** Data rows, each already split into cells aligned to `headers`. */
  rows: string[][];
}

/**
 * Parse a CSV into raw headers + rows without interpreting columns. Handles
 * quoted fields (incl. escaped `""`); does not handle newlines embedded in
 * quotes — matching the legacy parser's constraints so behaviour is
 * consistent across the two import paths.
 */
export function parseCsvRaw(text: string): RawCsv {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1 || !lines[0].trim()) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]);

  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    rows.push(parseCsvLine(lines[i]));
  }

  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Guess a target for each header by name. Returns an array aligned to
 * `headers` where each entry is a target key or `IGNORE_KEY`. Each target
 * is assigned to at most one column (first match wins) so two columns never
 * both claim `phone`.
 */
export function autoMapColumns(headers: string[], targets: TargetField[]): string[] {
  const used = new Set<string>();

  return headers.map((header) => {
    const norm = header.trim().toLowerCase();
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
    return normHeader === target.label.trim().toLowerCase();
  }
  const synonyms = HEADER_SYNONYMS[target.key];
  return synonyms ? synonyms.includes(normHeader) : false;
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
}

export interface ApplyMappingResult {
  rows: MappedRow[];
  /** Rows dropped because the mapped phone column was empty. */
  droppedNoPhone: number;
}

/**
 * Turn raw CSV rows into structured contact rows using `mapping` (aligned to
 * `raw.headers`). Rows with an empty phone are dropped and counted — phone is
 * the required field and the match key for update/upsert.
 */
export function applyMapping(raw: RawCsv, mapping: string[]): ApplyMappingResult {
  // Precompute column indexes per target so we scan the mapping once.
  const phoneCols: number[] = [];
  const nameCols: number[] = [];
  const emailCols: number[] = [];
  const companyCols: number[] = [];
  const tagCols: number[] = [];
  const customCols: { col: number; fieldId: string }[] = [];

  mapping.forEach((key, col) => {
    if (key === IGNORE_KEY) return;
    if (key === 'phone') phoneCols.push(col);
    else if (key === 'name') nameCols.push(col);
    else if (key === 'email') emailCols.push(col);
    else if (key === 'company') companyCols.push(col);
    else if (key === 'tags') tagCols.push(col);
    else {
      const id = customFieldId(key);
      if (id) customCols.push({ col, fieldId: id });
    }
  });

  const first = (row: string[], cols: number[]): string =>
    cols.map((c) => row[c]?.trim()).find((v) => v) ?? '';

  const rows: MappedRow[] = [];
  let droppedNoPhone = 0;

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
      const value = row[col]?.trim();
      if (value) customValues.push({ fieldId, value });
    }

    rows.push({
      phone,
      name: first(row, nameCols) || undefined,
      email: first(row, emailCols) || undefined,
      company: first(row, companyCols) || undefined,
      tagNames,
      customValues,
    });
  }

  return { rows, droppedNoPhone };
}
