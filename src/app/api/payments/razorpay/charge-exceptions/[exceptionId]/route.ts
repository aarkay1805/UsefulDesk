import { NextResponse } from 'next/server';

import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  RazorpayChargeResolutionConflictError,
  resolveProviderChargeException,
  type RazorpayChargeResolutionAction,
} from '@/lib/payments/razorpay-charge-resolution';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ exceptionId: string }> }
) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requirePaymentGatewayAccess();
    const { exceptionId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action as RazorpayChargeResolutionAction | undefined;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (
      !exceptionId ||
      (action !== 'apply' && action !== 'ignore') ||
      reason.length < 3 ||
      reason.length > 500
    ) {
      return NextResponse.json(
        { error: 'A valid action and resolution reason are required' },
        { status: 400 }
      );
    }

    const result = await resolveProviderChargeException({
      admin: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      exceptionId,
      action,
      reason,
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    if (error instanceof RazorpayChargeResolutionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return toErrorResponse(error);
  }
}
