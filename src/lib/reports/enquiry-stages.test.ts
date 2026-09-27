import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { buildEnquiryStages, loadEnquiryStages } from './enquiry-stages';

describe('buildEnquiryStages', () => {
  it('lists every configured stage in board order with New first', () => {
    const stages = buildEnquiryStages(
      [
        { key: 'contacted', label: 'Contacted', color: '#eab308' },
        { key: 'lost', label: 'Not joining', color: '#64748b' },
      ],
      [
        { lead_status: null, lead_count: '4', avg_days_in_stage: '0.5' },
        { lead_status: 'lost', lead_count: 2, avg_days_in_stage: 12 },
      ]
    );

    expect(
      stages.map((stage) => [stage.key, stage.count, stage.avgDays])
    ).toEqual([
      ['new', 4, 0.5],
      ['contacted', 0, null],
      ['lost', 2, 12],
    ]);
  });

  it('keeps a retired stage key visible under a readable label', () => {
    const stages = buildEnquiryStages(
      [{ key: 'contacted', label: 'Contacted', color: '#eab308' }],
      [
        {
          lead_status: 'waiting_on_link',
          lead_count: 1,
          avg_days_in_stage: null,
        },
      ]
    );

    expect(stages.at(-1)).toMatchObject({
      key: 'waiting_on_link',
      label: 'Waiting on link',
      count: 1,
      avgDays: null,
    });
  });
});

describe('loadEnquiryStages', () => {
  function db(
    status: { data: unknown; error: unknown },
    stages: { data: unknown; error: unknown }
  ) {
    const order = vi.fn(async () => status);
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    return {
      from: vi.fn(() => ({ select })),
      rpc: vi.fn(async () => stages),
    } as unknown as SupabaseClient;
  }

  it('fails instead of reporting an unreadable list as no enquiries', async () => {
    await expect(
      loadEnquiryStages(
        db(
          { data: [], error: null },
          { data: null, error: new Error('denied') }
        )
      )
    ).rejects.toThrow('denied');
  });

  it('reads the saved stages and the stage counts', async () => {
    const client = db(
      { data: [], error: null },
      {
        data: [{ lead_status: null, lead_count: 3, avg_days_in_stage: 1 }],
        error: null,
      }
    );
    const stages = await loadEnquiryStages(client);

    expect(client.rpc).toHaveBeenCalledWith('lead_funnel_stats');
    expect(stages[0]).toMatchObject({ key: 'new', count: 3, avgDays: 1 });
  });
});
