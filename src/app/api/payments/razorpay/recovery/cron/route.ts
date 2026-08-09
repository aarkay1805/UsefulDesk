import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { getRazorpayProviderMode } from '@/lib/payments/razorpay-config';
import { runRazorpayRecovery } from '@/lib/payments/razorpay-recovery';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let providerMode;
  try {
    providerMode = getRazorpayProviderMode();
  } catch {
    return NextResponse.json(
      { error: 'Razorpay recovery is not configured' },
      { status: 503 }
    );
  }

  try {
    return NextResponse.json(
      await runRazorpayRecovery({ admin: supabaseAdmin(), providerMode })
    );
  } catch (error) {
    console.error('[razorpay recovery] batch failed:', error);
    return NextResponse.json(
      { error: 'Razorpay recovery batch failed' },
      { status: 500 }
    );
  }
}
