import type { SupabaseClient } from '@supabase/supabase-js';

export interface DashboardActionAttention {
  churnRisk: number;
  trialFollowups: number;
  failedMandates: number;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function count(row: JsonRecord, key: string): number {
  const parsed = Number(row[key]);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Dashboard attention aggregate returned invalid data');
  }
  return parsed;
}

/** Load only the three current-state counts rendered by Needs attention. */
export async function loadDashboardActionAttention(
  db: SupabaseClient,
  today: string
): Promise<DashboardActionAttention> {
  const { data, error } = await db.rpc('dashboard_action_attention', {
    p_today: today,
  });
  if (error) throw error;

  const row = record(Array.isArray(data) ? data[0] : data);
  if (!row) {
    throw new Error('Dashboard attention aggregate returned no data');
  }

  return {
    churnRisk: count(row, 'churn_risk'),
    trialFollowups: count(row, 'trial_followups'),
    failedMandates: count(row, 'failed_mandates'),
  };
}
