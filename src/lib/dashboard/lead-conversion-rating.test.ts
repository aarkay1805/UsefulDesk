import { describe, expect, it } from 'vitest';

import {
  ALL_LEADS_RATING_KEY,
  aggregateLeadSourceRatings,
  LEAD_RATING_TARGETS,
  type LeadRatingRows,
} from './lead-conversion-rating';

const period = { start: '2026-07-01', end: '2026-07-30' };

function baseRows(): LeadRatingRows {
  return {
    contacts: [
      {
        id: 'lead-1',
        source: 'instagram',
        lead_status: 'trial_booked',
        created_at: '2026-07-01T09:00:00Z',
      },
      {
        id: 'lead-2',
        source: 'instagram',
        lead_status: 'contacted',
        created_at: '2026-07-02T09:00:00Z',
      },
    ],
    memberships: [
      {
        contact_id: 'lead-1',
        is_trial: false,
        converted_at: null,
        created_at: '2026-07-10T09:00:00Z',
      },
    ],
    conversations: [
      { id: 'conv-1', contact_id: 'lead-1' },
      { id: 'conv-2', contact_id: 'lead-2' },
    ],
    messages: [
      {
        conversation_id: 'conv-1',
        sender_type: 'customer',
        created_at: '2026-07-01T10:00:00Z',
      },
      {
        conversation_id: 'conv-1',
        sender_type: 'bot',
        created_at: '2026-07-01T10:01:00Z',
      },
      {
        conversation_id: 'conv-1',
        sender_type: 'agent',
        created_at: '2026-07-01T12:00:00Z',
      },
      {
        conversation_id: 'conv-2',
        sender_type: 'customer',
        created_at: '2026-07-02T10:00:00Z',
      },
      {
        conversation_id: 'conv-2',
        sender_type: 'agent',
        created_at: '2026-07-04T10:00:00Z',
      },
    ],
    followUps: [
      {
        contact_id: 'lead-1',
        status: 'done',
        outcome: 'trial_booked',
        due_date: '2026-07-05',
        completed_at: '2026-07-05T16:00:00Z',
        created_at: '2026-07-01T11:00:00Z',
      },
      {
        contact_id: 'lead-2',
        status: 'open',
        outcome: null,
        due_date: '2026-07-06',
        completed_at: null,
        created_at: '2026-07-02T11:00:00Z',
      },
    ],
  };
}

describe('lead conversion rating', () => {
  it('normalizes against explicit targets and applies the fixed weights', () => {
    const result = aggregateLeadSourceRatings(
      baseRows(),
      30,
      period,
      'UTC',
      new Map([['instagram', 'Instagram ads']]),
      new Date('2026-07-30T12:00:00Z')
    );
    const source = result.sources[0];

    expect(LEAD_RATING_TARGETS).toMatchObject({
      memberConversion: { weight: 35, target: 30 },
      trialBooking: { weight: 20, target: 40 },
      humanResponse: { weight: 15, target: 90 },
      followUp: { weight: 15, target: 90 },
      positiveOutcome: { weight: 15, target: 60 },
    });
    expect(source.label).toBe('Instagram ads');
    expect(source.metrics.map((metric) => metric.actual)).toEqual([
      50, 50, 50, 50, 100,
    ]);
    expect(source.metrics.map((metric) => metric.normalized)).toEqual([
      100, 100, 55.55555555555556, 55.55555555555556, 100,
    ]);
    expect(source.rating).toBeCloseTo(86.67, 2);
    expect(source.confidence).toBe('low');
    expect(result.allLeads).toMatchObject({
      key: ALL_LEADS_RATING_KEY,
      label: 'All leads',
      cohortSize: 2,
      rating: source.rating,
    });
  });

  it('combines every source, including missing attribution, into All leads', () => {
    const rows = baseRows();
    rows.contacts[1].source = null;
    const result = aggregateLeadSourceRatings(
      rows,
      30,
      period,
      'UTC',
      new Map([['instagram', 'Instagram ads']]),
      new Date('2026-07-30T12:00:00Z')
    );

    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((source) => source.label)).toEqual([
      'Instagram ads',
      'Unknown',
    ]);
    expect(result.allLeads.cohortSize).toBe(2);
    expect(result.allLeads.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'memberConversion',
          successes: 1,
          sample: 2,
        }),
        expect.objectContaining({
          key: 'humanResponse',
          successes: 1,
          sample: 2,
        }),
        expect.objectContaining({
          key: 'followUp',
          successes: 1,
          sample: 2,
        }),
      ])
    );
    expect(result.allLeads.rating).toBeCloseTo(86.67, 2);
  });

  it('excludes bot replies and counts an unanswered inbound as a measured miss', () => {
    const rows = baseRows();
    rows.messages = rows.messages.filter(
      (message) =>
        !(
          message.conversation_id === 'conv-1' &&
          message.sender_type === 'agent'
        )
    );
    const source = aggregateLeadSourceRatings(rows, 30, period, 'UTC')
      .sources[0];
    const response = source.metrics.find(
      (metric) => metric.key === 'humanResponse'
    );

    expect(response).toMatchObject({ successes: 0, sample: 2, actual: 0 });
  });

  it('keeps a missing measurable sample unavailable instead of scoring zero', () => {
    const rows = baseRows();
    rows.followUps = [];
    const source = aggregateLeadSourceRatings(rows, 30, period, 'UTC')
      .sources[0];
    const followUp = source.metrics.find((metric) => metric.key === 'followUp');

    expect(followUp).toMatchObject({
      successes: 0,
      sample: 0,
      actual: null,
      normalized: null,
    });
    expect(source.rating).toBeNull();
    expect(source.confidence).toBe('insufficient');
  });

  it('derives positive outcome rate only from recorded follow-up outcomes', () => {
    const rows = baseRows();
    rows.followUps = [
      ...rows.followUps,
      {
        contact_id: 'lead-1',
        status: 'done',
        outcome: 'contacted',
        due_date: '2026-07-07',
        completed_at: '2026-07-07T10:00:00Z',
        created_at: '2026-07-03T11:00:00Z',
      },
      {
        contact_id: 'lead-2',
        status: 'done',
        outcome: 'no_answer',
        due_date: '2026-07-08',
        completed_at: '2026-07-08T10:00:00Z',
        created_at: '2026-07-04T11:00:00Z',
      },
      {
        contact_id: 'lead-2',
        status: 'done',
        outcome: 'other',
        due_date: '2026-07-09',
        completed_at: '2026-07-09T10:00:00Z',
        created_at: '2026-07-05T11:00:00Z',
      },
    ];

    const source = aggregateLeadSourceRatings(rows, 30, period, 'UTC')
      .sources[0];
    const outcome = source.metrics.find(
      (metric) => metric.key === 'positiveOutcome'
    );

    expect(outcome).toMatchObject({
      successes: 2,
      sample: 4,
      actual: 50,
    });
  });

  it('keeps positive outcome unavailable when no outcome is recorded', () => {
    const rows = baseRows();
    rows.followUps = rows.followUps.map((followUp) => ({
      ...followUp,
      status: 'open',
      outcome: null,
      completed_at: null,
    }));

    const source = aggregateLeadSourceRatings(rows, 30, period, 'UTC')
      .sources[0];
    const outcome = source.metrics.find(
      (metric) => metric.key === 'positiveOutcome'
    );

    expect(outcome).toMatchObject({
      successes: 0,
      sample: 0,
      actual: null,
      normalized: null,
    });
    expect(source.rating).toBeNull();
  });

  it('uses the account time zone to judge completion by the end of due day', () => {
    const rows = baseRows();
    rows.contacts = [rows.contacts[0]];
    rows.memberships = [rows.memberships[0]];
    rows.conversations = [rows.conversations[0]];
    rows.messages = rows.messages.filter(
      (message) => message.conversation_id === 'conv-1'
    );
    rows.followUps = [
      {
        contact_id: 'lead-1',
        status: 'done',
        outcome: 'trial_booked',
        due_date: '2026-07-05',
        completed_at: '2026-07-05T18:45:00Z',
        created_at: '2026-07-01T11:00:00Z',
      },
    ];

    const source = aggregateLeadSourceRatings(rows, 30, period, 'Asia/Kolkata')
      .sources[0];
    const followUp = source.metrics.find((metric) => metric.key === 'followUp');

    expect(followUp).toMatchObject({ successes: 0, sample: 1, actual: 0 });
  });
});
