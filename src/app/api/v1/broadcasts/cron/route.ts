import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { drainPublicBroadcastRecipients } from '@/lib/whatsapp/broadcast-core';

export const maxDuration = 60;

/** Recover public broadcasts interrupted after their 202 acknowledgement. */
export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(
      await drainPublicBroadcastRecipients(supabaseAdmin(), { limit: 100 })
    );
  } catch (error) {
    console.error('[public broadcasts] recovery drain failed:', error);
    return NextResponse.json(
      { error: 'Public broadcast recovery failed' },
      { status: 500 }
    );
  }
}
