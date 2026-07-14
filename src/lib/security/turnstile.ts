// ============================================================
// Cloudflare Turnstile — bot check for the public capture form.
//
// The form is the only unauthenticated WRITE endpoint in the product,
// which makes it the only real spam magnet. The per-IP rate limiter in
// src/lib/rate-limit.ts is an in-memory Map — per-lambda, so Vercel's
// fan-out silently multiplies the budget (its own header says so). It
// is a speed bump. THIS is the wall.
// ============================================================

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Whether Turnstile is wired up at all. The form widget and the
 *  server check both key off this, so a deploy without Cloudflare
 *  simply has no widget rather than an unclickable broken one. */
export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export type TurnstileResult =
  | { ok: true }
  /** Misconfiguration, not a bot — the caller must 503, never 403. */
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'failed' };

/**
 * Verify a Turnstile token against Cloudflare.
 *
 * Fails CLOSED in production when the secret is unset: a prod deploy
 * that forgot the env var would otherwise expose a public insert
 * endpoint guarded only by a honeypot and a rate limiter that leaks
 * across instances. A loud 503 is strictly better than a quiet hole —
 * the same reasoning as `verifyMetaWebhookSignature`, which refuses to
 * run without META_APP_SECRET.
 *
 * Outside production it passes through, so local dev and self-hosters
 * without a Cloudflare account aren't blocked.
 *
 * A Cloudflare outage also fails closed. That is the intended trade: a
 * form that is briefly down is recoverable, a lead table full of spam
 * is not.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[turnstile] TURNSTILE_SECRET_KEY is unset in production — ' +
          'refusing the submission. The public capture form is disabled ' +
          'until it is configured.'
      );
      return { ok: false, reason: 'not_configured' };
    }
    console.warn('[turnstile] no secret configured — skipping check (dev only)');
    return { ok: true };
  }

  if (!token) return { ok: false, reason: 'failed' };

  try {
    const body = new FormData();
    body.append('secret', secret);
    body.append('response', token);
    if (ip && ip !== 'unknown') body.append('remoteip', ip);

    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const data = (await res.json()) as {
      success?: boolean;
      'error-codes'?: string[];
    };

    if (!data.success) {
      console.warn(
        '[turnstile] verification failed:',
        data['error-codes']?.join(', ') ?? 'unknown'
      );
      return { ok: false, reason: 'failed' };
    }
    return { ok: true };
  } catch (error) {
    console.error('[turnstile] siteverify request failed:', error);
    return { ok: false, reason: 'failed' };
  }
}
