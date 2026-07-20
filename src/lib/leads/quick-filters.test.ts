import { describe, expect, it } from 'vitest';

import {
  applyLeadQuickFilter,
  LEAD_QUICK_FILTERS,
  leadQuickFilterFromUrl,
  leadQuickFilterToUrl,
  selectForLeadQuickFilter,
  type LeadQuickFilterContext,
} from './quick-filters';

type Call = [method: string, column: string, value: string | null];

class RecordingQuery {
  calls: Call[] = [];

  eq(column: string, value: string) {
    this.calls.push(['eq', column, value]);
    return this;
  }

  gte(column: string, value: string) {
    this.calls.push(['gte', column, value]);
    return this;
  }

  is(column: string, value: null) {
    this.calls.push(['is', column, value]);
    return this;
  }

  lt(column: string, value: string) {
    this.calls.push(['lt', column, value]);
    return this;
  }

  or(filters: string) {
    this.calls.push(['or', filters, '']);
    return this;
  }
}

const CONTEXT: LeadQuickFilterContext = {
  userId: 'agent-1',
  todayStart: '2026-07-19T18:30:00.000Z',
  tomorrowStart: '2026-07-20T18:30:00.000Z',
};

describe('lead quick-filter queries', () => {
  it('defines No follow-up as New with no open follow-up', () => {
    const query = applyLeadQuickFilter(
      new RecordingQuery(),
      'no_followup',
      CONTEXT
    );

    expect(selectForLeadQuickFilter('id', 'no_followup')).toBe(
      'id, open_follow_ups:follow_ups!left(id)'
    );
    expect(query.calls).toEqual([
      ['is', 'lead_status', null],
      ['eq', 'open_follow_ups.status', 'open'],
      ['is', 'open_follow_ups', null],
    ]);
  });

  it('keeps Unassigned and Mine limited to active leads', () => {
    const unassigned = applyLeadQuickFilter(
      new RecordingQuery(),
      'unassigned',
      CONTEXT
    );
    const mine = applyLeadQuickFilter(new RecordingQuery(), 'mine', CONTEXT);

    expect(unassigned.calls).toEqual([
      ['or', 'lead_status.is.null,lead_status.neq.lost', ''],
      ['is', 'assigned_to', null],
      ['is', 'pending_invitation_id', null],
    ]);
    expect(mine.calls).toEqual([
      ['or', 'lead_status.is.null,lead_status.neq.lost', ''],
      ['eq', 'assigned_to', 'agent-1'],
    ]);
  });

  it('uses an account-timezone day window for New today', () => {
    const query = applyLeadQuickFilter(
      new RecordingQuery(),
      'new_today',
      CONTEXT
    );

    expect(query.calls).toEqual([
      ['is', 'lead_status', null],
      ['gte', 'created_at', CONTEXT.todayStart],
      ['lt', 'created_at', CONTEXT.tomorrowStart],
    ]);
  });
});

describe('lead quick-filter URL values', () => {
  it('uses no URL value and no visible chip for All leads', () => {
    expect(LEAD_QUICK_FILTERS).not.toContain('all');
    expect(leadQuickFilterToUrl('no_followup')).toBe('no-follow-up');
    expect(leadQuickFilterFromUrl('no-follow-up')).toBe('no_followup');
    expect(leadQuickFilterFromUrl(null)).toBe('all');
    expect(leadQuickFilterFromUrl('unknown')).toBe('all');
    expect(leadQuickFilterToUrl('all')).toBeNull();
  });
});
