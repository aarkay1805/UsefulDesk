import { NextResponse } from 'next/server';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { registerPhoneNumber } from '@/lib/whatsapp/meta-api';

/**
 * POST /api/whatsapp/config/register
 *
 * Repairs Cloud API registration with the number's existing two-step PIN.
 * The saved encrypted access token stays server-side, so a guided-signup user
 * does not have to obtain and paste a system-user token into Manual setup.
 */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireSettingsAccess();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { supabase, accountId } = ctx;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400 }
    );
  }

  const pin =
    typeof body === 'object' && body !== null && 'pin' in body
      ? (body as { pin?: unknown }).pin
      : null;
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: 'PIN must be exactly 6 digits.' },
      { status: 400 }
    );
  }

  const { data: config, error: configError } = await supabase
    .from('whatsapp_config')
    .select('id, phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle();

  if (configError) {
    console.error('[whatsapp/register] config lookup failed:', configError);
    return NextResponse.json(
      { error: 'Could not load the saved WhatsApp connection.' },
      { status: 500 }
    );
  }
  if (!config) {
    return NextResponse.json(
      { error: 'Connect a WhatsApp number before entering a PIN.' },
      { status: 404 }
    );
  }

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch (err) {
    console.error('[whatsapp/register] token decryption failed:', err);
    return NextResponse.json(
      {
        error:
          'The saved access token cannot be read. Reset the connection and reconnect with Meta.',
      },
      { status: 409 }
    );
  }

  try {
    await registerPhoneNumber({
      phoneNumberId: config.phone_number_id,
      accessToken,
      pin,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[whatsapp/register] registration failed:', message);
    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update({
        registered_at: null,
        last_registration_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .select('id');
    if (updateError) {
      console.error(
        '[whatsapp/register] failed to persist provider error:',
        updateError
      );
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('whatsapp_config')
    .update({
      status: 'connected',
      connected_at: now,
      registered_at: now,
      last_registration_error: null,
      updated_at: now,
    })
    .eq('account_id', accountId)
    .select('id');

  if (updateError || !updated?.length) {
    console.error(
      '[whatsapp/register] registration succeeded but local repair failed:',
      updateError
    );
    return NextResponse.json(
      {
        error:
          'Meta accepted the PIN, but the connection status could not be saved. Try again.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
