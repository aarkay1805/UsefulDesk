import { describe, expect, it } from 'vitest';

import {
  activeMemberFilterCount,
  applyMemberFilters,
  EMPTY_MEMBER_FILTERS,
  NO_TRAINER_MEMBER_FILTER,
  memberStatusOrClause,
  splitNullableMemberFilterValues,
  UNASSIGNED_MEMBER_FILTER,
} from './filters';

const TODAY = '2026-07-11';

describe('memberStatusOrClause', () => {
  it('returns null when no statuses selected', () => {
    expect(memberStatusOrClause([], TODAY)).toBeNull();
  });

  it('derives active from status + IST day boundary + non-trial', () => {
    expect(memberStatusOrClause(['active'], TODAY)).toBe(
      'and(status.eq.active,is_trial.eq.false,end_date.gte.2026-07-11)'
    );
  });

  it('derives expired as still-active rows past their end date', () => {
    expect(memberStatusOrClause(['expired'], TODAY)).toBe(
      'and(status.eq.active,is_trial.eq.false,end_date.lt.2026-07-11)'
    );
  });

  it('ORs multiple selections', () => {
    expect(memberStatusOrClause(['frozen', 'trial'], TODAY)).toBe(
      'status.eq.frozen,is_trial.eq.true'
    );
  });
});

describe('applyMemberFilters', () => {
  // Minimal recording stub matching the structural query interface.
  function stub() {
    const calls: [string, unknown][] = [];
    const q = {
      calls,
      in(column: string, values: readonly string[]) {
        calls.push(['in', { column, values }]);
        return q;
      },
      eq(column: string, value: string | boolean) {
        calls.push(['eq', { column, value }]);
        return q;
      },
      is(column: string, value: null) {
        calls.push(['is', { column, value }]);
        return q;
      },
      or(filters: string, options?: { referencedTable: string }) {
        calls.push(['or', options ? { filters, options } : filters]);
        return q;
      },
    };
    return q;
  }

  it('applies nothing for empty filters', () => {
    const q = stub();
    applyMemberFilters(q, EMPTY_MEMBER_FILTERS, TODAY);
    expect(q.calls).toEqual([]);
  });

  it('applies plan, fee, churn, follow-up, and status facets', () => {
    const q = stub();
    applyMemberFilters(
      q,
      {
        ...EMPTY_MEMBER_FILTERS,
        plans: ['p1'],
        feeStatus: ['due'],
        statuses: ['cancelled'],
        assignees: ['user-1', UNASSIGNED_MEMBER_FILTER],
        trainers: ['trainer-1'],
        churnRisk: ['yes'],
        followUps: ['open'],
      },
      TODAY
    );
    expect(q.calls).toEqual([
      ['in', { column: 'plan_id', values: ['p1'] }],
      ['in', { column: 'fee_status', values: ['due'] }],
      [
        'or',
        {
          filters: 'assigned_to.in.(user-1),assigned_to.is.null',
          options: { referencedTable: 'contact' },
        },
      ],
      ['in', { column: 'contact.trainer_id', values: ['trainer-1'] }],
      ['eq', { column: 'contact.churn_risk', value: true }],
      ['eq', { column: 'open_follow_ups.status', value: 'open' }],
      ['or', 'status.eq.cancelled'],
    ]);
  });

  it('filters members not marked as churn risk', () => {
    const q = stub();
    applyMemberFilters(
      q,
      {
        ...EMPTY_MEMBER_FILTERS,
        plans: [],
        feeStatus: [],
        statuses: [],
        churnRisk: ['no'],
        followUps: [],
      },
      TODAY
    );
    expect(q.calls).toEqual([
      ['eq', { column: 'contact.churn_risk', value: false }],
    ]);
  });

  it('does not constrain churn risk when both values are selected', () => {
    const q = stub();
    applyMemberFilters(
      q,
      {
        ...EMPTY_MEMBER_FILTERS,
        plans: [],
        feeStatus: [],
        statuses: [],
        churnRisk: ['yes', 'no'],
        followUps: [],
      },
      TODAY
    );
    expect(q.calls).toEqual([]);
  });

  it('filters the nullable assignee and trainer buckets without fake UUIDs', () => {
    const q = stub();
    applyMemberFilters(
      q,
      {
        ...EMPTY_MEMBER_FILTERS,
        assignees: [UNASSIGNED_MEMBER_FILTER],
        trainers: ['trainer-1', NO_TRAINER_MEMBER_FILTER],
      },
      TODAY
    );
    expect(q.calls).toEqual([
      ['is', { column: 'contact.assigned_to', value: null }],
      [
        'or',
        {
          filters: 'trainer_id.in.(trainer-1),trainer_id.is.null',
          options: { referencedTable: 'contact' },
        },
      ],
    ]);
    expect(
      splitNullableMemberFilterValues(
        ['trainer-1', NO_TRAINER_MEMBER_FILTER],
        NO_TRAINER_MEMBER_FILTER
      )
    ).toEqual({ ids: ['trainer-1'], includeNull: true });
  });
});

describe('activeMemberFilterCount', () => {
  it('counts active groups, not selections', () => {
    expect(activeMemberFilterCount(EMPTY_MEMBER_FILTERS)).toBe(0);
    expect(
      activeMemberFilterCount({
        ...EMPTY_MEMBER_FILTERS,
        followUps: ['open'],
      })
    ).toBe(1);
    expect(
      activeMemberFilterCount({
        ...EMPTY_MEMBER_FILTERS,
        plans: ['a', 'b'],
        statuses: ['active'],
      })
    ).toBe(2);
    expect(
      activeMemberFilterCount({
        ...EMPTY_MEMBER_FILTERS,
        assignees: [UNASSIGNED_MEMBER_FILTER],
        trainers: [NO_TRAINER_MEMBER_FILTER],
      })
    ).toBe(2);
  });
});
