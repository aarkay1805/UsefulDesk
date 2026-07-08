import { describe, expect, it } from 'vitest';
import {
  applyValueFix,
  buildPreviewRows,
  coerceAssignee,
  coerceOptionValue,
  detectDateOrder,
  detectFieldType,
  fuzzyMatchOption,
  unmatchedValues,
  PENDING_ASSIGNEE_PREFIX,
  type PreviewRow,
} from './import-coerce';
import type { MappedRow } from '@/lib/contacts/field-mapping';

const STATUSES = [
  { key: 'new', label: 'New', color: '#3b82f6' },
  { key: 'contacted', label: 'Contacted', color: '#eab308' },
  { key: 'interested', label: 'Interested', color: '#f97316' },
  { key: 'trial_booked', label: 'Trial Booked', color: '#22c55e' },
  { key: 'lost', label: 'Lost', color: '#64748b' },
];

const SOURCES = [
  { key: 'walk_in', label: 'Walk-in' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
];

const GENDERS = [
  { key: 'male', label: 'Male' },
  { key: 'female', label: 'Female' },
];

const STAFF = [
  { user_id: 'u1', full_name: 'Aakash Mishra' },
  { user_id: 'u2', full_name: 'Mohit' },
  { user_id: 'u3', full_name: 'Aryan Saini' },
];

function row(over: Partial<MappedRow>): MappedRow {
  return { phone: '9876543210', tagNames: [], customValues: [], ...over };
}

describe('coerceOptionValue', () => {
  it('matches exact keys and case-insensitive labels', () => {
    expect(coerceOptionValue('trial_booked', STATUSES).key).toBe('trial_booked');
    expect(coerceOptionValue('TRIAL BOOKED', STATUSES)).toEqual({
      key: 'trial_booked',
      matched: true,
    });
    expect(coerceOptionValue('walk-in', SOURCES).key).toBe('walk_in');
  });

  it('resolves single-letter shorthands when unambiguous', () => {
    expect(coerceOptionValue('F', GENDERS)).toEqual({
      key: 'female',
      matched: true,
    });
    expect(coerceOptionValue('m', GENDERS).key).toBe('male');
    // Ambiguous initial (two labels start with the letter) stays unmatched.
    const clash = [
      { key: 'monthly', label: 'Monthly' },
      { key: 'mega', label: 'Mega' },
    ];
    expect(coerceOptionValue('m', clash).matched).toBe(false);
  });

  it('slugs unknown values and flags them', () => {
    const out = coerceOptionValue('Not Interested', STATUSES);
    expect(out).toEqual({ key: 'not_interested', matched: false });
    // Slug must not collide with an existing key.
    const out2 = coerceOptionValue('Lost!', STATUSES);
    expect(out2.matched).toBe(false);
    expect(out2.key).not.toBe('lost');
  });
});

describe('fuzzyMatchOption', () => {
  it('matches by containment either way on squashed text', () => {
    expect(fuzzyMatchOption('insta', SOURCES)).toBe('instagram');
    expect(fuzzyMatchOption('Walk in customer', SOURCES)).toBe('walk_in');
  });

  it('returns null for short or ambiguous input', () => {
    expect(fuzzyMatchOption('fb', SOURCES)).toBeNull();
    expect(fuzzyMatchOption('xyz', SOURCES)).toBeNull();
  });
});

describe('coerceAssignee', () => {
  it('matches full names case-insensitively', () => {
    expect(coerceAssignee('aakash mishra', STAFF)).toBe('u1');
  });

  it('matches unique first names / prefixes, else null', () => {
    expect(coerceAssignee('Mohit', STAFF)).toBe('u2');
    expect(coerceAssignee('aakash', STAFF)).toBe('u1');
    expect(coerceAssignee('a', STAFF)).toBeNull(); // Aakash + Aryan
    expect(coerceAssignee('Unknown Person', STAFF)).toBeNull();
  });
});

describe('detectFieldType', () => {
  it('detects dates, emails, numbers and urls', () => {
    expect(detectFieldType('VISITED DATE', ['02/07/2026', '28/06/2026']).type)
      .toBe('date');
    expect(detectFieldType('Mail', ['a@b.com', 'c@d.in']).type).toBe('email');
    expect(detectFieldType('Fee', ['1200', '1,500', '999.50']).type).toBe(
      'number',
    );
    expect(detectFieldType('Site', ['https://x.com', 'www.y.in']).type).toBe(
      'url',
    );
  });

  it('needs a header hint to call digits a phone', () => {
    expect(detectFieldType('Alt Phone', ['9876543210']).type).toBe('phone');
    expect(detectFieldType('Fee', ['9876543210']).type).toBe('number');
  });

  it('falls back to text on mixed data and title-cases the label', () => {
    const out = detectFieldType('VISITED DATE', ['02/07/2026', 'soon', '—']);
    expect(out.type).toBe('text');
    expect(out.label).toBe('Visited Date');
  });
});

describe('detectDateOrder', () => {
  it('reads a >12 part as the disambiguator', () => {
    expect(detectDateOrder(['28/06/2026', '02/07/2026'])).toBe('DMY');
    expect(detectDateOrder(['06/28/2026'])).toBe('MDY');
  });

  it('is ambiguous without evidence or with conflicts', () => {
    expect(detectDateOrder(['02/07/2026', '01/03/2026'])).toBe('ambiguous');
    expect(detectDateOrder(['28/06/2026', '06/28/2026'])).toBe('ambiguous');
    expect(detectDateOrder(['2026-07-02'])).toBe('ambiguous');
  });
});

describe('buildPreviewRows', () => {
  const args = {
    statusOptions: STATUSES,
    sourceOptions: SOURCES,
    genderOptions: GENDERS,
    staff: STAFF,
    existingKeys: new Set(['919812345678']),
  };

  it('coerces lead fields and flags unmatched values', () => {
    const rows = buildPreviewRows({
      ...args,
      rows: [
        row({
          leadStatus: 'Interested',
          source: 'Boxing',
          gender: 'F',
          assignedTo: 'Mohit',
        }),
      ],
    });
    expect(rows[0].leadStatus).toBe('interested');
    expect(rows[0].source).toBe('boxing');
    expect(rows[0].gender).toBe('female');
    expect(rows[0].assignedTo).toBe('u2');
    expect([...rows[0].unmatched]).toEqual(['source']);
  });

  it('marks rows whose phone already exists', () => {
    const rows = buildPreviewRows({
      ...args,
      rows: [row({ phone: '+91 98123 45678' }), row({ phone: '9000000001' })],
    });
    expect(rows[0].exists).toBe(true);
    expect(rows[1].exists).toBe(false);
  });

  it('leaves unmapped fields null without flags', () => {
    const rows = buildPreviewRows({ ...args, rows: [row({})] });
    expect(rows[0].leadStatus).toBeNull();
    expect(rows[0].unmatched.size).toBe(0);
  });
});

describe('unmatchedValues + applyValueFix', () => {
  function unmatchedRows(): PreviewRow[] {
    return buildPreviewRows({
      statusOptions: STATUSES,
      sourceOptions: SOURCES,
      genderOptions: GENDERS,
      staff: STAFF,
      existingKeys: new Set(),
      rows: [
        row({ phone: '1111111111', leadStatus: 'Not Interested' }),
        row({ phone: '2222222222', leadStatus: 'not interested' }),
        row({ phone: '3333333333', leadStatus: 'Ongoing' }),
        row({ phone: '4444444444', leadStatus: 'Interested' }),
      ],
    });
  }

  it('groups distinct unmatched values with row counts (case-insensitive)', () => {
    const values = unmatchedValues(unmatchedRows());
    expect(values).toHaveLength(2);
    const ni = values.find((v) => v.raw.toLowerCase() === 'not interested');
    expect(ni?.count).toBe(2);
    expect(values.find((v) => v.raw === 'Ongoing')?.count).toBe(1);
  });

  it('fixes every row carrying the value, once', () => {
    const fixed = applyValueFix(
      unmatchedRows(),
      'status',
      'Not Interested',
      'lost',
    );
    expect(fixed[0].leadStatus).toBe('lost');
    expect(fixed[1].leadStatus).toBe('lost');
    expect(fixed[0].unmatched.has('status')).toBe(false);
    // Untouched rows pass through unchanged.
    expect(fixed[2].leadStatus).toBe('ongoing');
    expect(fixed[2].unmatched.has('status')).toBe(true);
    expect(fixed[3].leadStatus).toBe('interested');
    expect(unmatchedValues(fixed)).toHaveLength(1);
  });
});

describe('assignee as a fixable value', () => {
  function assigneeRows(): PreviewRow[] {
    // Empty staff roster → every assignee flags unmatched (the false-flag
    // the docked panel now surfaces and lets the user resolve).
    return buildPreviewRows({
      statusOptions: STATUSES,
      sourceOptions: SOURCES,
      genderOptions: GENDERS,
      staff: [],
      existingKeys: new Set(),
      rows: [
        row({ phone: '1', assignedTo: 'Aakash' }),
        row({ phone: '2', assignedTo: 'aakash' }),
        row({ phone: '3', assignedTo: 'Mohit' }),
      ],
    });
  }

  it('groups unmatched assignee names with counts', () => {
    const values = unmatchedValues(assigneeRows());
    const assignees = values.filter((v) => v.field === 'assignee');
    expect(assignees).toHaveLength(2);
    expect(assignees.find((v) => v.raw.toLowerCase() === 'aakash')?.count).toBe(
      2,
    );
  });

  it('resolves an assignee value to a user id, clearing the flag', () => {
    const fixed = applyValueFix(assigneeRows(), 'assignee', 'Aakash', 'u1');
    expect(fixed[0].assignedTo).toBe('u1');
    expect(fixed[1].assignedTo).toBe('u1');
    expect(fixed[0].unmatched.has('assignee')).toBe(false);
    expect(fixed[2].assignedTo).toBeNull(); // Mohit untouched (still flagged)
    expect(fixed[2].unmatched.has('assignee')).toBe(true);
  });

  it('empty key = fall back to importer (assignedTo null, flag cleared)', () => {
    const fixed = applyValueFix(assigneeRows(), 'assignee', 'Mohit', '');
    expect(fixed[2].assignedTo).toBeNull();
    expect(fixed[2].unmatched.has('assignee')).toBe(false);
  });

  it('a pending: key parks the lead on an invite (assignedTo stays null)', () => {
    const fixed = applyValueFix(
      assigneeRows(),
      'assignee',
      'Aakash',
      `${PENDING_ASSIGNEE_PREFIX}inv-123`,
    );
    expect(fixed[0].assignedTo).toBeNull();
    expect(fixed[0].pendingInvitationId).toBe('inv-123');
    expect(fixed[0].pendingAssigneeName).toBe('Aakash');
    expect(fixed[0].unmatched.has('assignee')).toBe(false);
    expect(fixed[1].pendingInvitationId).toBe('inv-123'); // same raw, both rows
  });

  it('resolving straight to a real user leaves no pending overlay', () => {
    const direct = applyValueFix(assigneeRows(), 'assignee', 'Mohit', 'u2');
    expect(direct[2].assignedTo).toBe('u2');
    expect(direct[2].pendingInvitationId).toBeNull();
    expect(direct[2].pendingAssigneeName).toBeNull();
  });
});
