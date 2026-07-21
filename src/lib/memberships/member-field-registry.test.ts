import { describe, expect, it } from 'vitest';

import {
  MEMBER_IMPORT_FIELD_BY_KEY,
  MEMBER_TABLE_COLUMNS,
} from './member-field-registry';

describe('member field registry', () => {
  it('keeps every All Members data column connected to import fields', () => {
    for (const column of MEMBER_TABLE_COLUMNS) {
      if (column.importPolicy.kind !== 'fields') continue;
      expect(column.importPolicy.fields.length).toBeGreaterThan(0);
      for (const key of column.importPolicy.fields) {
        expect(MEMBER_IMPORT_FIELD_BY_KEY.has(key)).toBe(true);
      }
    }
  });

  it('allows only database-generated IDs and UI actions to opt out', () => {
    const exceptions = MEMBER_TABLE_COLUMNS.filter(
      (column) => column.importPolicy.kind !== 'fields'
    ).map((column) => [column.key, column.importPolicy.kind]);
    expect(exceptions).toEqual([
      ['memberId', 'generated'],
      ['reminder', 'action'],
    ]);
  });
});
