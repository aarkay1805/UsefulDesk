import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import {
  getRazorpayConnectionStatus,
  saveManualRazorpayCredentials,
} from '@/lib/payments/credentials';

export const runtime = 'nodejs';

interface ManualCredentialRequest {
  keyId?: unknown;
  keySecret?: unknown;
  webhookSecret?: unknown;
}

export async function GET() {
  try {
    const ctx = await requireSettingsAccess();
    const admin = supabaseAdmin();
    const [connection, failedEvents, missingLedger] = await Promise.all([
      getRazorpayConnectionStatus(admin, ctx.accountId),
      admin
        .from('webhook_events')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('gateway', 'razorpay')
        .eq('processing_status', 'failed'),
      admin
        .from('razorpay_missing_payment_ledger')
        .select(
          'event_id, gateway_payment_id, membership_id, processing_status, attempt_count, last_error, created_at, last_attempt_at, processed_at',
          { count: 'exact' }
        )
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .limit(20),
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

    return NextResponse.json({
      connection,
      health: {
        failedEventCount: failedEvents.count ?? 0,
        missingLedgerCount: missingLedger.count ?? 0,
        missingLedgerEvents: missingLedger.data ?? [],
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSettingsAccess();
    const body = (await request.json()) as ManualCredentialRequest;
    const keyId =
      typeof body.keyId === 'string' ? body.keyId.trim() || null : null;
    const keySecret =
      typeof body.keySecret === 'string' ? body.keySecret.trim() : '';
    const webhookSecret =
      typeof body.webhookSecret === 'string' ? body.webhookSecret.trim() : '';

    if (
      (keyId && keyId.length > 200) ||
      keySecret.length > 500 ||
      webhookSecret.length > 500
    ) {
      return NextResponse.json(
        { error: 'Razorpay credential value is too long' },
        { status: 400 }
      );
    }

    const connection = await saveManualRazorpayCredentials(
      supabaseAdmin(),
      ctx.accountId,
      {
        keyId,
        keySecret: keySecret || undefined,
        webhookSecret: webhookSecret || undefined,
      }
    );

    return NextResponse.json({ connection });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    }
    return toErrorResponse(error);
  }
}
