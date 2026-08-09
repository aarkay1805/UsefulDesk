import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { canRefundGatewayPayments } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { RazorpayError } from '@/lib/payments/razorpay';
import {
  RefundConflictError,
  requestFullGatewayRefund,
  type RefundDisposition,
} from '@/lib/payments/razorpay-refunds';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const paymentId = new URL(request.url).searchParams.get('paymentId');
    if (!paymentId) {
      return NextResponse.json(
        { error: 'paymentId is required' },
        { status: 400 }
      );
    }
    const { data: payment } = await ctx.supabase
      .from('payments')
      .select('id')
      .eq('id', paymentId)
      .maybeSingle();
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }
    const [{ data: refunds, error: refundError }, { data: reconciliation }] =
      await Promise.all([
        ctx.supabase
          .from('payment_refunds')
          .select(
            'id, payment_id, invoice_id, gateway_refund_id, amount, currency, source, disposition, reason, status, requested_by, requested_at, processed_at, failed_at, provider_created_at, created_at, payment_refund_allocations(amount)'
          )
          .eq('payment_id', paymentId)
          .order('created_at', { ascending: false }),
        supabaseAdmin()
          .from('razorpay_reconciliation_state')
          .select('initial_scan_completed_at')
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
      ]);
    if (refundError) throw new Error(`load refunds: ${refundError.message}`);
    return NextResponse.json({
      refunds: (refunds ?? []).map((refund) => ({
        ...refund,
        allocation_complete:
          Math.round(
            (refund.payment_refund_allocations ?? []).reduce(
              (total, allocation) => total + Number(allocation.amount),
              0
            ) * 100
          ) === Math.round(Number(refund.amount) * 100),
        payment_refund_allocations: undefined,
      })),
      availability: {
        initialScanComplete: Boolean(reconciliation?.initial_scan_completed_at),
        canRefund: canRefundGatewayPayments(ctx.role),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requireRole('admin');
    if (!canRefundGatewayPayments(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    const disposition = body.disposition as RefundDisposition | undefined;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (
      !paymentId ||
      (disposition !== 'reopen_balance' && disposition !== 'reduce_charge') ||
      reason.length < 3 ||
      reason.length > 500 ||
      !/^[A-Za-z0-9_-]{10,100}$/.test(idempotencyKey)
    ) {
      return NextResponse.json(
        {
          error:
            'Valid payment, disposition, reason, and idempotency key are required',
        },
        { status: 400 }
      );
    }
    const { data: payment } = await ctx.supabase
      .from('payments')
      .select('id')
      .eq('id', paymentId)
      .maybeSingle();
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }
    const refund = await requestFullGatewayRefund({
      admin: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      paymentId,
      disposition,
      reason,
      idempotencyKey,
    });
    return NextResponse.json({ refund });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    if (error instanceof RefundConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RazorpayError) {
      console.error('[Razorpay refund] provider request failed:', error.status);
      if (
        process.env.RAZORPAY_PROVIDER_ACCEPTANCE_ONLY === 'true' &&
        process.env.RAZORPAY_MODE === 'test'
      ) {
        console.error(
          '[Razorpay refund acceptance] sanitized provider error:',
          JSON.stringify(error.body)
        );
      }
      return NextResponse.json(
        { error: 'Razorpay could not complete the refund request' },
        { status: error.status >= 400 && error.status < 500 ? 400 : 502 }
      );
    }
    return toErrorResponse(error);
  }
}
