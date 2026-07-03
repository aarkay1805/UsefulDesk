import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { EmailOtpType } from '@supabase/supabase-js'

// ============================================================
// /auth/callback — the single landing point for every Supabase
// auth email link (signup confirmation, password recovery,
// email change, magic link) and OAuth redirect.
//
// Supabase can send the user here in two shapes:
//
//   1. PKCE redirect:   ?code=<auth_code>
//      The verify endpoint already validated the email token and
//      redirects with a one-time code. We exchange it for a
//      session server-side. Works only in the browser that
//      initiated the flow ONLY when the code verifier cookie is
//      present — which it is here, because @supabase/ssr stores
//      it in a cookie readable by this route handler.
//
//   2. Token-hash link: ?token_hash=<hash>&type=<otp_type>
//      Produced when the email templates are switched to
//      {{ .TokenHash }} (recommended — survives opening the link
//      in a different browser/device than the one that signed
//      up). We verify it directly with verifyOtp.
//
// Either way, on success the session cookies are written onto
// the redirect response and the user continues to `next`
// (default /dashboard). On failure we bounce to /login with a
// human-readable error in the query string.
// ============================================================

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  // Only allow same-origin relative redirects. Anything absolute
  // (or protocol-relative "//evil.com") is an open-redirect vector
  // via a crafted link, so fall back to /dashboard.
  const rawNext = searchParams.get('next') ?? '/dashboard'
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  const redirectTo = (path: string) => NextResponse.redirect(`${origin}${path}`)

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return redirectTo(next)
    console.error('[auth/callback] code exchange failed:', error.message)
    return redirectTo(
      `/login?error=${encodeURIComponent(
        'Could not verify your email link. Open it in the same browser you signed up in, or request a new one.'
      )}`
    )
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return redirectTo(next)
    console.error('[auth/callback] verifyOtp failed:', error.message)
    return redirectTo(
      `/login?error=${encodeURIComponent(
        'This link is invalid or has expired. Request a new one.'
      )}`
    )
  }

  // Supabase also reports failures (expired link, already used)
  // as ?error=...&error_description=... on the redirect itself.
  const description = searchParams.get('error_description')
  return redirectTo(
    `/login?error=${encodeURIComponent(
      description ?? 'Invalid verification link.'
    )}`
  )
}
