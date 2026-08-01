import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { canSellProductsServices } from '@/lib/auth/roles';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import type { CheckoutMode } from '@/types';

const MODES = new Set<CheckoutMode>([
  'join',
  'convert',
  'membership_renewal',
  'sale',
  'service_renewal',
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    if (!canSellProductsServices(ctx.role)) {
      return NextResponse.json(
        { error: 'Agent access is required' },
        { status: 403 }
      );
    }

    const limit = checkRateLimit(
      `member-checkout:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const mode = body?.mode;
    const contactId = body?.contact_id;
    const idempotencyKey = body?.idempotency_key;
    if (typeof mode !== 'string' || !MODES.has(mode as CheckoutMode)) {
      return NextResponse.json(
        { error: 'Invalid checkout mode' },
        { status: 400 }
      );
    }
    if (typeof contactId !== 'string' || !UUID.test(contactId)) {
      return NextResponse.json(
        { error: 'A valid member contact is required' },
        { status: 400 }
      );
    }
    if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)) {
      return NextResponse.json(
        { error: 'A valid idempotency key is required' },
        { status: 400 }
      );
    }
    if (!Array.isArray(body?.selections)) {
      return NextResponse.json(
        { error: 'Selections must be an array' },
        { status: 400 }
      );
    }

    // The selected branch is authoritative. Never trust account_id supplied by
    // a browser; the RPC repeats the membership and contact tenancy checks.
    const payload = { ...body, account_id: ctx.accountId };
    const joinsExistingContact =
      (mode === 'join' || mode === 'convert') &&
      typeof body?.membership_id !== 'string';
    const { data, error } = await ctx.supabase.rpc(
      joinsExistingContact
        ? 'perform_join_checkout'
        : 'perform_member_checkout',
      {
        p_payload: payload,
      }
    );
    if (error) {
      console.error('[POST /api/member-checkouts] checkout failed:', error);
      return NextResponse.json(
        { error: error.message || 'Checkout failed' },
        { status: error.code === '42501' ? 403 : 400 }
      );
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
