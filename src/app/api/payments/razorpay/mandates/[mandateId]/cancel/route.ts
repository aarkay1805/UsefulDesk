import { NextResponse } from 'next/server';

import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  cancelRazorpayMandate,
  MandateCancellationConflictError,
  MandateCancellationUnavailableError,
} from '@/lib/payments/razorpay-mandates';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ mandateId: string }> }
) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requirePaymentGatewayAccess();
    const { mandateId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!mandateId || reason.length < 3 || reason.length > 500) {
      return NextResponse.json(
        {
          error:
            'A cancellation reason between 3 and 500 characters is required',
        },
        { status: 400 }
      );
    }

    const result = await cancelRazorpayMandate({
      admin: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      mandateId,
      reason,
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    if (error instanceof MandateCancellationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof MandateCancellationUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return toErrorResponse(error);
  }
}
