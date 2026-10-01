import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  dispatchCronGroup,
  OPS_PATHS,
  RENEWAL_PATHS,
} from '@/lib/cron/dispatch';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DATABASE_CRON_SECRET = /^[a-f0-9]{64}$/;

export async function GET(request: Request) {
  const supplied = request.headers.get('x-database-cron-secret') ?? '';
  if (!DATABASE_CRON_SECRET.test(supplied)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: verified, error: verificationError } =
    await supabaseAdmin().rpc('verify_database_cron_secret', {
      p_secret: supplied,
    });
  if (verificationError || verified !== true) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const group = new URL(request.url).searchParams.get('group');
  const paths =
    group === 'ops' ? OPS_PATHS : group === 'renewals' ? RENEWAL_PATHS : null;
  if (!paths) {
    return NextResponse.json({ error: 'Unknown cron group' }, { status: 400 });
  }

  const cronSecret =
    process.env.AUTOMATION_CRON_SECRET ?? process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }

  const result = await dispatchCronGroup(request.url, paths, cronSecret);

  return NextResponse.json(
    { group, ...result },
    { status: result.failed > 0 ? 503 : 200 }
  );
}
