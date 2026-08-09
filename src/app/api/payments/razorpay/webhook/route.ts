import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { verifyWebhookSignature } from '@/lib/payments/razorpay';
import { getRazorpayProviderMode } from '@/lib/payments/razorpay-config';
import {
  buildRazorpayWebhookDeliveryIdentity,
  recordRazorpayWebhookDelivery,
  resolveRazorpayApplicationAccount,
  type RazorpayWebhookSignatureGeneration,
} from '@/lib/payments/razorpay-webhook-delivery';
import { RazorpayWebhookObservationError } from '@/lib/payments/razorpay-webhook-observation';

export const runtime = 'nodejs';

/**
 * Durable observation-only application webhook. Stage 2 deliberately stops
 * before canonical processing until real legacy/application parity has been
 * proven and the account-scoped ingress selector is cut over.
 */
export async function POST(request: Request) {
  let providerMode;
  try {
    providerMode = getRazorpayProviderMode();
  } catch {
    return NextResponse.json(
      { error: 'Webhook is not configured' },
      { status: 503 }
    );
  }
  if (
    providerMode !== 'test' ||
    process.env.RAZORPAY_PROVIDER_ACCEPTANCE_ONLY !== 'true'
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const currentSecret = process.env.RAZORPAY_WEBHOOK_SECRET_CURRENT;
  const previousSecret = process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS;
  if (!currentSecret) {
    console.error(
      '[razorpay application webhook] current secret is not configured'
    );
    return NextResponse.json(
      { error: 'Webhook is not configured' },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  const signatureGeneration = verifiedSignatureGeneration(
    rawBody,
    signature,
    currentSecret,
    previousSecret
  );
  if (!signatureGeneration) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const preliminary = buildRazorpayWebhookDeliveryIdentity({
      rawBody,
      headerEventId: request.headers.get('x-razorpay-event-id'),
      providerMode,
      externalAccountId: '',
    });
    const externalAccountId = preliminary.observation.accountId;
    if (!externalAccountId) {
      return NextResponse.json(
        { error: 'missing_account_id' },
        { status: 400 }
      );
    }
    const identity = buildRazorpayWebhookDeliveryIdentity({
      rawBody,
      headerEventId: request.headers.get('x-razorpay-event-id'),
      providerMode,
      externalAccountId,
    });
    const admin = supabaseAdmin();
    const resolved = await resolveRazorpayApplicationAccount(
      admin,
      providerMode,
      externalAccountId
    );

    // A canonical application event must never be acknowledged by an
    // observation-only build. This fail-closed branch also protects against
    // an operator flipping the database selector before parity acceptance.
    if (resolved?.canonicalIngress === 'application') {
      console.error(
        '[razorpay application webhook] canonical ingress selected before the processor is enabled'
      );
      return NextResponse.json(
        { error: 'Canonical application ingress is not enabled' },
        { status: 503 }
      );
    }

    await recordRazorpayWebhookDelivery(admin, {
      providerMode,
      identity,
      ingress: 'application',
      externalAccountId,
      accountId: resolved?.accountId ?? null,
      signatureSecretGeneration: signatureGeneration,
      shadowOnly: true,
    });
    return NextResponse.json({ ok: true, observed: true });
  } catch (error) {
    if (error instanceof RazorpayWebhookObservationError) {
      const status = error.code === 'payload_too_large' ? 413 : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    console.error(
      '[razorpay application webhook] delivery observation failed:',
      error
    );
    return NextResponse.json(
      { error: 'Could not persist delivery observation' },
      { status: 500 }
    );
  }
}

function verifiedSignatureGeneration(
  rawBody: string,
  signature: string | null,
  currentSecret: string,
  previousSecret: string | undefined
): RazorpayWebhookSignatureGeneration | null {
  if (verifyWebhookSignature(rawBody, signature, currentSecret)) {
    return 'current';
  }
  if (
    previousSecret &&
    verifyWebhookSignature(rawBody, signature, previousSecret)
  ) {
    return 'previous';
  }
  return null;
}
