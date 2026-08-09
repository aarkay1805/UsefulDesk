import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { canRefundGatewayPayments } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  getRazorpayConnection,
  runRazorpayOperation,
} from '@/lib/payments/credentials';
import { getRazorpayProviderMode } from '@/lib/payments/razorpay-config';
import {
  createRefund,
  fetchPayment,
  fetchRefund,
  listPayments,
  listRefunds,
  RazorpayError,
  toPaise,
} from '@/lib/payments/razorpay';

export const runtime = 'nodejs';

const MAX_PREFLIGHT_SUBUNITS = 500;

function preflightAvailable(
  role: Parameters<typeof canRefundGatewayPayments>[0]
) {
  return (
    canRefundGatewayPayments(role) &&
    getRazorpayProviderMode() === 'test' &&
    process.env.RAZORPAY_PROVIDER_ACCEPTANCE_ONLY === 'true'
  );
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    if (!preflightAvailable(ctx.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const paymentId = new URL(request.url).searchParams.get('paymentId') ?? '';
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
      return NextResponse.json(
        { error: 'Valid paymentId is required' },
        { status: 400 }
      );
    }
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>Razorpay refund preflight</title></head><body><main><h1>Razorpay Stage 4 provider preflight</h1><p>Isolated Test Mode only. This issues one idempotent full refund for the selected synthetic payment.</p><form method="post"><input type="hidden" name="paymentId" value="${paymentId}"><input type="hidden" name="confirmation" value="isolated-test-full-refund"><button type="submit">Run isolated Test full refund</button></form></main></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requireRole('admin');
    if (!preflightAvailable(ctx.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const contentType = request.headers.get('content-type') ?? '';
    const body = contentType.startsWith('application/x-www-form-urlencoded')
      ? Object.fromEntries(await request.formData())
      : ((await request.json()) as Record<string, unknown>);
    const gatewayPaymentId =
      typeof body.paymentId === 'string' ? body.paymentId : '';
    if (
      !/^pay_[A-Za-z0-9]+$/.test(gatewayPaymentId) ||
      body.confirmation !== 'isolated-test-full-refund'
    ) {
      return NextResponse.json(
        { error: 'Valid payment and explicit Test confirmation are required' },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const { data: localPayment, error: paymentError } = await admin
      .from('payments')
      .select(
        'id, account_id, invoice_id, gateway_payment_id, amount, status, source'
      )
      .eq('account_id', ctx.accountId)
      .eq('gateway_payment_id', gatewayPaymentId)
      .in('source', ['auto', 'payment_link'])
      .eq('status', 'paid')
      .single();
    if (paymentError || !localPayment) {
      return NextResponse.json(
        { error: 'Captured Test payment not found' },
        { status: 404 }
      );
    }

    const connection = await getRazorpayConnection(admin, ctx.accountId);
    if (!connection || connection.authenticationMode !== 'oauth') {
      return NextResponse.json(
        { error: 'OAuth Test connection is unavailable' },
        { status: 409 }
      );
    }
    const payment = await runRazorpayOperation(
      admin,
      connection,
      (authentication) => fetchPayment(authentication, gatewayPaymentId)
    );
    const expectedSubunits = toPaise(Number(localPayment.amount));
    if (
      payment.id !== gatewayPaymentId ||
      payment.status !== 'captured' ||
      payment.captured !== true ||
      payment.currency !== 'INR' ||
      payment.amount !== expectedSubunits ||
      payment.amount <= 0 ||
      payment.amount > MAX_PREFLIGHT_SUBUNITS
    ) {
      throw new Error('Provider payment failed the low-value Test contract');
    }

    const createdAt = Math.max(0, Number(payment.created_at ?? 0));
    const payments = await runRazorpayOperation(
      admin,
      connection,
      (authentication) =>
        listPayments({
          creds: authentication,
          from: Math.max(0, createdAt - 3_600),
          count: 100,
          skip: 0,
        })
    );
    if (!payments.some((candidate) => candidate.id === payment.id)) {
      throw new Error('Provider payment list did not include the Test payment');
    }

    const idempotencyKey = `ud_s4_preflight_${payment.id.slice(4)}`;
    const canonicalBody = JSON.stringify({
      amount: payment.amount,
      receipt: idempotencyKey,
      notes: {
        usefuldesk_stage: 'stage4_provider_preflight',
        usefuldesk_payment_id: payment.id,
      },
    });
    const canonicalBodySha256 = createHash('sha256')
      .update(canonicalBody)
      .digest('hex');
    const refund = await runRazorpayOperation(
      admin,
      connection,
      (authentication) =>
        createRefund({
          creds: authentication,
          paymentId: payment.id,
          idempotencyKey,
          canonicalBody,
        })
    );
    if (
      refund.payment_id !== payment.id ||
      refund.amount !== payment.amount ||
      refund.receipt !== idempotencyKey ||
      !['pending', 'processed'].includes(refund.status)
    ) {
      throw new Error('Provider refund does not match the preflight request');
    }
    const fetched = await runRazorpayOperation(
      admin,
      connection,
      (authentication) => fetchRefund(authentication, refund.id)
    );
    const refunds = await runRazorpayOperation(
      admin,
      connection,
      (authentication) =>
        listRefunds({
          creds: authentication,
          from: Math.max(0, refund.created_at - 3_600),
          count: 100,
          skip: 0,
        })
    );
    if (
      fetched.id !== refund.id ||
      fetched.payment_id !== payment.id ||
      !refunds.some((candidate) => candidate.id === refund.id)
    ) {
      throw new Error('Provider refund fetch/list identity did not converge');
    }

    return NextResponse.json({
      providerMode: 'test',
      payment: {
        id: payment.id,
        amountSubunits: payment.amount,
        captured: true,
        fetched: true,
        listed: true,
      },
      refund: {
        id: fetched.id,
        status: fetched.status,
        amountSubunits: fetched.amount,
        fetched: true,
        listed: true,
        canonicalBodySha256,
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    if (error instanceof RazorpayError) {
      console.error(
        '[Razorpay refund preflight] provider failure:',
        error.status
      );
      return NextResponse.json(
        { error: 'Razorpay refund capability preflight failed' },
        { status: error.status >= 400 && error.status < 500 ? 400 : 502 }
      );
    }
    return toErrorResponse(error);
  }
}
