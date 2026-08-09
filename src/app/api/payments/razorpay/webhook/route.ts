import { after, NextResponse } from 'next/server';

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
import {
  createRazorpayWebhookEventStore,
  parseRazorpayEvent,
  processClaimedRazorpayWebhook,
} from '@/lib/payments/razorpay-webhook-processor';
import {
  acknowledgeRazorpayRetryAcceptance,
  consumeRazorpayRetryAcceptance,
} from '@/lib/payments/razorpay-webhook-retry-acceptance';

export const runtime = 'nodejs';

/**
 * Razorpay application webhook for the isolated Stage 2 rollout. Every signed
 * delivery is observed. A resolved account may claim canonical state only
 * after its atomic selector has moved to `application`; legacy-selected rows
 * remain observation-only. Durable claim precedes the fast acknowledgement,
 * while `after()` and the recovery cron share the same owner-leased processor.
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
    const event = parseRazorpayEvent(rawBody);
    const preliminary = buildRazorpayWebhookDeliveryIdentity({
      rawBody,
      headerEventId: request.headers.get('x-razorpay-event-id'),
      providerMode,
      externalAccountId: '',
    });
    const externalAccountId = preliminary.observation.accountId;
    if (!externalAccountId || event.account_id !== externalAccountId) {
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
    const canonical = resolved?.canonicalIngress === 'application';

    await recordRazorpayWebhookDelivery(admin, {
      providerMode,
      identity,
      ingress: 'application',
      externalAccountId,
      accountId: resolved?.accountId ?? null,
      signatureSecretGeneration: signatureGeneration,
      shadowOnly: !canonical,
    });

    if (!canonical) {
      return NextResponse.json({ ok: true, observed: true });
    }

    const retryAcceptance = await consumeRazorpayRetryAcceptance({
      admin,
      accountId: resolved.accountId,
      providerEventId: identity.providerEventId,
      eventIdentitySource: identity.eventIdentitySource,
      payloadSha256: identity.observation.payloadSha256,
      signatureGeneration,
      event,
    });
    if (retryAcceptance.action === 'conflict') {
      return NextResponse.json(
        { error: 'Retry acceptance identity conflict' },
        { status: 409 }
      );
    }
    if (retryAcceptance.action === 'retry') {
      return NextResponse.json(
        { error: 'Retry requested' },
        { status: 503, headers: { 'retry-after': '60' } }
      );
    }

    const { store, processingOwner } = createRazorpayWebhookEventStore({
      admin,
      accountId: resolved?.accountId ?? null,
      externalAccountId,
      providerMode,
      identity,
      event,
    });
    const claim = await store.claim();
    if (claim === 'conflict') {
      return NextResponse.json(
        { error: 'Event id conflicts with another canonical event' },
        { status: 409 }
      );
    }
    if (
      retryAcceptance.action === 'redelivery' &&
      retryAcceptance.acceptanceId
    ) {
      await acknowledgeRazorpayRetryAcceptance({
        admin,
        acceptanceId: retryAcceptance.acceptanceId,
        accountId: resolved.accountId,
        providerEventId: identity.providerEventId,
        payloadSha256: identity.observation.payloadSha256,
        claimResult: claim,
      });
    }
    if (claim === 'processed') {
      return NextResponse.json({ ok: true, deduped: true });
    }
    if (claim === 'busy') {
      return NextResponse.json({ ok: true, processing: true });
    }

    after(async () => {
      try {
        const result = await processClaimedRazorpayWebhook({
          admin,
          accountId: resolved?.accountId ?? null,
          eventId: identity.providerEventId,
          processingOwner,
          event,
          ingress: 'application',
        });
        if (result.outcome === 'failed') {
          console.error(
            '[razorpay application webhook] canonical handler failed:',
            result.error
          );
        }
      } catch (error) {
        console.error(
          '[razorpay application webhook] post-response processing failed:',
          error
        );
      }
    });
    return NextResponse.json({ ok: true, accepted: true });
  } catch (error) {
    if (error instanceof RazorpayWebhookObservationError) {
      const status = error.code === 'payload_too_large' ? 413 : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'malformed_payload' }, { status: 400 });
    }
    console.error('[razorpay application webhook] delivery failed:', error);
    return NextResponse.json(
      { error: 'Could not persist webhook delivery' },
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
