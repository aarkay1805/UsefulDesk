import { NextResponse } from 'next/server';

import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { runAttendanceAbsenceReminderWorker } from '@/lib/reminders/worker';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runAttendanceAbsenceReminderWorker();
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
      {
        error:
          error instanceof Error ? error.message : 'Missed-visit worker failed',
      },
      { status: 503 }
    );
  }
}
