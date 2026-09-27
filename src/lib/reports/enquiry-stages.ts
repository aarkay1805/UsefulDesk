import type { SupabaseClient } from '@supabase/supabase-js';

import {
  humaniseKey,
  resolveFieldOptions,
  statusColumns,
  UNKNOWN_STATUS_COLOR,
  type LeadFieldOption,
} from '@/lib/leads/field-options';

/**
 * How many open enquiries sit in each stage right now, and for how long.
 *
 * This is the stage half of Home's former "Enquiries by stage" card. It moved
 * to Business → Performance because it answers a weekly sales question, not a
 * daily one; its conversion half was dropped because Performance already
 * reports who joined, overall and by source, for the selected month.
 */
export interface EnquiryStage {
  key: string;
  label: string;
  color: string;
  count: number;
  /** Average days enquiries have sat in this stage. Null when none have. */
  avgDays: number | null;
}

export interface EnquiryStageRow {
  lead_status: string | null;
  lead_count: number | string;
  avg_days_in_stage: number | string | null;
}

/**
 * One row per configured stage, in board order, with New first. A stage no
 * enquiry sits in still gets its row at zero. A status key still on contacts
 * but no longer configured keeps its count visible under a readable label.
 */
export function buildEnquiryStages(
  statusOptions: LeadFieldOption[],
  rows: EnquiryStageRow[]
): EnquiryStage[] {
  const columns = statusColumns(resolveFieldOptions('status', statusOptions));
  const byKey = new Map(rows.map((row) => [row.lead_status ?? 'new', row]));
  const average = (row: EnquiryStageRow | undefined) =>
    row?.avg_days_in_stage == null ? null : Number(row.avg_days_in_stage);

  const stages: EnquiryStage[] = columns.map((column) => {
    const row = byKey.get(column.key);
    return {
      key: column.key,
      label: column.label,
      color: column.color,
      count: Number(row?.lead_count ?? 0),
      avgDays: average(row),
    };
  });
  for (const row of rows) {
    const key = row.lead_status ?? 'new';
    if (columns.some((column) => column.key === key)) continue;
    stages.push({
      key,
      label: humaniseKey(key),
      color: UNKNOWN_STATUS_COLOR,
      count: Number(row.lead_count),
      avgDays: average(row),
    });
  }
  return stages;
}

/** Both reads run under the caller's selected-branch RLS. */
export async function loadEnquiryStages(
  db: SupabaseClient
): Promise<EnquiryStage[]> {
  const [statusResult, stageResult] = await Promise.all([
    db
      .from('lead_field_options')
      .select('key, label, color')
      .eq('field', 'status')
      .order('sort_order', { ascending: true }),
    db.rpc('lead_funnel_stats'),
  ]);
  if (statusResult.error) throw statusResult.error;
  if (stageResult.error) throw stageResult.error;
  return buildEnquiryStages(
    (statusResult.data ?? []) as LeadFieldOption[],
    (stageResult.data ?? []) as EnquiryStageRow[]
  );
}
