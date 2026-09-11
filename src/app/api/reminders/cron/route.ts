import { NextResponse } from 'next/server';

import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { runLifecycleReminderWorker } from '@/lib/reminders/worker';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Additional lifecycle queue. New accounts stay harmlessly empty until an
 * admin enables invoice collection; this route never changes that setting. */
export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runLifecycleReminderWorker();
    return NextResponse.json(summary, {
      status:
        summary.failed > 0 ||
        summary.ambiguous > 0 ||
        summary.infrastructureFailures > 0
          ? 503
          : 200,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reminder worker failed' },
      { status: 503 }
    );
  }
}
