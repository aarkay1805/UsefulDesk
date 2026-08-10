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
    const [
      { data: refunds, error: refundError },
      { data: reconciliation },
      { data: originalAllocations, error: originalAllocationError },
    ] = await Promise.all([
      ctx.supabase
        .from('payment_refunds')
        .select(
          'id, payment_id, invoice_id, gateway_refund_id, amount, currency, source, disposition, reason, status, requested_by, requested_at, processed_at, failed_at, provider_created_at, created_at, payment_refund_allocations(invoice_line_id, amount)'
        )
        .eq('payment_id', paymentId)
        .order('created_at', { ascending: false }),
      supabaseAdmin()
        .from('razorpay_reconciliation_state')
        .select('initial_scan_completed_at')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('payment_allocations')
        .select('invoice_line_id, amount')
        .eq('payment_id', paymentId),
    ]);
    if (refundError) throw new Error(`load refunds: ${refundError.message}`);
    if (originalAllocationError) {
      throw new Error(
        `load original payment allocations: ${originalAllocationError.message}`
      );
    }
    const lineIds = (originalAllocations ?? []).map(
      (allocation) => allocation.invoice_line_id
    );
    let invoiceLines: Array<{
      id: string;
      description: string;
      sort_order: number;
    }> = [];
    if (lineIds.length > 0) {
      const { data, error } = await ctx.supabase
        .from('invoice_lines')
        .select('id, description, sort_order')
        .in('id', lineIds)
        .order('sort_order');
      if (error) throw new Error(`load invoice lines: ${error.message}`);
      invoiceLines = data ?? [];
    }
    const lineById = new Map(invoiceLines.map((line) => [line.id, line]));
    const consumedByLine = new Map<string, number>();
    for (const refund of refunds ?? []) {
      if (refund.status === 'failed') continue;
      for (const allocation of refund.payment_refund_allocations ?? []) {
        consumedByLine.set(
          allocation.invoice_line_id,
          (consumedByLine.get(allocation.invoice_line_id) ?? 0) +
            Number(allocation.amount)
        );
      }
    }
    return NextResponse.json({
      refunds: (refunds ?? []).map((refund) => {
        const allocated = (refund.payment_refund_allocations ?? []).reduce(
          (total, allocation) => total + Number(allocation.amount),
          0
        );
        const allocationComplete =
          Math.round(allocated * 100) ===
          Math.round(Number(refund.amount) * 100);
        const needsLineTargeting =
          refund.source === 'razorpay_dashboard' &&
          refund.status === 'processed' &&
          !refund.disposition &&
          !allocationComplete;
        return {
          ...refund,
          allocation_complete: allocationComplete,
          allocation_options: needsLineTargeting
            ? [...(originalAllocations ?? [])]
                .sort(
                  (left, right) =>
                    (lineById.get(left.invoice_line_id)?.sort_order ??
                      Number.MAX_SAFE_INTEGER) -
                    (lineById.get(right.invoice_line_id)?.sort_order ??
                      Number.MAX_SAFE_INTEGER)
                )
                .map((allocation) => {
                  const line = lineById.get(allocation.invoice_line_id);
                  return {
                    invoice_line_id: allocation.invoice_line_id,
                    description: line?.description ?? 'Invoice item',
                    original_payment_amount: Number(allocation.amount),
                    available_amount: Math.max(
                      0,
                      Number(allocation.amount) -
                        (consumedByLine.get(allocation.invoice_line_id) ?? 0)
                    ),
                  };
                })
                .filter((allocation) => allocation.available_amount > 0)
            : undefined,
          payment_refund_allocations: undefined,
        };
      }),
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
