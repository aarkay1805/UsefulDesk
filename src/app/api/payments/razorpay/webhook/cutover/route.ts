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
    const body = (await request.json()) as { parityEventIds?: unknown };
    const parityEventIds = Array.isArray(body.parityEventIds)
      ? body.parityEventIds.filter(
          (value): value is string =>
            typeof value === 'string' &&
            value.trim().length > 0 &&
            value.trim().length <= 200
        )
      : [];
    if (parityEventIds.length !== 3 || new Set(parityEventIds).size !== 3) {
      return NextResponse.json(
        { error: 'Exactly three distinct parity event ids are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin().rpc(
      'cutover_razorpay_application_webhook',
      {
        p_account_id: ctx.accountId,
        p_provider_mode: 'test',
        p_parity_event_ids: parityEventIds,
        p_cutover_by: ctx.userId,
      }
    );
    if (error || !data) {
      console.error('[razorpay cutover] parity gate rejected:', error);
      return NextResponse.json(
        { error: 'Razorpay cutover evidence did not pass' },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, cutover: data });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    return toErrorResponse(error);
  }
}
