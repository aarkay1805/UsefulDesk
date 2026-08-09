import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { canManagePaymentLinks } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  createOrReuseInvoicePaymentLink,
  PaymentLinkConflictError,
} from '@/lib/payments/razorpay-payment-links';
import { RazorpayError } from '@/lib/payments/razorpay';
import { getRazorpayConnectionStatus } from '@/lib/payments/credentials';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const invoiceId = new URL(request.url).searchParams.get('invoiceId');
    if (!invoiceId) {
      return NextResponse.json(
        { error: 'invoiceId is required' },
        { status: 400 }
      );
    }
    const { data: invoice } = await ctx.supabase
      .from('invoices')
      .select('id')
      .eq('id', invoiceId)
      .maybeSingle();
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    const { data, error } = await ctx.supabase
      .from('razorpay_payment_links')
      .select(
        'id, invoice_id, revision, short_url, expires_at, status, expected_amount, currency, created_at'
      )
      .eq('invoice_id', invoiceId)
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`load Payment Link: ${error.message}`);
    const connection = await getRazorpayConnectionStatus(
      supabaseAdmin(),
      ctx.accountId
    );
    return NextResponse.json({
      link: data ?? null,
      availability: {
        ready: connection.configured,
        reason: connection.configured
          ? null
          : connection.connectionStatus === 'reconnect_required'
            ? 'Reconnect Razorpay in Settings → Payments'
            : connection.connectionStatus === 'blocked'
              ? 'Razorpay needs attention in Settings → Payments'
              : 'Connect Razorpay in Settings → Payments',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requireRole('agent');
    if (!canManagePaymentLinks(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = (await request.json()) as { invoiceId?: unknown };
    const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId : '';
    if (!invoiceId) {
      return NextResponse.json(
        { error: 'invoiceId is required' },
        { status: 400 }
      );
    }
    const { data: invoice, error: invoiceError } = await ctx.supabase
      .from('invoices')
      .select('id')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    const link = await createOrReuseInvoicePaymentLink({
      admin: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      invoiceId,
    });
    return NextResponse.json({ link });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    if (error instanceof PaymentLinkConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RazorpayError) {
      console.error(
        '[Razorpay Payment Link] provider request failed:',
        error.status
      );
      return NextResponse.json(
        { error: 'Razorpay could not create the payment link' },
        { status: error.status >= 400 && error.status < 500 ? 400 : 502 }
      );
    }
    return toErrorResponse(error);
  }
}
