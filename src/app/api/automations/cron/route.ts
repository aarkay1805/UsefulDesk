import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { resumePendingExecution } from '@/lib/automations/engine';
import type { PendingExecution } from '@/lib/automations/engine';

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * Claims are atomic owner leases. A later invocation can reclaim a row when
 * its prior worker stops before recording a terminal status.
 */
export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const leaseOwner = randomUUID();
  let processed = 0;
  while (processed < 50) {
    // Lease only the row about to run. Claiming the whole batch up front would
    // let later rows expire while earlier automations execute sequentially.
    const { data: due, error } = await admin.rpc(
      'claim_due_automation_executions',
      {
        p_lease_owner: leaseOwner,
        p_limit: 1,
        p_lease_seconds: 300,
      }
    );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const pending = (due as PendingExecution[] | null)?.[0];
    if (!pending) break;

    await resumePendingExecution(pending, leaseOwner);
    processed++;
  }

  return NextResponse.json({ processed });
}
