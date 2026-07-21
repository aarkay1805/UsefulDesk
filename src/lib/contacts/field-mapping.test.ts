import { describe, expect, it } from 'vitest';
import {
  applyMapping,
  autoMapColumns,
  buildLeadTargets,
  buildTargets,
  coerceCustomValue,
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

  it('handles BOM, CRLF, and embedded newlines in quoted notes', () => {
    const parsed = parseCsvRaw(
      '\uFEFFPhone,Notes\r\n+9199,"First line\r\nSecond line"\r\n'
    );
    expect(parsed.headers).toEqual(['Phone', 'Notes']);
    expect(parsed.rows).toEqual([['+9199', 'First line\r\nSecond line']]);
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

  it('normalizes camelCase and punctuation for target aliases', () => {
    const targets = [
      {
        key: 'expiry',
        label: 'Expiry',
        kind: 'member' as const,
        required: false,
        synonyms: ['valid until'],
      },
    ];
    expect(autoMapColumns(['validUntil'], targets)).toEqual(['expiry']);
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

describe('lead targets (buildLeadTargets)', () => {
  it('adds the four lead fields; contacts targets stay unchanged', () => {
    const leadKeys = buildLeadTargets([]).map((t) => t.key);
    expect(leadKeys).toEqual([
      'phone',
      'name',
      'email',
      'company',
      'lead_status',
      'source',
      'gender',
      'assignee',
      'tags',
    ]);
    expect(buildTargets([]).map((t) => t.key)).toEqual([
      'phone',
      'name',
      'email',
      'company',
      'tags',
    ]);
  });

  it('auto-maps lead-field header synonyms', () => {
    const targets = buildLeadTargets([]);
    expect(
      autoMapColumns(
        ['Phone', 'Lead Status', 'Lead Source', 'Sex', 'Assigned To'],
        targets
      )
    ).toEqual(['phone', 'lead_status', 'source', 'gender', 'assignee']);
  });

  it('carries raw lead-field cells onto MappedRow', () => {
    const { rows } = applyMapping(
      {
        headers: ['Phone', 'Status', 'Source', 'Gender', 'Owner'],
        rows: [['+111', 'Not Interested', 'Insta', 'F', 'Mohit']],
      },
      ['phone', 'lead_status', 'source', 'gender', 'assignee']
    );
    expect(rows[0]).toMatchObject({
      leadStatus: 'Not Interested',
      source: 'Insta',
      gender: 'F',
      assignedTo: 'Mohit',
    });
  });
});

describe('date-order coercion', () => {
  it('reads slash dates by the given order', () => {
    expect(coerceCustomValue('02/07/2026', 'date', 'DMY')).toBe('2026-07-02');
    expect(coerceCustomValue('02/07/2026', 'date', 'MDY')).toBe('2026-02-07');
    expect(coerceCustomValue('28/06/26', 'date', 'DMY')).toBe('2026-06-28');
  });

  it('swaps when the chosen order is impossible for the value', () => {
    // 28 can't be a month — DMY-invalid input still lands on the real date.
    expect(coerceCustomValue('28/06/2026', 'date', 'MDY')).toBe('2026-06-28');
  });

  it('rejects impossible dates and keeps ISO untouched', () => {
    expect(coerceCustomValue('31/02/2026', 'date', 'DMY')).toBeNull();
    expect(coerceCustomValue('2026-07-02', 'date', 'DMY')).toBe('2026-07-02');
  });
});

describe('coerceCustomValue', () => {
  it('text passes through trimmed', () => {
    expect(coerceCustomValue('  hi  ', 'text')).toBe('hi');
    expect(coerceCustomValue('', 'text')).toBeNull();
  });

  it('number strips separators and normalizes', () => {
    expect(coerceCustomValue('1,234.50', 'number')).toBe('1234.5');
    expect(coerceCustomValue('-42', 'number')).toBe('-42');
    expect(coerceCustomValue('abc', 'number')).toBeNull();
  });

  it('email validates and lowercases', () => {
    expect(coerceCustomValue('Foo@Bar.COM', 'email')).toBe('foo@bar.com');
    expect(coerceCustomValue('nope', 'email')).toBeNull();
  });

  it('url adds scheme and validates host', () => {
    expect(coerceCustomValue('example.com', 'url')).toBe(
      'https://example.com/'
    );
    expect(coerceCustomValue('http://a.io/x', 'url')).toBe('http://a.io/x');
    expect(coerceCustomValue('notaurl', 'url')).toBeNull();
  });

  it('phone requires enough digits, keeps input', () => {
    expect(coerceCustomValue('+1 (555) 123-4567', 'phone')).toBe(
      '+1 (555) 123-4567'
    );
    expect(coerceCustomValue('123', 'phone')).toBeNull();
  });

  it('date normalizes to ISO', () => {
    expect(coerceCustomValue('2024-03-04', 'date')).toBe('2024-03-04');
    expect(coerceCustomValue('garbage', 'date')).toBeNull();
  });
});

describe('applyMapping with types', () => {
  it('drops values that fail their field type and counts them', () => {
    const raw = {
      headers: ['Phone', 'Score'],
      rows: [
        ['+111', '42'],
        ['+222', 'oops'],
      ],
    };
    const types = new Map([['cf1', 'number']]);
    const { rows, invalidCustomValues } = applyMapping(
      raw,
      ['phone', 'custom:cf1'],
      types
    );
    expect(rows[0].customValues).toEqual([{ fieldId: 'cf1', value: '42' }]);
    expect(rows[1].customValues).toEqual([]);
    expect(invalidCustomValues).toBe(1);
  });
});

describe('customFieldId', () => {
  it('extracts the id from a custom target key', () => {
    expect(customFieldId('custom:abc')).toBe('abc');
    expect(customFieldId('phone')).toBeNull();
  });
});
