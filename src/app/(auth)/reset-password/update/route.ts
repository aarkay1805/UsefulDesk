import { NextResponse, type NextRequest } from 'next/server';

import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  RECOVERY_INTENT_COOKIE,
  RECOVERY_INTENT_COOKIE_OPTIONS,
  verifyRecoveryIntent,
} from '@/lib/auth/recovery-intent';
import { createClient } from '@/lib/supabase/server';

const MIN_PASSWORD_LENGTH = 8;

function clearRecoveryIntent(response: NextResponse): NextResponse {
  response.cookies.set(RECOVERY_INTENT_COOKIE, '', {
    ...RECOVERY_INTENT_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}

async function authorizedRecovery(request: NextRequest) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const token = request.cookies.get(RECOVERY_INTENT_COOKIE)?.value;
  if (!verifyRecoveryIntent(token, user.id, secret)) return null;
  return { supabase };
}

export async function GET(request: NextRequest) {
  const recovery = await authorizedRecovery(request);
  return NextResponse.json(
    { allowed: Boolean(recovery) },
    {
      headers: { 'Cache-Control': 'private, no-store' },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    requireSameOriginRequest(request);
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const recovery = await authorizedRecovery(request);
  if (!recovery) {
    return clearRecoveryIntent(
      NextResponse.json(
        { error: 'This password reset link is invalid or has expired.' },
        { status: 403 }
      )
    );
  }

  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  if (
    !body ||
    typeof body.password !== 'string' ||
    body.password.length < MIN_PASSWORD_LENGTH
  ) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const { error } = await recovery.supabase.auth.updateUser({
    password: body.password,
  });
  if (error) {
    return NextResponse.json(
      { error: 'Password could not be updated. Request a new reset link.' },
      { status: 400 }
    );
  }

  return clearRecoveryIntent(NextResponse.json({ ok: true }));
}
