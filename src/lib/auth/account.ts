// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import {
  BRANCH_HEADER,
  BRANCH_QUERY_PARAM,
  isBranchAccountId,
} from './branch-context';
import {
  canEditSettings,
  canSendMessages,
  hasMinRole,
  isAccountRole,
  type AccountRole,
} from './roles';

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[toErrorResponse] uncategorized error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Explicitly selected branch account. */
  accountId: string;
  /** Caller's role within the selected branch. */
  role: AccountRole;
  /** Lightweight selected-branch metadata. */
  account: {
    id: string;
    name: string;
    organizationId: string;
    legalEntityId: string;
    branchStatus: 'active' | 'read_only' | 'archived';
    readinessState: 'setup' | 'ready' | 'attention';
  };
}

interface RequestedBranch {
  accountId: string | null;
  explicit: boolean;
  invalid: boolean;
}

async function requestedBranchFromRequest(): Promise<RequestedBranch> {
  try {
    const requestHeaders = await headers();
    const direct = requestHeaders.get(BRANCH_HEADER);
    if (direct !== null) {
      return {
        accountId: isBranchAccountId(direct) ? direct : null,
        explicit: true,
        invalid: !isBranchAccountId(direct),
      };
    }

    const referer = requestHeaders.get('referer');
    if (!referer) return { accountId: null, explicit: false, invalid: false };
    const url = new URL(referer);
    if (!url.searchParams.has(BRANCH_QUERY_PARAM)) {
      return { accountId: null, explicit: false, invalid: false };
    }
    const branch = url.searchParams.get(BRANCH_QUERY_PARAM);
    return {
      accountId: isBranchAccountId(branch) ? branch : null,
      explicit: true,
      invalid: !isBranchAccountId(branch),
    };
  } catch {
    // Unit tests and non-request execution have no Next request store.
    return { accountId: null, explicit: false, invalid: false };
  }
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const sessionClient = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await sessionClient.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data: profile, error } = await sessionClient
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[getCurrentAccount] profile fetch error:', error);
    throw new ForbiddenError('Could not load account context');
  }
  if (!profile || !profile.account_id) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError('Profile is not linked to an account');
  }
  const requested = await requestedBranchFromRequest();
  if (requested.invalid) {
    throw new ForbiddenError('Invalid branch context');
  }
  const accountId = requested.accountId ?? profile.account_id;
  const supabase = await createClient(accountId);

  const { data: membership, error: membershipErr } = await supabase
    .from('account_memberships')
    .select('role')
    .eq('account_id', accountId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipErr) {
    console.error('[getCurrentAccount] membership fetch error:', membershipErr);
    throw new ForbiddenError('Could not load branch context');
  }
  if (!membership || !isAccountRole(membership.role)) {
    throw new ForbiddenError(
      requested.explicit
        ? 'You do not have access to this branch'
        : 'Profile is not linked to an account'
    );
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the profiles.account_id → accounts.id
  // relationship from its schema cache; when that cache is stale — a
  // common Supabase state right after a migration adds the FK, or when
  // migrations are applied out of band — the embed fails hard with
  // PGRST200 ("could not find a relationship … in the schema cache")
  // and takes down the entire account context (issue #294). A lookup by
  // id needs no relationship inference and is gated by the same accounts
  // RLS, so it stays robust against cache staleness and older schemas.
  const { data: account, error: accountErr } = await supabase
    .from('accounts')
    .select(
      'id, name, organization_id, legal_entity_id, branch_status, readiness_state'
    )
    .eq('id', accountId)
    .maybeSingle();

  if (accountErr) {
    console.error('[getCurrentAccount] account fetch error:', accountErr);
    throw new ForbiddenError('Could not load account context');
  }
  if (!account) {
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError('Profile is not linked to an account');
  }
  if (account.branch_status === 'archived') {
    throw new ForbiddenError('This branch is archived');
  }

  return {
    supabase,
    userId: user.id,
    accountId,
    role: membership.role,
    account: {
      id: account.id,
      name: account.name,
      organizationId: account.organization_id,
      legalEntityId: account.legal_entity_id,
      branchStatus: account.branch_status,
      readinessState: account.readiness_state,
    },
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`
    );
  }
  return ctx;
}

/**
 * Require permission to mutate operational data or trigger outbound work.
 *
 * Keep this separate from `requireRole("agent")`: route handlers should name
 * the product capability they protect, while the role hierarchy remains an
 * implementation detail of `canSendMessages`.
 */
export async function requireOperationalAccess(): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!canSendMessages(ctx.role)) {
    throw new ForbiddenError('This action requires operational access');
  }
  return ctx;
}

/**
 * Require permission to change account-wide integrations and settings.
 */
export async function requireSettingsAccess(): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!canEditSettings(ctx.role)) {
    throw new ForbiddenError('This action requires settings access');
  }
  return ctx;
}
