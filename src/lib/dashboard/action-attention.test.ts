import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { loadDashboardActionAttention } from './action-attention';

function dbWithResult(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as unknown as SupabaseClient;
}

describe('dashboard action attention loader', () => {
  it('loads only the three rendered counts for the authorized branch day', async () => {
    const db = dbWithResult({
      data: [
        {
          churn_risk: '4',
          trial_followups: 2,
          failed_mandates: 1,
        },
      ],
      error: null,
    });

    await expect(
      loadDashboardActionAttention(db, '2026-08-28')
    ).resolves.toEqual({
      churnRisk: 4,
      trialFollowups: 2,
      failedMandates: 1,
    });
    expect(db.rpc).toHaveBeenCalledOnce();
    expect(db.rpc).toHaveBeenCalledWith('dashboard_action_attention', {
      p_today: '2026-08-28',
    });
  });

  it('preserves aggregate errors for the section-local boundary', async () => {
    const error = new Error('aggregate unavailable');
    const db = dbWithResult({ data: null, error });

    await expect(loadDashboardActionAttention(db, '2026-08-28')).rejects.toBe(
      error
    );
  });

  it.each([
    null,
    [],
    [{ churn_risk: -1, trial_followups: 0, failed_mandates: 0 }],
    [{ churn_risk: 0, trial_followups: 'unknown', failed_mandates: 0 }],
  ])('fails closed on an invalid payload %#', async (data) => {
    const db = dbWithResult({ data, error: null });

    await expect(
      loadDashboardActionAttention(db, '2026-08-28')
    ).rejects.toThrow(/Dashboard attention aggregate returned/);
  });
});
