import { describe, expect, it } from 'vitest';
import {
  applyMapping,
  autoMapColumns,
  buildTargets,
  customFieldId,
  IGNORE_KEY,
  parseCsvRaw,
  validateMapping,
} from './field-mapping';

const CUSTOM = [
  { id: 'cf1', field_name: 'Industry' },
  { id: 'cf2', field_name: 'Lead Source' },
];

describe('parseCsvRaw', () => {
  it('splits headers and rows aligned to columns', () => {
    const { headers, rows } = parseCsvRaw('Phone,Name\n+123,Alice\n+456,Bob');
    expect(headers).toEqual(['Phone', 'Name']);
    expect(rows).toEqual([
      ['+123', 'Alice'],
      ['+456', 'Bob'],
    ]);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const { rows } = parseCsvRaw('a,b\n"x,y","he said ""hi"""');
    expect(rows[0]).toEqual(['x,y', 'he said "hi"']);
  });

  it('skips blank lines and returns empty for headerless input', () => {
    expect(parseCsvRaw('').headers).toEqual([]);
    const { rows } = parseCsvRaw('Phone\n\n+1\n\n');
    expect(rows).toEqual([['+1']]);
  });
});

describe('autoMapColumns', () => {
  it('matches standard synonyms case-insensitively', () => {
    const targets = buildTargets([]);
    expect(autoMapColumns(['Mobile', 'Full Name', 'E-Mail'], targets)).toEqual([
      'phone',
      'name',
      'email',
    ]);
  });

  it('matches custom fields by exact name and tags column', () => {
    const targets = buildTargets(CUSTOM);
    expect(
      autoMapColumns(['phone', 'Industry', 'tags', 'Unknown'], targets)
    ).toEqual(['phone', 'custom:cf1', 'tags', IGNORE_KEY]);
  });

  it('assigns each target to only the first matching column', () => {
    const targets = buildTargets([]);
    // Two phone-like columns: second falls through to ignore.
    expect(autoMapColumns(['phone', 'mobile'], targets)).toEqual([
      'phone',
      IGNORE_KEY,
    ]);
  });
});

describe('validateMapping', () => {
  it('requires a phone column', () => {
    expect(validateMapping(['name', 'email']).ok).toBe(false);
    expect(validateMapping(['phone', 'name']).ok).toBe(true);
  });

  it('flags a target assigned to two columns', () => {
    const result = validateMapping(['phone', 'name', 'name']);
    expect(result.duplicateTargets).toEqual(['name']);
    expect(result.ok).toBe(false);
  });

  it('ignores IGNORE_KEY duplicates', () => {
    expect(validateMapping(['phone', IGNORE_KEY, IGNORE_KEY]).ok).toBe(true);
  });
});

describe('applyMapping', () => {
  const raw = {
    headers: ['Phone', 'Name', 'Segment', 'Labels'],
    rows: [
      ['+111', 'Alice', 'SaaS', 'VIP, Lead'],
      ['', 'NoPhone', 'X', 'Y'],
      ['+222', 'Bob', '', ''],
    ],
  };

  it('maps standard, custom, and tag columns; drops empty-phone rows', () => {
    const mapping = ['phone', 'name', 'custom:cf1', 'tags'];
    const { rows, droppedNoPhone } = applyMapping(raw, mapping);

    expect(droppedNoPhone).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      phone: '+111',
      name: 'Alice',
      email: undefined,
      company: undefined,
      tagNames: ['VIP', 'Lead'],
      customValues: [{ fieldId: 'cf1', value: 'SaaS' }],
    });
    // Bob has no segment/tags → no custom values, empty tags.
    expect(rows[1].customValues).toEqual([]);
    expect(rows[1].tagNames).toEqual([]);
  });

  it('ignores unmapped columns', () => {
    const mapping = ['phone', IGNORE_KEY, IGNORE_KEY, IGNORE_KEY];
    const { rows } = applyMapping(raw, mapping);
    expect(rows[0]).toMatchObject({ phone: '+111', name: undefined });
  });
});

describe('customFieldId', () => {
  it('extracts the id from a custom target key', () => {
    expect(customFieldId('custom:abc')).toBe('abc');
    expect(customFieldId('phone')).toBeNull();
  });
});
