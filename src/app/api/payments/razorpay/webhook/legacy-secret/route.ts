import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { saveRazorpayLegacyWebhookSecret } from '@/lib/payments/credentials';
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
    const body = (await request.json()) as { webhookSecret?: unknown };
    const webhookSecret =
      typeof body.webhookSecret === 'string' ? body.webhookSecret.trim() : '';
    if (webhookSecret.length < 16 || webhookSecret.length > 500) {
      return NextResponse.json(
        { error: 'Webhook secret must be between 16 and 500 characters' },
        { status: 400 }
      );
    }

    await saveRazorpayLegacyWebhookSecret(
      supabaseAdmin(),
      ctx.accountId,
      webhookSecret
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    return toErrorResponse(error);
  }
}
