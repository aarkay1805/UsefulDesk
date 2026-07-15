// ============================================================
// POST /api/meta/data-deletion
//
// Meta's **Data Deletion Request Callback** (App Dashboard → App
// Settings → Basic → "Data Deletion Request URL"). Meta POSTs a
// form-encoded `signed_request` here when a Facebook user who used
// Facebook Login with this app asks to delete their data (e.g. via
// their Facebook "Apps and Websites" settings, or when they remove
// the app).
//
// Contract Meta enforces:
//   • Verify the signed_request against META_APP_SECRET.
//   • Respond 200 with JSON { url, confirmation_code }, where `url`
//     is a page the user can visit to see the status of the request
//     and `confirmation_code` is a token we can look that status up
//     by. Meta shows both back to the user.
//
// What we actually hold for a Facebook login user
// -----------------------------------------------
// This platform uses Facebook Login for Business only to obtain
// *business assets* (a WABA / Page the user administers) during
// Embedded Signup and Lead Ads connect. We do not store the login
// user's Facebook profile (name, email, friends, etc.) keyed by
// their app-scoped id, so there is typically no personal profile
// data to erase for a given `user_id`. We still record every request
// with a confirmation code and surface its status, and an account
// owner can erase ALL of their gym's Platform Data at any time via
// DELETE /api/account (self-service, owner-only).
//
// Reference:
//   https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
// ============================================================

import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { parseSignedRequest } from '@/lib/meta/signed-request'

// The webhook demux and this callback both run on serverless
// platforms; keep this a Node runtime so `node:crypto` is available.
export const runtime = 'nodejs'

function statusBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '')
  if (configured) return configured
  // Fall back to the request origin when SITE_URL isn't pinned.
  try {
    return new URL(request.url).origin
  } catch {
    return ''
  }
}

export async function POST(request: Request) {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    // Fail closed: without the secret we cannot verify anything, so we
    // must not hand back a confirmation for an unverified request.
    console.error(
      '[data-deletion] META_APP_SECRET is not set — cannot verify signed_request.',
    )
    return NextResponse.json(
      { error: 'Server is not configured for data deletion requests.' },
      { status: 500 },
    )
  }

  // Meta sends application/x-www-form-urlencoded. Be lenient and also
  // accept a JSON body (some test tools post JSON).
  let signedRequest: string | null = null
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = (await request.json().catch(() => null)) as {
        signed_request?: unknown
      } | null
      signedRequest =
        typeof body?.signed_request === 'string' ? body.signed_request : null
    } else {
      const form = await request.formData()
      const value = form.get('signed_request')
      signedRequest = typeof value === 'string' ? value : null
    }
  } catch {
    signedRequest = null
  }

  const payload = parseSignedRequest(signedRequest, appSecret)
  if (!payload) {
    // Invalid or unsigned — do not issue a confirmation code.
    return NextResponse.json(
      { error: 'Invalid signed_request.' },
      { status: 400 },
    )
  }

  const confirmationCode = crypto.randomBytes(16).toString('hex')

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { error } = await admin.from('data_deletion_requests').insert({
    source: 'meta_callback',
    meta_user_id: payload.user_id,
    confirmation_code: confirmationCode,
    status: 'received',
  })

  if (error) {
    // If we can't record it, return 500 so Meta retries rather than
    // handing the user a code that resolves to nothing.
    console.error('[data-deletion] failed to record request:', error)
    return NextResponse.json(
      { error: 'Could not record the deletion request.' },
      { status: 500 },
    )
  }

  const base = statusBaseUrl(request)
  return NextResponse.json({
    url: `${base}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  })
}
