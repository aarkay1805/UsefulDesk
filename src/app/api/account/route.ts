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

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
  ForbiddenError,
} from "@/lib/auth/account";
import { canDeleteAccount } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

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
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown }
      | null;
    const rawName = body?.name;

    if (typeof rawName !== "string") {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 },
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: "Account name cannot be empty" },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ name })
      .eq("id", ctx.accountId)
      .select("id, name")
      .single();

    if (error) {
      console.error("[PATCH /api/account] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Storage buckets that hold account-scoped media (Postgres FK cascades
// do NOT reach Supabase Storage, so we purge these explicitly). Objects
// are keyed under an `account-<uuid>/…` prefix by upload-media.ts.
const ACCOUNT_MEDIA_BUCKETS = ["chat-media", "flow-media", "profile-avatars"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purgeAccountStorage(admin: any, accountId: string) {
  const prefix = `account-${accountId}`;
  for (const bucket of ACCOUNT_MEDIA_BUCKETS) {
    try {
      const { data: files } = await admin.storage
        .from(bucket)
        .list(prefix, { limit: 1000 });
      if (files?.length) {
        await admin.storage
          .from(bucket)
          .remove(files.map((f: { name: string }) => `${prefix}/${f.name}`));
      }
    } catch (err) {
      // Best-effort: a missing bucket or nested folder shouldn't abort
      // the erasure. The DB rows (the actual Platform Data) are gone
      // regardless; orphaned blobs carry no queryable PII.
      console.warn(`[DELETE /api/account] storage purge (${bucket}) failed:`, err);
    }
  }
}

// ============================================================
// DELETE /api/account — permanently erase the caller's account and
// ALL of its Platform Data. Owner-only, irreversible.
//
// This is the account-level data-subject erasure path referenced by
// the public /data-deletion page. Deleting the `accounts` row cascades
// (ON DELETE CASCADE on every account_id FK) to contacts, conversations,
// messages, whatsapp_config (encrypted tokens), templates, deals,
// automations, flows, memberships, payments, attendance, and every
// other tenant table. Storage media and the members' auth.users login
// identities are not FK-reachable, so we remove those explicitly.
//
// Guardrails: owner role (canDeleteAccount) + the caller must echo the
// exact account name in `{ confirm }`, the same pattern GitHub/Stripe
// use to gate an unrecoverable delete.
// ============================================================
export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    // Owner-only. Uses the named predicate (mirrors the accounts RLS),
    // never an inline role compare.
    if (!canDeleteAccount(ctx.role)) {
      throw new ForbiddenError("Only the account owner can delete the account");
    }

    const limit = checkRateLimit(
      `admin:delete-account:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Require an exact-name confirmation to proceed.
    const body = (await request.json().catch(() => null)) as {
      confirm?: unknown;
    } | null;
    const confirm = typeof body?.confirm === "string" ? body.confirm : "";
    if (confirm !== ctx.account.name) {
      return NextResponse.json(
        {
          error:
            "Confirmation does not match. Type the account name exactly to delete it.",
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Snapshot member auth ids before the cascade removes their profiles.
    const { data: members } = await admin
      .from("profiles")
      .select("user_id")
      .eq("account_id", ctx.accountId);
    const memberIds: string[] = (members ?? [])
      .map((m: { user_id: string | null }) => m.user_id)
      .filter((id: string | null): id is string => Boolean(id));

    // Delete the account row — cascades every tenant table. Confirm a
    // row actually came back: an admin-client delete bypasses RLS, but
    // a bad id would still no-op silently (see CLAUDE.md gotcha).
    const { data: deleted, error: deleteError } = await admin
      .from("accounts")
      .delete()
      .eq("id", ctx.accountId)
      .select("id");
    if (deleteError || !deleted || deleted.length === 0) {
      console.error("[DELETE /api/account] account delete failed:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete the account." },
        { status: 500 },
      );
    }

    // Purge account-scoped storage (no FK cascade reaches it).
    await purgeAccountStorage(admin, ctx.accountId);

    // Remove each member's login identity. Delete the caller last so
    // the session stays valid through the loop. Best-effort — a failure
    // here leaves an orphaned auth user with no profile/account, no
    // Platform Data, and nothing to log into.
    const others = memberIds.filter((id) => id !== ctx.userId);
    for (const id of [...others, ctx.userId]) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        console.warn(`[DELETE /api/account] auth user ${id} delete failed:`, error);
      }
    }

    // Record the erasure for our own audit trail (no FK to accounts, so
    // this row survives the deletion).
    await admin.from("data_deletion_requests").insert({
      source: "account_erasure",
      account_id: ctx.accountId,
      confirmation_code: crypto.randomUUID(),
      status: "completed",
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
