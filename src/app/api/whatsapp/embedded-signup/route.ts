import { NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  exchangeEmbeddedSignupCode,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'

// Lazy-initialised service-role client — same rationale as
// /api/whatsapp/config: detecting a phone_number_id already claimed
// by a *different* account is invisible under the caller's RLS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

/**
 * POST /api/whatsapp/embedded-signup
 *
 * Completes Meta Embedded Signup (Facebook Login for Business).
 * The client runs FB.login() with our config_id; Meta's popup walks
 * the gym through creating/selecting a WABA + phone number, then
 * hands back an authorization `code` plus (via the WA_EMBEDDED_SIGNUP
 * message event, sessionInfoVersion 3) the `waba_id` and
 * `phone_number_id` it provisioned. This route:
 *
 *   1. exchanges the code for a business-integration token
 *      (client_id/client_secret = the platform app; token is scoped
 *      to the tenant's WABA and does not expire),
 *   2. verifies the phone with Meta (also proves the token covers it),
 *   3. registers the number for Cloud API messaging with a fresh
 *      random 2FA PIN (best-effort, same non-fatal semantics as the
 *      manual /config route),
 *   4. subscribes the WABA to our app (inbound webhooks),
 *   5. encrypts + upserts the same whatsapp_config row shape the
 *      manual flow writes — everything downstream (sends, webhook
 *      demux by phone_number_id, templates) works unchanged.
 *
 * Writes go through the caller's Supabase session, so RLS
 * (is_account_member admin) still gates who can connect WhatsApp.
 */
export async function POST(request: Request) {
  try {
    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    if (!appId || !appSecret) {
      return NextResponse.json(
        {
          error:
            'Embedded Signup is not configured on this server: META_APP_ID and META_APP_SECRET must both be set.',
        },
        { status: 500 },
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const wabaId = typeof body.waba_id === 'string' ? body.waba_id.trim() : ''
    const phoneNumberId =
      typeof body.phone_number_id === 'string' ? body.phone_number_id.trim() : ''

    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json(
        { error: 'code, waba_id and phone_number_id are required.' },
        { status: 400 },
      )
    }

    // Same one-number-one-account rule as the manual flow — two
    // accounts bound to one phone_number_id break the webhook's
    // demux lookup and silently drop every inbound message.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .neq('account_id', accountId)
      .maybeSingle()
    if (claimedError) {
      console.error('[embedded-signup] phone ownership check failed:', claimedError)
      return NextResponse.json(
        { error: 'Failed to validate the phone number.' },
        { status: 500 },
      )
    }
    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance.',
        },
        { status: 409 },
      )
    }

    // 1. Code → business-integration token.
    let accessToken: string
    try {
      accessToken = await exchangeEmbeddedSignupCode({ appId, appSecret, code })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] code exchange failed:', message)
      return NextResponse.json(
        { error: `Could not exchange the signup code with Meta: ${message}` },
        { status: 400 },
      )
    }

    // 2. Verify the phone — proves the token really covers the number
    //    Meta reported in the signup session.
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] phone verification failed:', message)
      return NextResponse.json(
        { error: `Meta rejected the connected phone number: ${message}` },
        { status: 400 },
      )
    }

    // 3. Register for Cloud API messaging. Embedded Signup numbers are
    //    freshly provisioned, so we set the two-step PIN ourselves
    //    (random 6 digits — the owner can rotate it in WhatsApp
    //    Manager). Best-effort like the manual route: a failure is
    //    stored on the row (last_registration_error) instead of
    //    failing the whole connection, since credentials + WABA
    //    subscription are already valid.
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0')
    let registeredAt: string | null = null
    let registrationError: string | null = null
    try {
      await registerPhoneNumber({ phoneNumberId, accessToken, pin })
      registeredAt = new Date().toISOString()
    } catch (err) {
      registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] /register failed:', registrationError)
    }

    // 4. Subscribe the WABA to the platform app so inbound events flow
    //    to the shared webhook. Idempotent on Meta's side.
    let subscribedAppsAt: string | null = null
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[embedded-signup] subscribed_apps failed (non-fatal):', message)
    }

    // 5. Encrypt + persist. Reuses the manual flow's row shape; no
    //    verify_token — the app-level webhook was verified once when
    //    the platform app was configured.
    let encryptedAccessToken: string
    try {
      encryptedAccessToken = encrypt(accessToken)
    } catch (err) {
      console.error('[embedded-signup] encryption failed:', err)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt the access token. Check that ENCRYPTION_KEY is a valid 64-character hex string.',
        },
        { status: 500 },
      )
    }

    const baseRow = {
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: encryptedAccessToken,
      status: 'connected',
      connected_at: new Date().toISOString(),
      registered_at: registeredAt,
      subscribed_apps_at: subscribedAppsAt,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)
      if (updateError) {
        console.error('[embedded-signup] update failed:', updateError)
        return NextResponse.json(
          { error: 'Connected with Meta but failed to save the configuration.' },
          { status: 500 },
        )
      }
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({ account_id: accountId, user_id: user.id, ...baseRow })
      if (insertError) {
        console.error('[embedded-signup] insert failed:', insertError)
        return NextResponse.json(
          { error: 'Connected with Meta but failed to save the configuration.' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      success: true,
      registered: registeredAt != null,
      registration_error: registrationError,
      subscribed: subscribedAppsAt != null,
      phone_info: phoneInfo,
    })
  } catch (error) {
    console.error('[embedded-signup] unhandled error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
