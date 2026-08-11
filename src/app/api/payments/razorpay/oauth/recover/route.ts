import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { getRazorpayConnectionStatus } from '@/lib/payments/credentials';
import { recoverStoredRazorpayDisconnectingConnection } from '@/lib/payments/razorpay-disconnect-recovery';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requirePaymentGatewayAccess();
    const admin = supabaseAdmin();
    const readiness = await recoverStoredRazorpayDisconnectingConnection({
      admin,
      accountId: ctx.accountId,
    });
    return NextResponse.json({
      readiness: readiness.ready ? 'ready' : 'blocked',
      connection: await getRazorpayConnectionStatus(admin, ctx.accountId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
