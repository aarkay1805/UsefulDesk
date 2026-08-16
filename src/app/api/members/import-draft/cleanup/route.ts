import { NextResponse } from 'next/server';

import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { cleanupExpiredMemberImportDrafts } from '@/lib/memberships/import-draft-admin';

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await cleanupExpiredMemberImportDrafts());
  } catch (error) {
    console.error('[member-import-draft-cleanup] cleanup failed', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
