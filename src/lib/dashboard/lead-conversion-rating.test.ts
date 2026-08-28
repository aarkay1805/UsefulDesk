import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  ALL_LEADS_RATING_KEY,
  aggregateLeadSourceRatingInputs,
  aggregateLeadSourceRatings,
  LEAD_RATING_TARGETS,
  loadLeadSourceRatings,
  type LeadRatingAggregateRow,
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

  it('formats SQL aggregate inputs with the existing weights and labels', () => {
    const rows: LeadRatingAggregateRow[] = [
      {
        source: 'instagram',
        cohort_size: '2',
        member_conversion_successes: 1,
        trial_booking_successes: '1',
        human_response_successes: 1,
        human_response_sample: '2',
        follow_up_successes: 1,
        follow_up_sample: 2,
        positive_outcome_successes: '1',
        positive_outcome_sample: 1,
      },
    ];

    const result = aggregateLeadSourceRatingInputs(
      rows,
      30,
      period,
      new Map([['instagram', 'Instagram ads']])
    );

    expect(result.sources[0].label).toBe('Instagram ads');
    expect(result.sources[0].metrics.map((metric) => metric.actual)).toEqual([
      50, 50, 50, 50, 100,
    ]);
    expect(result.sources[0].rating).toBeCloseTo(86.67, 2);
    expect(result.allLeads).toMatchObject({
      key: ALL_LEADS_RATING_KEY,
      cohortSize: 2,
      rating: result.sources[0].rating,
    });
  });

  it('preserves the empty-cohort unavailable state for SQL inputs', () => {
    const result = aggregateLeadSourceRatingInputs([], 7, {
      start: '2026-07-24',
      end: '2026-07-30',
    });

    expect(result.sources).toEqual([]);
    expect(result.totalCohort).toBe(0);
    expect(result.allLeads).toMatchObject({
      cohortSize: 0,
      rating: null,
      confidence: 'insufficient',
    });
    expect(result.allLeads.metrics.every((metric) => metric.sample === 0)).toBe(
      true
    );
  });

  it('loads rating inputs through one RPC without raw-history pagination', async () => {
    const aggregateRows: LeadRatingAggregateRow[] = [
      {
        source: 'walk_in',
        cohort_size: 1,
        member_conversion_successes: 0,
        trial_booking_successes: 0,
        human_response_successes: 0,
        human_response_sample: 0,
        follow_up_successes: 0,
        follow_up_sample: 0,
        positive_outcome_successes: 0,
        positive_outcome_sample: 0,
      },
    ];
    const rpc = vi.fn(async () => ({ data: aggregateRows, error: null }));
    const sourceBuilder = {
      select: vi.fn(() => sourceBuilder),
      eq: vi.fn(() => sourceBuilder),
      order: vi.fn(async () => ({
        data: [{ key: 'walk_in', label: 'Walk-in' }],
        error: null,
      })),
    };
    const from = vi.fn(() => sourceBuilder);
    const db = { rpc, from } as unknown as SupabaseClient;

    const result = await loadLeadSourceRatings(
      db,
      90,
      'Asia/Kolkata',
      '2026-08-27'
    );

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('dashboard_lead_rating_inputs', {
      p_range_days: 90,
      p_time_zone: 'Asia/Kolkata',
      p_today: '2026-08-27',
    });
    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith('lead_field_options');
    expect(result).toMatchObject({
      rangeDays: 90,
      period: { start: '2026-05-30', end: '2026-08-27' },
      totalCohort: 1,
      sources: [{ key: 'walk_in', label: 'Walk-in' }],
    });
  });

  it('surfaces a lead-rating aggregate RPC error', async () => {
    const error = new Error('rating aggregate unavailable');
    const sourceBuilder = {
      select: vi.fn(() => sourceBuilder),
      eq: vi.fn(() => sourceBuilder),
      order: vi.fn(async () => ({ data: [], error: null })),
    };
    const db = {
      rpc: vi.fn(async () => ({ data: null, error })),
      from: vi.fn(() => sourceBuilder),
    } as unknown as SupabaseClient;

    await expect(
      loadLeadSourceRatings(db, 30, 'UTC', '2026-07-30')
    ).rejects.toBe(error);
  });
});
