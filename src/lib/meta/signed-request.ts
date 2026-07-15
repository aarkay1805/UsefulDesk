import crypto from 'node:crypto'

/**
 * Parse and verify a Meta `signed_request`.
 *
 * Meta's Data Deletion Request callback (and the deauthorize callback)
 * POST a single `signed_request` form field of the form
 * `<signature>.<payload>`, where both halves are base64url and
 *
 *   signature = HMAC-SHA256(payload_string, APP_SECRET)   // raw bytes
 *   payload   = base64url(JSON.stringify({ user_id, algorithm, ... }))
 *
 * Critically, the HMAC is computed over the **encoded payload string**
 * (the second segment as received), NOT over the decoded JSON — decode
 * only after the signature checks out.
 *
 * Reference:
 *   https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 *
 * Returns the decoded payload on success, or `null` on any failure
 * (malformed input, wrong/oversized signature, unexpected algorithm,
 * missing `user_id`). Never throws — callers treat `null` as "reject".
 */
export interface SignedRequestPayload {
  /** App-scoped Facebook user id (ASID) the request concerns. */
  user_id: string
  /** Meta always sends "HMAC-SHA256"; we reject anything else. */
  algorithm?: string
  /** Unix seconds the request was issued. */
  issued_at?: number
  [key: string]: unknown
}

export function parseSignedRequest(
  signedRequest: string | null | undefined,
  appSecret: string,
): SignedRequestPayload | null {
  if (!appSecret) return null
  if (typeof signedRequest !== 'string' || !signedRequest.includes('.')) {
    return null
  }

  const dot = signedRequest.indexOf('.')
  const encodedSig = signedRequest.slice(0, dot)
  const encodedPayload = signedRequest.slice(dot + 1)
  if (!encodedSig || !encodedPayload) return null

  let actual: Buffer
  let expected: Buffer
  try {
    actual = Buffer.from(encodedSig, 'base64url')
    expected = crypto
      .createHmac('sha256', appSecret)
      .update(encodedPayload)
      .digest()
  } catch {
    return null
  }

  // timingSafeEqual throws on length mismatch — check first.
  if (actual.length !== expected.length) return null
  if (!crypto.timingSafeEqual(actual, expected)) return null

  let json: unknown
  try {
    json = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null

  const payload = json as SignedRequestPayload
  if (typeof payload.user_id !== 'string' || payload.user_id.length === 0) {
    return null
  }

  // Defensive: Meta signs with HMAC-SHA256. Reject any other declared
  // algorithm rather than trusting a payload that claims something else.
  if (
    payload.algorithm != null &&
    String(payload.algorithm).toUpperCase().replace(/[-_]/g, '') !== 'HMACSHA256'
  ) {
    return null
  }

  return payload
}
