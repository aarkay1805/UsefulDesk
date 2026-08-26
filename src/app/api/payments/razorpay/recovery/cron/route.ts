import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { getRazorpayProviderMode } from '@/lib/payments/razorpay-config';
import {
  runRazorpayRecovery,
  type RazorpayRecoveryResult,
} from '@/lib/payments/razorpay-recovery';

export const runtime = 'nodejs';
export const maxDuration = 300;

function hasRecoveryFailures(result: RazorpayRecoveryResult) {
  return (
    result.webhooks.failed > 0 ||
    result.chargeExceptions.failed > 0 ||
    result.subscriptionReconciliation.failed > 0 ||
    result.tokens.failed > 0 ||
    result.paymentLinks.failed > 0 ||
    result.refunds.failed > 0 ||
    result.refundReconciliation.failed > 0
  );
}

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
    const result = await runRazorpayRecovery({
      admin: supabaseAdmin(),
      providerMode,
    });
    return NextResponse.json(result, {
      status: hasRecoveryFailures(result) ? 503 : 200,
    });
  } catch (error) {
    console.error('[razorpay recovery] batch failed:', error);
    return NextResponse.json(
      { error: 'Razorpay recovery batch failed' },
      { status: 500 }
    );
  }
}
