import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  requirePaymentGatewayAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  getRazorpayDiagnosticScope,
  getRazorpayConnectionStatus,
} from '@/lib/payments/credentials';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const ctx = await requirePaymentGatewayAccess();
    const admin = supabaseAdmin();
    const [connection, diagnosticScope] = await Promise.all([
      getRazorpayConnectionStatus(admin, ctx.accountId),
      getRazorpayDiagnosticScope(admin, ctx.accountId),
    ]);
    const diagnosticMode = diagnosticScope?.providerMode ?? '__unscoped__';
    const diagnosticMerchant =
      diagnosticScope?.externalAccountId ?? '__unscoped__';
    const [
      failedEvents,
      missingLedger,
      unappliedCharges,
      setupExceptions,
      paymentLinkExceptions,
      paymentLinkSetupExceptions,
    ] = await Promise.all([
      admin
        .from('webhook_events')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('gateway', 'razorpay')
        .eq('provider_mode', diagnosticMode)
        .eq('external_account_id', diagnosticMerchant)
        .eq('processing_status', 'failed'),
      admin
        .from('razorpay_missing_payment_ledger')
        .select(
          'event_id, gateway_payment_id, membership_id, processing_status, attempt_count, last_error, created_at, last_attempt_at, processed_at',
          { count: 'exact' }
        )
        .eq('account_id', ctx.accountId)
        .eq('provider_mode', diagnosticMode)
        .eq('external_account_id', diagnosticMerchant)
        .order('created_at', { ascending: false })
        .limit(20),
      admin
        .from('gateway_charge_exceptions')
        .select(
          'id, gateway_payment_id, gateway_subscription_id, provider_paid_count, amount, currency, reason_code, reason_message, first_seen_at, last_seen_at, attempt_count',
          { count: 'exact' }
        )
        .eq('account_id', ctx.accountId)
        .eq('gateway', 'razorpay')
        .eq('status', 'open')
        .order('first_seen_at', { ascending: false })
        .limit(20),
      admin
        .from('payment_mandates')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .or(
          'status.in.(creating,orphaned),and(setup_error.not.is.null,gateway_subscription_id.not.is.null)'
        ),
      admin
        .from('gateway_payment_exceptions')
        .select('id, reason_message', { count: 'exact' })
        .eq('account_id', ctx.accountId)
        .eq('status', 'open')
        .order('first_seen_at', { ascending: false })
        .limit(20),
      admin
        .from('razorpay_payment_links')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .in('status', ['orphaned']),
    ]);

    if (failedEvents.error) {
      throw new Error(
        `load failed webhook count: ${failedEvents.error.message}`
      );
    }
    if (missingLedger.error) {
      throw new Error(
        `load missing-ledger events: ${missingLedger.error.message}`
      );
    }
    if (unappliedCharges.error) {
      throw new Error(
        `load unapplied Razorpay charges: ${unappliedCharges.error.message}`
      );
    }
    if (setupExceptions.error) {
      throw new Error(
        `load Razorpay setup exceptions: ${setupExceptions.error.message}`
      );
    }
    if (paymentLinkExceptions.error) {
      throw new Error(
        `load Razorpay Payment Link exceptions: ${paymentLinkExceptions.error.message}`
      );
    }
    if (paymentLinkSetupExceptions.error) {
      throw new Error(
        `load Razorpay Payment Link setup exceptions: ${paymentLinkSetupExceptions.error.message}`
      );
    }

    return NextResponse.json({
      connection,
      health: {
        failedEventCount: failedEvents.count ?? 0,
        missingLedgerCount: missingLedger.count ?? 0,
        missingLedgerEvents: missingLedger.data ?? [],
        unappliedChargeCount: unappliedCharges.count ?? 0,
        unappliedCharges: unappliedCharges.data ?? [],
        setupExceptionCount: setupExceptions.count ?? 0,
        paymentLinkExceptionCount: paymentLinkExceptions.count ?? 0,
        paymentLinkSetupExceptionCount: paymentLinkSetupExceptions.count ?? 0,
        latestPaymentLinkReason:
          paymentLinkExceptions.data?.[0]?.reason_message ?? null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
