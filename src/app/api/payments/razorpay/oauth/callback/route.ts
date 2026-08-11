import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requirePaymentGatewayAccess } from '@/lib/auth/account';
import { BRANCH_QUERY_PARAM } from '@/lib/auth/branch-context';
import { createClient } from '@/lib/supabase/server';
import {
  beginRazorpayOAuthConnection,
  finalizeRazorpayOAuthConnection,
} from '@/lib/payments/credentials';
import {
  assertRazorpayApplicationWebhookConfigured,
  assertRazorpayLivePilotAccount,
  authorizeRazorpayLivePilotMerchant,
  getRazorpayOAuthConfig,
  type RazorpayLivePilotMerchantAuthorization,
} from '@/lib/payments/razorpay-config';
import {
  boundedRazorpayError,
  consumeRazorpayOAuthState,
  exchangeRazorpayAuthorizationCode,
  peekRazorpayOAuthStateAccount,
  revokeRazorpayOAuthToken,
  validateConsumedOAuthState,
  verifyRazorpayOAuthReadiness,
} from '@/lib/payments/razorpay-oauth';

export const runtime = 'nodejs';

function settingsRedirect(
  request: Request,
  result: string,
  accountId?: string
): NextResponse {
  const url = new URL('/settings', request.url);
  url.searchParams.set('tab', 'deals');
  url.searchParams.set('razorpay', result);
  if (accountId) url.searchParams.set(BRANCH_QUERY_PARAM, accountId);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  let accountId: string | undefined;
  try {
    const url = new URL(request.url);
    const rawState = url.searchParams.get('state') ?? '';
    if (rawState.length < 32 || rawState.length > 512) {
      return settingsRedirect(request, 'invalid_state');
    }

    const session = await createClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return settingsRedirect(request, 'session_required');

    const config = getRazorpayOAuthConfig();
    const admin = supabaseAdmin();
    accountId =
      (await peekRazorpayOAuthStateAccount(admin, rawState, user.id, config)) ??
      undefined;
    if (!accountId) return settingsRedirect(request, 'invalid_state');

    assertRazorpayLivePilotAccount(accountId);
    await requirePaymentGatewayAccess(accountId);
    const consumed = await consumeRazorpayOAuthState(
      admin,
      rawState,
      accountId,
      user.id,
      config
    );
    if (!consumed) return settingsRedirect(request, 'invalid_state', accountId);
    validateConsumedOAuthState(consumed, {
      accountId,
      initiatedBy: user.id,
      config,
    });

    if (url.searchParams.has('error') || url.searchParams.has('denied')) {
      return settingsRedirect(request, 'authorization_denied', accountId);
    }
    const code = url.searchParams.get('code') ?? '';
    if (!code || code.length > 10_000) {
      return settingsRedirect(request, 'invalid_code', accountId);
    }

    const tokens = await exchangeRazorpayAuthorizationCode({
      config,
      code,
      encryptedCodeVerifier: consumed.pkce_code_verifier,
    });
    let merchantAuthorization: RazorpayLivePilotMerchantAuthorization;
    try {
      merchantAuthorization = authorizeRazorpayLivePilotMerchant(
        tokens.accountId
      );
      assertRazorpayApplicationWebhookConfigured();
      await beginRazorpayOAuthConnection(admin, accountId, tokens, {
        requireUnboundMerchant: merchantAuthorization === 'enrollment',
      });
    } catch (error) {
      // A grant that could not be bound locally must not remain usable. This is
      // best-effort because the original persistence error stays authoritative.
      await Promise.allSettled([
        revokeRazorpayOAuthToken({
          config,
          token: tokens.accessToken,
          tokenType: 'access_token',
        }),
        revokeRazorpayOAuthToken({
          config,
          token: tokens.refreshToken,
          tokenType: 'refresh_token',
        }),
      ]);
      throw error;
    }
    const readiness = await verifyRazorpayOAuthReadiness({
      accessToken: tokens.accessToken,
      accountId: tokens.accountId,
      allowCapabilityFallback: merchantAuthorization !== 'enrollment',
    }).catch((error) => ({
      ready: false as const,
      merchantStatus: 'unknown' as const,
      activationVerifiedAt: null,
      lastError: boundedRazorpayError(error),
    }));
    await finalizeRazorpayOAuthConnection(admin, accountId, readiness);
    return settingsRedirect(
      request,
      readiness.ready ? 'connected' : 'needs_attention',
      accountId
    );
  } catch (error) {
    console.error('[razorpay oauth callback]', boundedRazorpayError(error));
    return settingsRedirect(request, 'connection_failed', accountId);
  }
}
