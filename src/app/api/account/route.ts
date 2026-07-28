// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — rename the account.                  Admin+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from 'next/server';

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { canArchiveBranch } from '@/lib/auth/roles';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
    } | null;
    const rawName = body?.name;

    if (typeof rawName !== 'string') {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 }
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: 'Account name cannot be empty' },
        { status: 400 }
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 }
      );
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from('accounts')
      .update({ name })
      .eq('id', ctx.accountId)
      .select('id, name')
      .single();

    if (error) {
      console.error('[PATCH /api/account] update error:', error);
      return NextResponse.json(
        { error: 'Failed to update account' },
        { status: 500 }
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ============================================================
// DELETE /api/account — compatibility verb for branch closure.
// Financial and message history is retained; the selected branch becomes
// archived/read-only instead of cascading data or deleting shared users.
// ============================================================
export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    if (!canArchiveBranch(ctx.role)) {
      return NextResponse.json(
        { error: 'Only the branch owner can archive the branch' },
        { status: 403 }
      );
    }

    const limit = checkRateLimit(
      `admin:delete-account:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Require an exact-name confirmation to proceed.
    const body = (await request.json().catch(() => null)) as {
      confirm?: unknown;
    } | null;
    const confirm = typeof body?.confirm === 'string' ? body.confirm : '';
    if (confirm !== ctx.account.name) {
      return NextResponse.json(
        {
          error:
            'Confirmation does not match. Type the branch name exactly to archive it.',
        },
        { status: 400 }
      );
    }

    const { error } = await ctx.supabase.rpc('archive_branch', {
      p_account_id: ctx.accountId,
    });
    if (error) {
      console.error('[DELETE /api/account] archive failed:', error);
      return NextResponse.json(
        {
          error:
            error.code === '55000'
              ? error.message
              : 'Failed to archive the branch.',
        },
        { status: error.code === '55000' ? 409 : 500 }
      );
    }

    return NextResponse.json({ success: true, archived: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
