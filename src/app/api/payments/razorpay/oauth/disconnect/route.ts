import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  disconnectRazorpayOAuthConnection,
  getRazorpayConnectionStatus,
} from '@/lib/payments/credentials';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requirePaymentGatewayAccess();
    const admin = supabaseAdmin();
    await disconnectRazorpayOAuthConnection(admin, ctx.accountId);
    return NextResponse.json({
      connection: await getRazorpayConnectionStatus(admin, ctx.accountId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
