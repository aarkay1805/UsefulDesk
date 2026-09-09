import type { RawCsv } from '@/lib/contacts/field-mapping';
import {
  MAX_MEMBER_IMPORT_SOURCE_COLUMNS,
  MAX_MEMBER_IMPORT_SOURCE_ROWS,
  MemberImportSourceError,
  normalizeMemberImportSource,
  type MemberImportExcludedSourceRow,
} from './import-source';

export const MAX_IMPORT_WORKBOOK_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_SHEET_ROWS = MAX_MEMBER_IMPORT_SOURCE_ROWS;
export const MAX_IMPORT_SHEET_COLUMNS = MAX_MEMBER_IMPORT_SOURCE_COLUMNS;

export type MemberImportFileKind = 'csv' | 'xlsx';

export interface MemberImportSheet {
  name: string;
  raw: RawCsv | null;
  rowCount: number;
  columnCount: number;
  /** One-based worksheet row for each row in `raw.rows`. */
  sourceRows: number[];
  /** One-based worksheet row containing the selected table header. */
  headerRow: number | null;
  excludedRows: MemberImportExcludedSourceRow[];
  normalizedBytes: number;
  error: string | null;
}

export class MemberImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberImportFileError';
  }
}

export function memberImportFileKind(
  filename: string
): MemberImportFileKind | null {
  const extension = filename.trim().toLowerCase().split('.').pop();
  if (extension === 'csv') return 'csv';
  if (extension === 'xlsx') return 'xlsx';
  return null;
}

/**
 * Converts one explicitly-selected Excel worksheet to the common bounded
 * report-table contract. The adapter deliberately supports one table only;
 * titles, blank records, repeated headings and known report footers are
 * tracked without changing the source-row identity of member rows.
 */
export function normalizeMemberImportSheet(
  name: string,
  data: unknown[][]
): MemberImportSheet {
  try {
    const normalized = normalizeMemberImportSource(name, data);
    return {
      name,
      raw: normalized.raw,
      rowCount: normalized.raw.rows.length,
      columnCount: normalized.raw.headers.length,
      sourceRows: normalized.sourceRows,
      headerRow: normalized.headerRow,
      excludedRows: normalized.excludedRows,
      normalizedBytes: normalized.normalizedBytes,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof MemberImportSourceError
        ? error.message
        : `“${name}” could not be normalized.`;
    return {
      name,
      raw: null,
      rowCount: 0,
      columnCount: 0,
      sourceRows: [],
      headerRow: null,
      excludedRows: [],
      normalizedBytes: 0,
      error: message,
    };
  }
}

export async function parseMemberImportWorkbook(
  file: File
): Promise<MemberImportSheet[]> {
  if (file.size > MAX_IMPORT_WORKBOOK_BYTES) {
    throw new MemberImportFileError(
      `Excel workbooks must be ${MAX_IMPORT_WORKBOOK_BYTES / (1024 * 1024)} MB or smaller.`
    );
  }

  try {
    // Keep the workbook parser out of the normal Members bundle and CSV path.
    const { default: readWorkbook } = await import('read-excel-file/browser');
    const workbook = await readWorkbook(file);
    if (workbook.length === 0) {
      throw new MemberImportFileError(
        'This Excel workbook does not contain any worksheets.'
      );
    }
    return workbook.map((sheet) =>
      normalizeMemberImportSheet(sheet.sheet, sheet.data)
    );
  } catch (error) {
    if (error instanceof MemberImportFileError) throw error;
    throw new MemberImportFileError(
      'Could not read this Excel workbook. Make sure it is a valid, unprotected .xlsx file.'
    );
  }
}
