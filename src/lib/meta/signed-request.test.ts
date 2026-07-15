import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { parseSignedRequest } from './signed-request'

const SECRET = 'test-app-secret'

/** Build a valid Meta-style signed_request for the given payload. */
function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  )
  const sig = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url')
  return `${sig}.${encodedPayload}`
}

describe('parseSignedRequest', () => {
  it('accepts a correctly signed request and returns the payload', () => {
    const req = sign({
      user_id: '1234567890',
      algorithm: 'HMAC-SHA256',
      issued_at: 1_700_000_000,
    })
    const out = parseSignedRequest(req, SECRET)
    expect(out).not.toBeNull()
    expect(out?.user_id).toBe('1234567890')
  })

  it('rejects a request signed with a different secret', () => {
    const req = sign({ user_id: 'abc' }, 'attacker-secret')
    expect(parseSignedRequest(req, SECRET)).toBeNull()
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const req = sign({ user_id: 'abc' })
    const [sig] = req.split('.')
    const forged = Buffer.from(JSON.stringify({ user_id: 'evil' })).toString(
      'base64url',
    )
    expect(parseSignedRequest(`${sig}.${forged}`, SECRET)).toBeNull()
  })

  it('rejects a non HMAC-SHA256 algorithm', () => {
    const req = sign({ user_id: 'abc', algorithm: 'MD5' })
    expect(parseSignedRequest(req, SECRET)).toBeNull()
  })

  it('rejects a payload missing user_id', () => {
    const req = sign({ algorithm: 'HMAC-SHA256' })
    expect(parseSignedRequest(req, SECRET)).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(parseSignedRequest('', SECRET)).toBeNull()
    expect(parseSignedRequest('no-dot-here', SECRET)).toBeNull()
    expect(parseSignedRequest('.', SECRET)).toBeNull()
    expect(parseSignedRequest(null, SECRET)).toBeNull()
  })

  it('rejects when the app secret is empty', () => {
    const req = sign({ user_id: 'abc' })
    expect(parseSignedRequest(req, '')).toBeNull()
  })
})
