import { describe, expect, it } from 'vitest';

import {
  activeFollowUpFilterCount,
  applyFollowUpFilters,
  EMPTY_FOLLOW_UP_FILTERS,
  followUpDueOrClause,
  UNASSIGNED_FOLLOW_UP,
} from './follow-up-filters';

const TODAY = '2026-07-18';

describe('followUpDueOrClause', () => {
  it('returns null when no due bucket is selected', () => {
    expect(followUpDueOrClause([], TODAY)).toBeNull();
  });

  it('maps every bucket to the account-day boundary', () => {
    expect(followUpDueOrClause(['overdue', 'today', 'upcoming'], TODAY)).toBe(
      'due_date.lt.2026-07-18,due_date.eq.2026-07-18,due_date.gt.2026-07-18'
    );
  });
});

describe('applyFollowUpFilters', () => {
  function stub() {
    const calls: [string, unknown][] = [];
    const query = {
      calls,
      in(column: string, values: readonly string[]) {
        calls.push(['in', { column, values }]);
        return query;
      },
      is(column: string, value: null) {
        calls.push(['is', { column, value }]);
        return query;
      },
      or(filters: string) {
        calls.push(['or', filters]);
        return query;
      },
    };
    return query;
  }

  it('does not constrain an empty filter state', () => {
    const query = stub();
    applyFollowUpFilters(query, EMPTY_FOLLOW_UP_FILTERS, TODAY);
    expect(query.calls).toEqual([]);
  });

  it('applies reason, assignee, and due facets', () => {
    const query = stub();
    applyFollowUpFilters(
      query,
      {
        reasons: ['renewal', 'payment'],
        assignees: ['user-1'],
        buckets: ['overdue', 'today'],
      },
      TODAY
    );
    expect(query.calls).toEqual([
      ['in', { column: 'reason', values: ['renewal', 'payment'] }],
      ['in', { column: 'assigned_to', values: ['user-1'] }],
      ['or', 'due_date.lt.2026-07-18,due_date.eq.2026-07-18'],
    ]);
  });

  it('can include named owners and unassigned tasks together', () => {
    const query = stub();
    applyFollowUpFilters(
      query,
      {
        ...EMPTY_FOLLOW_UP_FILTERS,
        assignees: [UNASSIGNED_FOLLOW_UP, 'user-1', 'user-2'],
      },
      TODAY
    );
    expect(query.calls).toEqual([
      ['or', 'assigned_to.is.null,assigned_to.in.(user-1,user-2)'],
    ]);
  });

  it('filters only unassigned tasks', () => {
    const query = stub();
    applyFollowUpFilters(
      query,
      {
        ...EMPTY_FOLLOW_UP_FILTERS,
        assignees: [UNASSIGNED_FOLLOW_UP],
      },
      TODAY
    );
    expect(query.calls).toEqual([
      ['is', { column: 'assigned_to', value: null }],
    ]);
  });
});

describe('activeFollowUpFilterCount', () => {
  it('counts groups rather than individual choices', () => {
    expect(activeFollowUpFilterCount(EMPTY_FOLLOW_UP_FILTERS)).toBe(0);
    expect(
      activeFollowUpFilterCount({
        buckets: ['overdue', 'today'],
        reasons: ['renewal'],
        assignees: [],
      })
    ).toBe(2);
  });
});
