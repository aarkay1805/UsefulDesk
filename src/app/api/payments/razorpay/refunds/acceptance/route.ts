import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { canRefundGatewayPayments } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getRazorpayProviderMode } from '@/lib/payments/razorpay-config';
import { runRazorpayRecovery } from '@/lib/payments/razorpay-recovery';

export const runtime = 'nodejs';
export const maxDuration = 300;

function acceptanceEnabled(): boolean {
  return (
    process.env.RAZORPAY_PROVIDER_ACCEPTANCE_ONLY === 'true' &&
    getRazorpayProviderMode() === 'test'
  );
}

export async function GET() {
  try {
    if (!acceptanceEnabled()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const ctx = await requireRole('admin');
    if (!canRefundGatewayPayments(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return new Response(
      '<!doctype html><html><head><meta charset="utf-8"><title>Razorpay refund acceptance</title></head><body><main><h1>Razorpay Stage 4 recovery</h1><p>Isolated Test Mode only. Runs one bounded refund-intent and historical-window recovery pass.</p><form method="post"><button type="submit">Run isolated Test recovery</button></form></main></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!acceptanceEnabled()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    requireSameOriginRequest(request);
    const ctx = await requireRole('admin');
    if (!canRefundGatewayPayments(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const result = await runRazorpayRecovery({
      admin: supabaseAdmin(),
      providerMode: 'test',
    });
    return NextResponse.json({ accountId: ctx.accountId, result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
