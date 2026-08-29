import { describe, expect, it } from 'vitest';

import {
  memberTableRecordRange,
  nextMemberColumnSort,
} from './member-table-view';

describe('All Members table view behavior', () => {
  it('activates a new column sort and clears the active direction when picked again', () => {
    expect(nextMemberColumnSort(null, 'contact_name', 'asc')).toEqual({
      key: 'contact_name',
      dir: 'asc',
    });
    expect(
      nextMemberColumnSort(
        { key: 'contact_name', dir: 'asc' },
        'contact_name',
        'asc'
      )
    ).toBeNull();
  });

  it('keeps a sort active when its column or direction changes', () => {
    expect(
      nextMemberColumnSort(
        { key: 'contact_name', dir: 'asc' },
        'contact_name',
        'desc'
      )
    ).toEqual({ key: 'contact_name', dir: 'desc' });
    expect(
      nextMemberColumnSort(
        { key: 'contact_name', dir: 'desc' },
        'display_expiry',
        'desc'
      )
    ).toEqual({ key: 'display_expiry', dir: 'desc' });
  });

  it('reports accurate one-based ranges for full, partial, and empty pages', () => {
    expect(memberTableRecordRange(60, 0, 25)).toEqual({ start: 1, end: 25 });
    expect(memberTableRecordRange(60, 2, 25)).toEqual({ start: 51, end: 60 });
    expect(memberTableRecordRange(0, 0, 25)).toBeNull();
    expect(memberTableRecordRange(25, 1, 25)).toBeNull();
  });
});
