import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FIELD_OPTIONS,
  humaniseKey,
  optionLabel,
  resolveFieldOptions,
  slugifyOptionKey,
  statusColumn,
  statusColumns,
  UNKNOWN_STATUS_COLOR,
} from './field-options';

describe('resolveFieldOptions', () => {
  it('falls back to defaults when the account has no rows', () => {
    expect(resolveFieldOptions('status', null)).toBe(
      DEFAULT_FIELD_OPTIONS.status,
    );
    expect(resolveFieldOptions('source', [])).toBe(
      DEFAULT_FIELD_OPTIONS.source,
    );
  });

  it('uses saved rows when present', () => {
    const rows = [{ key: 'hot', label: 'Hot', color: '#ef4444' }];
    expect(resolveFieldOptions('status', rows)).toBe(rows);
  });

  it("default statuses exclude the 'new' pseudo-status", () => {
    expect(DEFAULT_FIELD_OPTIONS.status.map((s) => s.key)).toEqual([
      'contacted',
      'interested',
      'trial_booked',
      'lost',
    ]);
  });
});

describe('statusColumns / statusColumn', () => {
  const columns = statusColumns([
    { key: 'hot', label: 'Hot', color: '#ef4444' },
    { key: 'cold', label: 'Cold', color: null },
  ]);

  it("always puts the fixed 'new' NULL bucket first", () => {
    expect(columns[0].key).toBe('new');
    expect(columns.map((c) => c.key)).toEqual(['new', 'hot', 'cold']);
  });

  it('fills missing colours with the muted fallback', () => {
    expect(columns[2].color).toBe(UNKNOWN_STATUS_COLOR);
  });

  it('resolves stored keys, NULL, and unknown legacy keys safely', () => {
    expect(statusColumn(columns, 'hot').label).toBe('Hot');
    expect(statusColumn(columns, null).key).toBe('new');
    const gone = statusColumn(columns, 'trial_booked');
    expect(gone.label).toBe('Trial booked');
    expect(gone.color).toBe(UNKNOWN_STATUS_COLOR);
  });
});

describe('optionLabel', () => {
  const sources = [{ key: 'walk_in', label: 'Walk-in' }];

  it('maps known keys, echoes unknown values, dashes empties', () => {
    expect(optionLabel(sources, 'walk_in')).toBe('Walk-in');
    expect(optionLabel(sources, 'billboard')).toBe('billboard');
    expect(optionLabel(sources, null)).toBe('—');
  });
});

describe('humaniseKey', () => {
  it('turns slugs into readable labels', () => {
    expect(humaniseKey('trial_booked')).toBe('Trial booked');
    expect(humaniseKey('walk-in')).toBe('Walk in');
  });
});

describe('slugifyOptionKey', () => {
  it('slugs labels and strips punctuation', () => {
    expect(slugifyOptionKey('Walk-in / Referral', [])).toBe(
      'walk_in_referral',
    );
  });

  it('appends a numeric suffix on collision', () => {
    expect(slugifyOptionKey('Hot', ['hot'])).toBe('hot_2');
    expect(slugifyOptionKey('Hot', ['hot', 'hot_2'])).toBe('hot_3');
  });

  it('never returns an empty key', () => {
    expect(slugifyOptionKey('!!!', [])).toBe('option');
  });
});
