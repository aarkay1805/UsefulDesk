import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { assertRazorpayOAuthStorageReady } from '@/lib/payments/credentials';
import {
  assertRazorpayLivePilotAccount,
  getRazorpayOAuthConfig,
} from '@/lib/payments/razorpay-config';
import {
  buildRazorpayAuthorizationUrl,
  createRazorpayOAuthAttempt,
} from '@/lib/payments/razorpay-oauth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requirePaymentGatewayAccess();
    const config = getRazorpayOAuthConfig();
    assertRazorpayLivePilotAccount(ctx.accountId);
    const admin = supabaseAdmin();
    await assertRazorpayOAuthStorageReady(admin, ctx.accountId);
    const attempt = createRazorpayOAuthAttempt({
      accountId: ctx.accountId,
      initiatedBy: ctx.userId,
      config,
    });
    const { error } = await admin
      .from('razorpay_oauth_states')
      .insert(attempt.row);
    if (error) throw new Error(`create Razorpay OAuth state: ${error.message}`);

    return NextResponse.json({
      authorizeUrl: buildRazorpayAuthorizationUrl({
        config,
        state: attempt.state,
        codeChallenge: attempt.codeChallenge,
      }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
