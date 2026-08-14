import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  finalizeRazorpayOAuthConnection,
  getRazorpayConnection,
  getRazorpayConnectionStatus,
  getRazorpayDiagnosticScope,
} from '@/lib/payments/credentials';
import {
  assertRazorpayLivePilotAccount,
  assertRazorpayPinnedLivePilotMerchant,
} from '@/lib/payments/razorpay-config';
import { verifyRazorpayOAuthReadiness } from '@/lib/payments/razorpay-oauth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requirePaymentGatewayAccess();
    assertRazorpayLivePilotAccount(ctx.accountId);
    const admin = supabaseAdmin();
    const scope = await getRazorpayDiagnosticScope(admin, ctx.accountId);
    if (!scope) {
      return NextResponse.json(
        { error: 'No refreshable Razorpay OAuth connection' },
        { status: 409 }
      );
    }
    assertRazorpayPinnedLivePilotMerchant(scope.externalAccountId);
    const connection = await getRazorpayConnection(admin, ctx.accountId, {
      forceRefresh: true,
      allowStaleReadinessForRecovery: true,
    });
    if (!connection || connection.authenticationMode !== 'oauth') {
      return NextResponse.json(
        { error: 'No refreshable Razorpay OAuth connection' },
        { status: 409 }
      );
    }
    const readiness = await verifyRazorpayOAuthReadiness({
      accessToken: connection.authentication.accessToken,
      accountId: scope.externalAccountId,
    });
    await finalizeRazorpayOAuthConnection(admin, ctx.accountId, readiness);
    return NextResponse.json({
      connection: await getRazorpayConnectionStatus(admin, ctx.accountId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
