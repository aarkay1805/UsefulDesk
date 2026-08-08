import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  getRazorpayConnection,
  getRazorpayConnectionStatus,
} from '@/lib/payments/credentials';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requirePaymentGatewayAccess();
    const admin = supabaseAdmin();
    const connection = await getRazorpayConnection(admin, ctx.accountId, {
      forceRefresh: true,
    });
    if (!connection || connection.authenticationMode !== 'oauth') {
      return NextResponse.json(
        { error: 'No refreshable Razorpay OAuth connection' },
        { status: 409 }
      );
    }
    return NextResponse.json({
      connection: await getRazorpayConnectionStatus(admin, ctx.accountId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
