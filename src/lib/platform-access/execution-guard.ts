import type { SupabaseClient } from '@supabase/supabase-js';

export class RetiredExecutionError extends Error {
  constructor() {
    super('Execution is no longer active or its lease was retired');
  }
}

export async function requireCurrentExecution(
  db: Pick<SupabaseClient, 'from'>,
  execution:
    | { kind: 'broadcast'; id: string; parentId: string; owner: string }
    | { kind: 'automation'; id: string; parentId: string; owner: string }
    | { kind: 'flow'; id: string; accountId: string }
): Promise<void> {
  const table =
    execution.kind === 'broadcast'
      ? 'broadcast_recipients'
      : execution.kind === 'automation'
        ? 'automation_pending_executions'
        : 'flow_runs';
  let query = db.from(table).select('id').eq('id', execution.id);
  if (execution.kind === 'flow') {
    query = query.eq('account_id', execution.accountId).eq('status', 'active');
  } else {
    const broadcast = execution.kind === 'broadcast';
    query = query
      .eq(broadcast ? 'broadcast_id' : 'automation_id', execution.parentId)
      .eq('status', broadcast ? 'pending' : 'running')
      .eq(broadcast ? 'send_lease_owner' : 'lease_owner', execution.owner)
      .gt(
        broadcast ? 'send_lease_until' : 'lease_until',
        new Date().toISOString()
      );
  }
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new RetiredExecutionError();
}
