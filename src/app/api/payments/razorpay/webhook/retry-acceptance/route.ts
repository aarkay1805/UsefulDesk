import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { getRazorpayProviderMode } from '@/lib/payments/razorpay-config';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    if (
      getRazorpayProviderMode() !== 'test' ||
      process.env.RAZORPAY_PROVIDER_ACCEPTANCE_ONLY !== 'true'
    ) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ctx = await requirePaymentGatewayAccess();
    const body = (await request.json()) as {
      action?: unknown;
      subscriptionId?: unknown;
      acceptanceId?: unknown;
    };
    if (body.action === 'cancel') {
      const acceptanceId =
        typeof body.acceptanceId === 'string' ? body.acceptanceId.trim() : '';
      if (!isUuid(acceptanceId)) {
        return NextResponse.json(
          { error: 'A valid acceptance id is required' },
          { status: 400 }
        );
      }
      const { data, error } = await supabaseAdmin().rpc(
        'cancel_razorpay_webhook_retry_acceptance',
        {
          p_acceptance_id: acceptanceId,
          p_account_id: ctx.accountId,
          p_cancelled_by: ctx.userId,
        }
      );
      if (error || data !== true) {
        return NextResponse.json(
          { error: 'Retry acceptance exercise could not be cancelled' },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: true, cancelled: true });
    }

    if (body.action !== 'arm') {
      return NextResponse.json(
        { error: 'Action must be arm or cancel' },
        { status: 400 }
      );
    }
    const subscriptionId =
      typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      return NextResponse.json(
        { error: 'A valid Test subscription id is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin().rpc(
      'arm_razorpay_webhook_retry_acceptance',
      {
        p_account_id: ctx.accountId,
        p_provider_mode: 'test',
        p_expected_event_type: 'subscription.cancelled',
        p_expected_subscription_id: subscriptionId,
        p_armed_by: ctx.userId,
        p_ttl_seconds: 600,
      }
    );
    if (error || !data) {
      console.error('[razorpay retry acceptance] arm rejected:', error);
      return NextResponse.json(
        { error: 'Razorpay retry acceptance preconditions did not pass' },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, acceptance: data });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    return toErrorResponse(error);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
