import { timingSafeEqual } from 'node:crypto'

/**
 * Shared auth for the cron endpoints (`/api/renewals/cron`,
 * `/api/follow-ups/cron`, `/api/automations/cron`, `/api/flows/cron`).
 *
 * Two delivery mechanisms are accepted, so any scheduler works:
 *
 *  - `x-cron-secret: <secret>` — external pingers that can set custom
 *    headers (GitHub Actions, cron-job.org, curl).
 *  - `Authorization: Bearer <secret>` — native Vercel Cron, which cannot
 *    send custom headers; it injects the reserved `CRON_SECRET` env var
 *    as a bearer token automatically.
 *
 * The secret is `AUTOMATION_CRON_SECRET` (the one operators already
 * provision), with `CRON_SECRET` accepted as an equivalent so a Vercel
 * setup needs no duplicate value. All comparisons are constant-time —
 * an attacker who can hit the endpoint must not be able to recover the
 * secret byte-by-byte from response-time deltas (same rationale as
 * `verifyMetaWebhookSignature`). The length pre-check timingSafeEqual
 * requires leaks only the length, which isn't sensitive.
 */

function safeEqual(supplied: string, expected: string): boolean {
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  return (
    suppliedBuf.length === expectedBuf.length &&
    timingSafeEqual(suppliedBuf, expectedBuf)
  )
}

function configuredSecrets(): string[] {
  return [process.env.AUTOMATION_CRON_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => Boolean(s),
  )
}

/** True when at least one cron secret is provisioned (else routes 503). */
export function cronSecretConfigured(): boolean {
  return configuredSecrets().length > 0
}

/** True when the request carries a valid cron secret via either header. */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secrets = configuredSecrets()
  if (secrets.length === 0) return false

  const supplied: string[] = []
  const header = request.headers.get('x-cron-secret')
  if (header) supplied.push(header)
  const bearer = request.headers.get('authorization')
  if (bearer?.startsWith('Bearer ')) supplied.push(bearer.slice('Bearer '.length))

  return supplied.some((s) => secrets.some((secret) => safeEqual(s, secret)))
}
