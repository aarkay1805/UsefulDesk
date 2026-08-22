import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { runMetaLeadRecovery } from '@/lib/meta/recovery';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runMetaLeadRecovery({ admin: supabaseAdmin() });
  return NextResponse.json(result.body, { status: result.ok ? 200 : 500 });
}
