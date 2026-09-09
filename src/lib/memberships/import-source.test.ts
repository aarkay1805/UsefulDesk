import { describe, expect, it } from 'vitest';

import {
  MAX_MEMBER_IMPORT_SOURCE_ROWS,
  MemberImportSourceError,
  memberImportSourceKey,
  normalizeMemberImportCsv,
  normalizeMemberImportSource,
} from './import-source';
import { MEMBER_IMPORT_DRAFT_SOURCE_BUDGET_BYTES } from './import-draft';

describe('member import report source adapter', () => {
  it('accepts one titled report table and preserves original row numbers', () => {
    const normalized = normalizeMemberImportSource('August report', [
      ['August membership report'],
      ['Generated for Main branch'],
      [],
      ['Name', 'Phone', 'Plan'],
      ['Asha', '9876543210', 'Gold'],
      [],
      ['Name', 'Phone', 'Plan'],
      ['Ravi', '9123456780', 'Silver'],
      ['Number of records: 2'],
    ]);

    expect(normalized.raw).toEqual({
      headers: ['Name', 'Phone', 'Plan'],
      rows: [
        ['Asha', '9876543210', 'Gold'],
        ['Ravi', '9123456780', 'Silver'],
      ],
    });
    expect(normalized.headerRow).toBe(4);
    expect(normalized.sourceRows).toEqual([5, 8]);
    expect(normalized.excludedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceRow: 6, reason: 'blank_row' }),
        expect.objectContaining({ sourceRow: 7, reason: 'repeated_header' }),
        expect.objectContaining({ sourceRow: 9, reason: 'footer_summary' }),
      ])
    );
    expect(memberImportSourceKey('August', normalized.sourceRows[1]!)).toBe(
      'August:8'
    );
  });

  it('retains CSV record positions across blank records and UTF-8 text', () => {
    const normalized = normalizeMemberImportCsv(
      'members.csv',
      '\uFEFFReport title\n\nPhone,Name\n9876543210,Asha 😀\n\n9123456780,Ravi\n'
    );
    expect(normalized.headerRow).toBe(3);
    expect(normalized.sourceRows).toEqual([4, 6]);
    expect(normalized.normalizedBytes).toBeGreaterThan(0);
  });

  it('rejects duplicate headers and additional tables instead of guessing', () => {
    expect(() =>
      normalizeMemberImportSource('duplicates', [
        ['Phone', 'phone'],
        ['9876543210', 'Asha'],
      ])
    ).toThrow('duplicate header');

    expect(() =>
      normalizeMemberImportSource('two tables', [
        ['Phone', 'Name'],
        ['9876543210', 'Asha'],
        ['Phone', 'Plan'],
        ['9123456780', 'Gold'],
      ])
    ).toThrow('separate file');

    expect(() =>
      normalizeMemberImportSource('moved-phone-column', [
        ['Phone', 'Name'],
        ['9876543210', 'Asha'],
        ['Name', 'Phone'],
        ['Ravi', '9123456780'],
      ])
    ).toThrow('separate file');

    expect(() =>
      normalizeMemberImportSource('manual-first-table', [
        ['Legacy number', 'Customer'],
        ['9876543210', 'Asha'],
        ['Phone', 'Name'],
        ['9123456780', 'Ravi'],
      ])
    ).toThrow('separate file');
  });

  it('rejects a report without a supported table header and never truncates', () => {
    expect(() =>
      normalizeMemberImportSource('unknown', [
        ['Member report'],
        ['Asha', 'Gold'],
      ])
    ).toThrow('does not contain a supported member table header');

    expect(() =>
      normalizeMemberImportSource('too many rows', [
        ['Phone', 'Name'],
        ...Array.from(
          { length: MAX_MEMBER_IMPORT_SOURCE_ROWS + 1 },
          (_, index) => [`98765${index}`, 'Asha']
        ),
      ])
    ).toThrow(MemberImportSourceError);
  });

  it('keeps manual first-row tables and real members whose names contain summary words', () => {
    const manual = normalizeMemberImportSource('manual.csv', [
      ['Legacy number', 'Customer label'],
      ['9876543210', 'Total Fitness'],
    ]);
    expect(manual.raw.headers).toEqual(['Legacy number', 'Customer label']);
    expect(manual.sourceRows).toEqual([2]);

    const phoneOnlyManual = normalizeMemberImportSource('telephone.csv', [
      ['Telephone'],
      ['9876543210'],
    ]);
    expect(phoneOnlyManual.raw).toEqual({
      headers: ['Telephone'],
      rows: [['9876543210']],
    });

    const manualSummary = normalizeMemberImportSource('manual-summary.csv', [
      ['Legacy number', 'Customer label', 'Notes'],
      ['9876543210', 'Asha', 'Total'],
      ['9123456780', 'Ravi', ''],
    ]);
    expect(manualSummary.raw.rows).toEqual([
      ['9876543210', 'Asha', 'Total'],
      ['9123456780', 'Ravi', ''],
    ]);

    const report = normalizeMemberImportSource('members.csv', [
      ['Name', 'Phone'],
      ['Total Fitness', '9876543210'],
      ['Grand Total', ''],
    ]);
    expect(report.raw.rows).toEqual([['Total Fitness', '9876543210']]);
    expect(report.excludedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceRow: 3, reason: 'footer_summary' }),
      ])
    );
  });

  it('does not mistake a phone label in an ordinary data cell for another header', () => {
    const normalized = normalizeMemberImportSource('notes.csv', [
      ['Phone', 'Name', 'Notes'],
      ['9876543210', 'Asha', 'Contact'],
      ['9123456780', 'Ravi', 'Phone'],
    ]);
    expect(normalized.raw.rows).toEqual([
      ['9876543210', 'Asha', 'Contact'],
      ['9123456780', 'Ravi', 'Phone'],
    ]);
  });

  it('preflights normalized source capacity in UTF-8 bytes without truncating', () => {
    expect(() =>
      normalizeMemberImportSource('large.csv', [
        ['Phone', 'Notes'],
        [
          '9876543210',
          '😀'.repeat(Math.ceil(MEMBER_IMPORT_DRAFT_SOURCE_BUDGET_BYTES / 4)),
        ],
      ])
    ).toThrow('Split the report');

    expect(() =>
      normalizeMemberImportSource('large-footer.csv', [
        ['Name', 'Phone'],
        ['Asha', '9876543210'],
        [
          `Report generated ${'😀'.repeat(
            Math.ceil(MEMBER_IMPORT_DRAFT_SOURCE_BUDGET_BYTES / 4)
          )}`,
          '',
        ],
      ])
    ).toThrow('Split the report');
  });
});
