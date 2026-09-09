import {
  normalizeImportHeader,
  parseCsvRecords,
  type RawCsv,
} from '@/lib/contacts/field-mapping';

import {
  MEMBER_IMPORT_DRAFT_MAX_STATE_BYTES,
  MEMBER_IMPORT_DRAFT_SOURCE_BUDGET_BYTES,
} from './import-draft';

export const MAX_MEMBER_IMPORT_SOURCE_ROWS = 5_000;
export const MAX_MEMBER_IMPORT_SOURCE_COLUMNS = 100;
const MAX_HEADER_SCAN_ROWS = 25;

export type MemberImportExcludedRowReason =
  'leading_row' | 'blank_row' | 'repeated_header' | 'footer_summary';

export interface MemberImportExcludedSourceRow {
  sourceRow: number;
  reason: MemberImportExcludedRowReason;
  /** Retained for review; adapter exclusions never silently discard values. */
  values: string[];
}

/** A raw table plus its exact, one-based source record numbers. */
export interface MemberImportNormalizedSource {
  raw: RawCsv;
  /** One-based source row number for each aligned `raw.rows` entry. */
  sourceRows: number[];
  /** One-based source row containing `raw.headers`. */
  headerRow: number;
  excludedRows: MemberImportExcludedSourceRow[];
  normalizedBytes: number;
}

export class MemberImportSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberImportSourceError';
  }
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ''
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') return value.replace(/^\uFEFF/, '').trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return String(value).trim();
}

function tableRow(row: unknown[], width: number): string[] {
  return Array.from({ length: width }, (_, column) => cellText(row[column]));
}

const PHONE_HEADER_NAMES = new Set([
  'phone',
  'phone number',
  'mobile',
  'mobile number',
  'contact',
  'contact number',
  'whatsapp',
  'whatsapp number',
  'cell',
  'cell phone',
]);

// This is deliberately a small vocabulary of common member-table headings,
// not an attempt to recognize every export. Two independent labels are enough
// evidence to stop a second table; one label can occur in normal member data.
const MEMBER_HEADER_NAMES = new Set([
  ...PHONE_HEADER_NAMES,
  'name',
  'member name',
  'customer name',
  'member id',
  'customer id',
  'legacy id',
  'member no',
  'plan',
  'membership',
  'membership plan',
  'membership package',
  'package',
  'start date',
  'end date',
  'expiry',
  'expiry date',
  'status',
  'amount paid',
  'amount due',
  'balance',
]);

function phoneHeaderIndexes(headers: string[]): number[] {
  return headers.flatMap((header, index) =>
    PHONE_HEADER_NAMES.has(normalizeImportHeader(header)) ? [index] : []
  );
}

function duplicateHeaderIssue(row: string[]): string | null {
  const populated = row.filter(Boolean);
  const seen = new Set<string>();
  for (const header of populated) {
    const normalized = normalizeImportHeader(header);
    if (!normalized) continue;
    if (seen.has(normalized)) {
      return `has duplicate header “${header}”`;
    }
    seen.add(normalized);
  }
  return null;
}

function hasSupportedPhoneHeader(row: string[]): boolean {
  return phoneHeaderIndexes(row).length > 0;
}

function sameHeader(row: string[], headers: string[]): boolean {
  return (
    row.length === headers.length &&
    row.every(
      (cell, index) =>
        normalizeImportHeader(cell) ===
        normalizeImportHeader(headers[index] ?? '')
    )
  );
}

function isFooterSummary(row: string[], headers: string[]): boolean {
  const phoneIndexes = phoneHeaderIndexes(headers);
  // Before the owner maps an ordinary first-row table, there is no reliable
  // identity column. A value such as "Total" in Notes must remain reviewable,
  // never be guessed into a footer exclusion.
  if (phoneIndexes.length === 0) return false;
  if (
    phoneIndexes.some((index) => {
      const digits = (row[index] ?? '').replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15;
    })
  ) {
    return false;
  }
  return row.some(
    (value, index) =>
      !phoneIndexes.includes(index) &&
      /^(?:grand\s+)?total(?:\s*[:=].*)?$|^subtotal(?:\s*[:=].*)?$|^number\s+of\s+records(?:\s*[:=].*)?$|^records?\s*[:=].*$|^report\s+generated\b|^generated\s+(?:on|at)\b/i.test(
        value.trim()
      )
  );
}

function hasValidPhoneLikeValue(row: string[]): boolean {
  return row.some((value) => {
    const digits = value.replace(/\D/g, '');
    return (
      digits.length >= 7 &&
      digits.length <= 15 &&
      /^[+()\d\s.-]+$/.test(value.trim())
    );
  });
}

function isLikelySecondTableHeader(row: string[]): boolean {
  const knownLabels = row.filter((value) =>
    MEMBER_HEADER_NAMES.has(normalizeImportHeader(value))
  );
  return (
    row.filter(Boolean).length >= 2 &&
    knownLabels.length >= 2 &&
    !hasValidPhoneLikeValue(row)
  );
}

function looksLikeStandaloneReportTitle(row: string[]): boolean {
  const populated = row.filter(Boolean);
  return (
    populated.length === 1 &&
    /\b(?:report|export|summary|generated)\b/i.test(populated[0] ?? '')
  );
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function sourceTooLargeMessage(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const budget = (
    MEMBER_IMPORT_DRAFT_SOURCE_BUDGET_BYTES /
    (1024 * 1024)
  ).toFixed(1);
  return `This member table normalizes to ${mb} MB. Resumable imports reserve space for review decisions and support up to ${budget} MB of normalized source data (${MEMBER_IMPORT_DRAFT_MAX_STATE_BYTES / (1024 * 1024)} MB draft limit). Split the report into smaller files and import them one at a time.`;
}

/**
 * Normalize one bounded member-table report. This intentionally accepts one
 * table only: it does not infer joins between report sections or worksheets.
 */
export function normalizeMemberImportSource(
  name: string,
  records: unknown[][]
): MemberImportNormalizedSource {
  const widestRow = records.reduce<number>(
    (largest, row) =>
      Math.max(
        largest,
        row.reduce<number>(
          (width, value, column) =>
            cellText(value) ? Math.max(width, column + 1) : width,
          0
        )
      ),
    0
  );
  if (widestRow > MAX_MEMBER_IMPORT_SOURCE_COLUMNS) {
    throw new MemberImportSourceError(
      `“${name}” has ${widestRow} columns. The limit is ${MAX_MEMBER_IMPORT_SOURCE_COLUMNS}.`
    );
  }
  const excludedRows: MemberImportExcludedSourceRow[] = [];
  let headerIndex = -1;
  let headers: string[] | null = null;

  for (
    let index = 0;
    index < Math.min(records.length, MAX_HEADER_SCAN_ROWS);
    index++
  ) {
    const row = records[index] ?? [];
    const width = row.reduce<number>(
      (largest, value, column) =>
        cellText(value) ? Math.max(largest, column + 1) : largest,
      0
    );
    const values = tableRow(row, width);
    const duplicate = duplicateHeaderIssue(values);
    const canUseManualHeader =
      index === 0 &&
      values.some(Boolean) &&
      !looksLikeStandaloneReportTitle(values);
    if (!hasSupportedPhoneHeader(values) && !canUseManualHeader) {
      excludedRows.push({
        sourceRow: index + 1,
        reason: 'leading_row',
        values,
      });
      continue;
    }
    if (duplicate) {
      throw new MemberImportSourceError(
        `“${name}” ${duplicate}. Rename one of the duplicate columns before importing.`
      );
    }
    headerIndex = index;
    headers = values;
    break;
  }

  if (headerIndex < 0 || !headers) {
    throw new MemberImportSourceError(
      `“${name}” does not contain a supported member table header row in its first ${MAX_HEADER_SCAN_ROWS} rows. Include a Phone, Mobile, Contact, WhatsApp, or Cell column, then try again.`
    );
  }
  if (headers.length > MAX_MEMBER_IMPORT_SOURCE_COLUMNS) {
    throw new MemberImportSourceError(
      `“${name}” has ${headers.length} columns. The limit is ${MAX_MEMBER_IMPORT_SOURCE_COLUMNS}.`
    );
  }

  const rows: string[][] = [];
  const sourceRows: number[] = [];
  for (let index = headerIndex + 1; index < records.length; index++) {
    const sourceRow = index + 1;
    const original = records[index] ?? [];
    const width = original.reduce<number>(
      (largest, value, column) =>
        cellText(value) ? Math.max(largest, column + 1) : largest,
      0
    );
    const values = tableRow(original, Math.max(headers.length, width));
    if (!values.some(Boolean)) {
      excludedRows.push({ sourceRow, reason: 'blank_row', values });
      continue;
    }
    if (
      sameHeader(values.slice(0, headers.length), headers) &&
      !values.slice(headers.length).some(Boolean)
    ) {
      excludedRows.push({ sourceRow, reason: 'repeated_header', values });
      continue;
    }
    if (isLikelySecondTableHeader(values)) {
      throw new MemberImportSourceError(
        `“${name}” contains another member-table header on source row ${sourceRow}. Import each table as a separate file; tables are never joined automatically.`
      );
    }
    if (width > headers.length) {
      throw new MemberImportSourceError(
        `“${name}” has data beyond its ${headers.length}-column header on source row ${sourceRow}. Fix the report shape before importing.`
      );
    }
    const aligned = values.slice(0, headers.length);
    if (isFooterSummary(aligned, headers)) {
      excludedRows.push({
        sourceRow,
        reason: 'footer_summary',
        values: aligned,
      });
      continue;
    }
    rows.push(aligned);
    sourceRows.push(sourceRow);
  }

  if (rows.length === 0) {
    throw new MemberImportSourceError(
      `“${name}” has a member-table header but no member data.`
    );
  }
  if (rows.length > MAX_MEMBER_IMPORT_SOURCE_ROWS) {
    throw new MemberImportSourceError(
      `“${name}” has ${rows.length} member rows. The limit is ${MAX_MEMBER_IMPORT_SOURCE_ROWS}. Split the report into smaller files.`
    );
  }

  const raw = { headers, rows };
  const normalizedBytes = utf8Bytes({
    raw,
    sourceRows,
    headerRow: headerIndex + 1,
    excludedRows,
  });
  if (normalizedBytes > MEMBER_IMPORT_DRAFT_SOURCE_BUDGET_BYTES) {
    throw new MemberImportSourceError(sourceTooLargeMessage(normalizedBytes));
  }
  return {
    raw,
    sourceRows,
    headerRow: headerIndex + 1,
    excludedRows,
    normalizedBytes,
  };
}

export function normalizeMemberImportCsv(
  name: string,
  text: string
): MemberImportNormalizedSource {
  return normalizeMemberImportSource(name, parseCsvRecords(text));
}

/** Stable key used in candidates, receipts and durable retry payloads. */
export function memberImportSourceKey(
  sheetName: string,
  sourceRow: number
): string {
  return `${sheetName}:${sourceRow}`;
}
