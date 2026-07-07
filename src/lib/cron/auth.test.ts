import { afterEach, describe, expect, it, vi } from 'vitest'
import { cronSecretConfigured, isAuthorizedCronRequest } from './auth'

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/renewals/cron', { headers })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cronSecretConfigured', () => {
  it('is false when neither env var is set', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')
    vi.stubEnv('CRON_SECRET', '')
    expect(cronSecretConfigured()).toBe(false)
  })

  it('is true with AUTOMATION_CRON_SECRET alone', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'abc')
    vi.stubEnv('CRON_SECRET', '')
    expect(cronSecretConfigured()).toBe(true)
  })

  it('is true with CRON_SECRET alone (Vercel-style setup)', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')
    vi.stubEnv('CRON_SECRET', 'abc')
    expect(cronSecretConfigured()).toBe(true)
  })
})

describe('isAuthorizedCronRequest', () => {
  it('accepts a matching x-cron-secret header', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'top-secret')
    expect(isAuthorizedCronRequest(req({ 'x-cron-secret': 'top-secret' }))).toBe(
      true,
    )
  })

  it('accepts a matching Authorization bearer token (native Vercel Cron)', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'top-secret')
    expect(
      isAuthorizedCronRequest(req({ authorization: 'Bearer top-secret' })),
    ).toBe(true)
  })

  it('accepts a bearer token matching CRON_SECRET when the two vars differ', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'gha-secret')
    vi.stubEnv('CRON_SECRET', 'vercel-secret')
    expect(
      isAuthorizedCronRequest(req({ authorization: 'Bearer vercel-secret' })),
    ).toBe(true)
    expect(isAuthorizedCronRequest(req({ 'x-cron-secret': 'gha-secret' }))).toBe(
      true,
    )
  })

  it('rejects a wrong secret on either header', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'top-secret')
    expect(isAuthorizedCronRequest(req({ 'x-cron-secret': 'nope' }))).toBe(false)
    expect(isAuthorizedCronRequest(req({ authorization: 'Bearer nope' }))).toBe(
      false,
    )
  })

  it('rejects a secret of a different length (timingSafeEqual pre-check)', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'top-secret')
    expect(
      isAuthorizedCronRequest(req({ 'x-cron-secret': 'top-secret-longer' })),
    ).toBe(false)
  })

  it('rejects when no header is supplied at all', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'top-secret')
    expect(isAuthorizedCronRequest(req({}))).toBe(false)
  })

  it('rejects a non-Bearer authorization scheme', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'top-secret')
    expect(
      isAuthorizedCronRequest(req({ authorization: 'Basic top-secret' })),
    ).toBe(false)
  })

  it('rejects everything when no secret is configured', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')
    vi.stubEnv('CRON_SECRET', '')
    expect(isAuthorizedCronRequest(req({ 'x-cron-secret': '' }))).toBe(false)
  })
})
