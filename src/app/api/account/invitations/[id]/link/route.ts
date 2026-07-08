// ============================================================
// POST /api/account/invitations/[id]/link
//
// Admin+. Mints a FRESH shareable link for an existing pending
// invitation and returns the plaintext URL.
//
// Why this exists: invite tokens are stored hashed and the
// plaintext is shown exactly once (at creation). Invites created
// server-side — e.g. a teammate conjured during a lead import —
// never surfaced a link to the admin. This endpoint rotates the
// token (new hash) and returns the new URL so the owner can copy
// it from Settings → Team → Pending invitations and share it.
//
// Rotating INVALIDATES any previously shared link for this invite
// (only one hash is stored). The UI warns accordingly. Rotation
// also refreshes the expiry to at least the default window, so a
// link copied today always works — an expired invite is revived
// by copying a new link.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
  resolveInviteBaseUrl,
} from "@/lib/auth/invitations";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:inviteLink:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Read first to verify it's a live (un-redeemed) invite in this
    // account and to preserve a deliberately-long expiry. RLS scopes
    // the SELECT to the caller's account.
    const { data: existing } = await ctx.supabase
      .from("account_invitations")
      .select("id, full_name, role, expires_at, accepted_at")
      .eq("id", id)
      .maybeSingle();

    if (!existing || existing.accepted_at) {
      // Missing / not-yours (RLS) / already redeemed → 404 either way
      // (don't leak which).
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 },
      );
    }

    // Fresh window, but never shorten a longer custom expiry.
    const freshExpiry = new Date(
      Math.max(
        new Date(existing.expires_at).getTime(),
        inviteExpiresAt(undefined).getTime(),
      ),
    );

    const { token, hash } = generateInviteToken();

    const { data, error } = await ctx.supabase
      .from("account_invitations")
      .update({ token_hash: hash, expires_at: freshExpiry.toISOString() })
      .eq("id", id)
      .is("accepted_at", null)
      .select("id, full_name, role, expires_at")
      .single();

    if (error || !data) {
      console.error(
        "[POST /api/account/invitations/[id]/link] update error:",
        error,
      );
      return NextResponse.json(
        { error: "Failed to generate link" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      invitation: data,
      // Plaintext link — the caller shares it; we never persist it.
      url: inviteUrl(token, resolveInviteBaseUrl(request)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
