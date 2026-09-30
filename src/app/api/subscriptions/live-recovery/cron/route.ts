import { NextResponse } from 'next/server';

import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { liveBillingConfig } from '@/lib/subscriptions/live-provider';
import {
  liveFinancialRecoveryEnabled,
  recoverLiveFinancialObligations,
} from '@/lib/subscriptions/live-recovery';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Fixed single-item scheduler budget: at most three provider GETs (45 seconds). */
export async function GET(request: Request) {
  if (!cronSecretConfigured() || !isAuthorizedCronRequest(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!liveFinancialRecoveryEnabled())
    return NextResponse.json(
      { skipped: 'disabled', inspected: 0 },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  try {
    liveBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const result = await recoverLiveFinancialObligations({ batchLimit: 1 });
    const { inspected, recovered, exceptions, failed } = result;
    return NextResponse.json(
      { inspected, recovered, exceptions, failed },
      {
        status: result.failed ? 503 : 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch {
    return NextResponse.json({ error: 'Retry later' }, { status: 503 });
  }
}
