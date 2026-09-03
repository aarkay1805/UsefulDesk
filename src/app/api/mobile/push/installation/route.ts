import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireMobileUser } from '@/lib/auth/mobile-user-access';
import { pushAdmin } from '@/lib/push/admin-client';
import {
  parseInstallationInput,
  parseRevocationInput,
  revokePushInstallation,
  upsertPushInstallation,
} from '@/lib/push/installation-store';

async function authenticated(
  request: Request
): Promise<
  | { ok: true; access: { userId: string; accessToken: string } }
  | { ok: false; response: NextResponse }
> {
  try {
    return { ok: true, access: await requireMobileUser(request) };
  } catch (error) {
    return { ok: false, response: toErrorResponse(error) };
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  const auth = await authenticated(request);
  if (!auth.ok) return auth.response;

  let input;
  try {
    input = parseInstallationInput(await request.json());
  } catch {
    return NextResponse.json(
      { error: 'Invalid push installation' },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(
      await upsertPushInstallation(pushAdmin(), auth.access.userId, input)
    );
  } catch {
    console.error('[push/installation] registration failed');
    return NextResponse.json(
      { error: 'Push installation unavailable' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = await authenticated(request);
  if (!auth.ok) return auth.response;

  let input;
  try {
    input = parseRevocationInput(await request.json());
  } catch {
    return NextResponse.json(
      { error: 'Invalid push installation' },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(
      await revokePushInstallation(
        pushAdmin(),
        auth.access.userId,
        input.installationId
      )
    );
  } catch {
    console.error('[push/installation] revocation failed');
    return NextResponse.json(
      { error: 'Push installation unavailable' },
      { status: 500 }
    );
  }
}
