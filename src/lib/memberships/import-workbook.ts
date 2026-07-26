import type { RawCsv } from '@/lib/contacts/field-mapping';

export const MAX_IMPORT_WORKBOOK_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_SHEET_ROWS = 5_000;
export const MAX_IMPORT_SHEET_COLUMNS = 100;

export type MemberImportFileKind = 'csv' | 'xlsx';

export interface MemberImportSheet {
  name: string;
  raw: RawCsv | null;
  rowCount: number;
  columnCount: number;
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

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ''
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return String(value).trim();
}

function nonEmptyWidth(row: unknown[]): number {
  for (let index = row.length - 1; index >= 0; index--) {
    if (cellText(row[index])) return index + 1;
  }
  return 0;
}

/**
 * Converts one Excel worksheet to the same header + string-row contract used
 * by the existing CSV member import. Formatting and formulas are deliberately
 * left behind; the mapped preview remains the editing surface.
 */
export function normalizeMemberImportSheet(
  name: string,
  data: unknown[][]
): MemberImportSheet {
  const columnCount = data.reduce(
    (largest, row) => Math.max(largest, nonEmptyWidth(row)),
    0
  );
  const dataRows = data
    .slice(1)
    .filter((row) => row.some((cell) => cellText(cell)));
  const rowCount = dataRows.length;

  if (columnCount > MAX_IMPORT_SHEET_COLUMNS) {
    return {
      name,
      raw: null,
      rowCount,
      columnCount,
      error: `“${name}” has ${columnCount} columns. The limit is ${MAX_IMPORT_SHEET_COLUMNS}.`,
    };
  }
  if (rowCount > MAX_IMPORT_SHEET_ROWS) {
    return {
      name,
      raw: null,
      rowCount,
      columnCount,
      error: `“${name}” has ${rowCount} data rows. The limit is ${MAX_IMPORT_SHEET_ROWS}.`,
    };
  }

  const headers = Array.from({ length: columnCount }, (_, column) =>
    cellText(data[0]?.[column])
  );
  if (headers.length === 0 || !headers.some(Boolean)) {
    return {
      name,
      raw: null,
      rowCount,
      columnCount,
      error: `“${name}” does not have a header row.`,
    };
  }
  if (rowCount === 0) {
    return {
      name,
      raw: null,
      rowCount,
      columnCount,
      error: `“${name}” has a header row but no member data.`,
    };
  }

  return {
    name,
    raw: {
      headers,
      rows: dataRows.map((row) =>
        Array.from({ length: columnCount }, (_, column) =>
          cellText(row[column])
        )
      ),
    },
    rowCount,
    columnCount,
    error: null,
  };
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
