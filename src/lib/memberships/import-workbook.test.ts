import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_IMPORT_SHEET_COLUMNS,
  MAX_IMPORT_SHEET_ROWS,
  MAX_IMPORT_WORKBOOK_BYTES,
  MemberImportFileError,
  memberImportFileKind,
  normalizeMemberImportSheet,
  parseMemberImportWorkbook,
} from './import-workbook';
import readWorkbook from 'read-excel-file/browser';

vi.mock('read-excel-file/browser', () => ({
  default: vi.fn(),
}));

describe('memberImportFileKind', () => {
  it('accepts CSV and XLSX case-insensitively', () => {
    expect(memberImportFileKind('members.csv')).toBe('csv');
    expect(memberImportFileKind('MEMBERS.XLSX')).toBe('xlsx');
  });

  it('rejects legacy and unrelated formats', () => {
    expect(memberImportFileKind('members.xls')).toBeNull();
    expect(memberImportFileKind('members.xlsm')).toBeNull();
    expect(memberImportFileKind('members.pdf')).toBeNull();
  });
});

describe('normalizeMemberImportSheet', () => {
  it('normalizes typed cells into the existing string table contract', () => {
    expect(
      normalizeMemberImportSheet('Members', [
        ['Phone', 'Name', 'Joined', 'Paid', 'Active'],
        [9876543210, ' Asha ', new Date('2026-07-26T00:00:00Z'), 1500, true],
        [null, null, null, null, null],
      ])
    ).toEqual({
      name: 'Members',
      raw: {
        headers: ['Phone', 'Name', 'Joined', 'Paid', 'Active'],
        rows: [['9876543210', 'Asha', '2026-07-26', '1500', 'true']],
      },
      rowCount: 1,
      columnCount: 5,
      error: null,
    });
  });

  it('keeps unnamed columns aligned and removes only trailing blank columns', () => {
    const sheet = normalizeMemberImportSheet('Members', [
      ['Phone', '', 'Plan'],
      ['9876543210', 'Asha', 'Gold'],
    ]);
    expect(sheet.raw?.headers).toEqual(['Phone', '', 'Plan']);
    expect(sheet.raw?.rows).toEqual([['9876543210', 'Asha', 'Gold']]);
  });

  it('marks empty and header-only sheets unavailable', () => {
    expect(normalizeMemberImportSheet('Empty', []).error).toContain(
      'header row'
    );
    expect(
      normalizeMemberImportSheet('Headers', [['Phone', 'Plan']]).error
    ).toContain('no member data');
  });

  it('marks overly tall and wide sheets unavailable', () => {
    const tall = [
      ['Phone'],
      ...Array.from({ length: MAX_IMPORT_SHEET_ROWS + 1 }, () => ['1']),
    ];
    const wide = [
      Array.from({ length: MAX_IMPORT_SHEET_COLUMNS + 1 }, (_, index) =>
        String(index)
      ),
      ['1'],
    ];
    expect(normalizeMemberImportSheet('Tall', tall).error).toContain(
      `${MAX_IMPORT_SHEET_ROWS + 1}`
    );
    expect(normalizeMemberImportSheet('Wide', wide).error).toContain(
      `${MAX_IMPORT_SHEET_COLUMNS + 1}`
    );
  });
});

describe('parseMemberImportWorkbook', () => {
  beforeEach(() => {
    vi.mocked(readWorkbook).mockReset();
  });

  it('returns every worksheet so the UI can require a choice', async () => {
    vi.mocked(readWorkbook).mockResolvedValue([
      {
        sheet: 'Active',
        data: [
          ['Phone', 'Plan'],
          ['9876543210', 'Gold'],
        ],
      },
      {
        sheet: 'Archive',
        data: [
          ['Phone', 'Plan'],
          ['9123456780', 'Silver'],
        ],
      },
    ]);

    const result = await parseMemberImportWorkbook({
      name: 'members.xlsx',
      size: 1024,
    } as File);
    expect(result.map((sheet) => sheet.name)).toEqual(['Active', 'Archive']);
    expect(result[1].raw?.rows[0]).toEqual(['9123456780', 'Silver']);
  });

  it('rejects oversized and invalid workbooks with user-facing errors', async () => {
    await expect(
      parseMemberImportWorkbook({
        name: 'huge.xlsx',
        size: MAX_IMPORT_WORKBOOK_BYTES + 1,
      } as File)
    ).rejects.toThrow(MemberImportFileError);

    vi.mocked(readWorkbook).mockRejectedValue(new Error('bad zip'));
    await expect(
      parseMemberImportWorkbook({
        name: 'broken.xlsx',
        size: 1024,
      } as File)
    ).rejects.toThrow('valid, unprotected .xlsx');
  });
});
