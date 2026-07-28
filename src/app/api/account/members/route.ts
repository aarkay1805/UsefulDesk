// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { canManageMembers, isAccountRole } from '@/lib/auth/roles';
import type { AccountMember } from '@/types';

interface MemberRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase.rpc('list_account_members', {
      p_account_id: ctx.accountId,
    });

    if (error) {
      console.error('[GET /api/account/members] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load members' },
        { status: 500 }
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = (data as MemberRow[]).flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? '',
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.role,
          joined_at: row.joined_at,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
