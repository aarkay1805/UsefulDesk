import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { canRefundGatewayPayments } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  classifyImportedGatewayRefund,
  RefundConflictError,
  type RefundDisposition,
} from '@/lib/payments/razorpay-refunds';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ refundId: string }> }
) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requireRole('admin');
    if (!canRefundGatewayPayments(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { refundId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const disposition = body.disposition as RefundDisposition | undefined;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (
      !refundId ||
      (disposition !== 'reopen_balance' && disposition !== 'reduce_charge') ||
      reason.length < 3 ||
      reason.length > 500
    ) {
      return NextResponse.json(
        { error: 'Valid disposition and reason are required' },
        { status: 400 }
      );
    }
    const { data: refund } = await ctx.supabase
      .from('payment_refunds')
      .select('id')
      .eq('id', refundId)
      .maybeSingle();
    if (!refund) {
      return NextResponse.json({ error: 'Refund not found' }, { status: 404 });
    }
    const result = await classifyImportedGatewayRefund({
      admin: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      refundId,
      disposition,
      reason,
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    if (error instanceof RefundConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return toErrorResponse(error);
  }
}
