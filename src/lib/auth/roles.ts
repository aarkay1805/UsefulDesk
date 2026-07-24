// ============================================================
// Account role helpers — pure, unit-testable, no I/O.
//
// Mirrors the `account_role_enum` Postgres type from migration
// 017_account_sharing.sql. The hierarchy is intentionally a flat
// ordinal (owner=4 … viewer=1) — it matches the same CASE
// expression the `is_account_member(account_id, min_role)` SQL
// helper uses, so server-side TypeScript guards and database-side
// RLS speak the same language.
//
// Predicates (`canManageMembers`, `canEditSettings`, …) are the
// single source of truth for "what can this role do?" — both
// API route guards and UI gates should call them rather than
// open-coding their own role checks. That keeps role-policy
// changes a one-file diff.
// ============================================================

import type { ReceivedVia } from '@/types';
import { isHumanReceived } from '@/lib/leads/attributes';

export type AccountRole = 'owner' | 'admin' | 'agent' | 'viewer';

/** Ordered list of every valid role, lowest privilege first. */
export const ACCOUNT_ROLES: readonly AccountRole[] = [
  'viewer',
  'agent',
  'admin',
  'owner',
] as const;

/**
 * Numeric rank of a role. Higher = more privileged. Mirrors the
 * CASE expression in `is_account_member` so JS/SQL stay aligned.
 */
export function roleRank(role: AccountRole): number {
  switch (role) {
    case 'owner':
      return 4;
    case 'admin':
      return 3;
    case 'agent':
      return 2;
    case 'viewer':
      return 1;
  }
}

/**
 * True iff `role` is at least as privileged as `min`. Use this
 * for any "user has at least admin" / "at least agent" checks.
 */
export function hasMinRole(role: AccountRole, min: AccountRole): boolean {
  return roleRank(role) >= roleRank(min);
}

/** Type-narrow an unknown string into a valid `AccountRole`. */
export function isAccountRole(value: unknown): value is AccountRole {
  return (
    typeof value === 'string' &&
    (ACCOUNT_ROLES as readonly string[]).includes(value)
  );
}

// ============================================================
// Capability predicates
//
// Every UI gate and API route guard should call one of these
// instead of comparing role strings inline. Adding a capability
// = one new predicate here + one call site change per consumer.
// ============================================================

/** Owner / admin: invite, remove, change roles. */
export function canManageMembers(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/**
 * Owner / admin: edit account-wide settings (WhatsApp config,
 * message templates, pipelines, tags, custom fields, account
 * name). Excludes per-user settings like avatar or own password.
 */
export function canEditSettings(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/**
 * Owner / admin / agent: write operational data — send messages,
 * create contacts, move deals, run broadcasts, edit automations.
 * Viewers are read-only.
 */
export function canSendMessages(role: AccountRole): boolean {
  return hasMinRole(role, 'agent');
}

/**
 * Viewer: read-only across everything. Provided as a positive
 * predicate so UI gates read naturally (`if (canViewOnly(role))`
 * shows the "Read-only" tooltip without inverting `canSendMessages`).
 */
export function canViewOnly(role: AccountRole): boolean {
  return role === 'viewer';
}

/**
 * Owner / admin: delete notes authored by other members (moderation).
 * Agents may only delete their own notes — mirrored by the
 * contact_notes_delete RLS policy in migration 046.
 */
export function canDeleteAnyNote(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/**
 * Owner / admin: reassign any lead instantly (managerial) and use the
 * bulk "Assigned to" action. Agents can't reassign directly — they open
 * a transfer request the target must accept (see canRequestLeadTransfer).
 * Mirrored by request_lead_transfer's instant path (migration 050).
 */
export function canReassignLeadsDirectly(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/**
 * Owner / admin / agent: initiate a lead transfer. Admins land instantly;
 * an agent's request stays pending until the target accepts. Viewers can't.
 */
export function canRequestLeadTransfer(role: AccountRole): boolean {
  return hasMinRole(role, 'agent');
}

/**
 * Owner / admin: force-accept, decline, or cancel ANY pending transfer.
 * (Accepting a request targeted at you is identity-based, not a role — the
 * respond_lead_transfer RPC gates that by to_user_id.)
 */
export function canResolveAnyLeadTransfer(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/**
 * Owner / admin: hard-delete a MEMBER record and all its data
 * (membership, payments, attendance, notes). Mirrored by the delete_member
 * RPC's is_account_member(…, 'admin') guard (migration 056), via a SECURITY
 * DEFINER RPC that also anonymizes the payment ledger. (Distinct from
 * canDeleteLead, which lets an agent delete a lead they created — a member
 * is never deleted through that path.)
 */
export function canDeleteMember(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/** The lead facts a per-lead delete decision needs (all nullable). */
export interface LeadDeleteContext {
  /** contacts.created_by — the immutable original creator (migration 051). */
  createdBy: string | null;
  /** The acting user's auth id, to compare against createdBy. */
  userId: string | null;
  /** contacts.received_via — origin channel; auto origins are agent-locked. */
  receivedVia?: ReceivedVia | null;
}

/**
 * Owner / admin: hard-delete ANY lead, including auto-captured ones and
 * leads created by other teammates. The managerial, unconditional tier —
 * mirrored by the admin arm of the contacts_delete RLS (migration 066).
 */
export function canDeleteAnyLead(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/**
 * Can this role delete THIS specific lead? Destructive + unrecoverable, so:
 *   · owner / admin → any lead (canDeleteAnyLead).
 *   · agent → only a lead they personally created via a human action
 *     (a manual/import origin whose created_by is them). Auto-captured leads
 *     (WhatsApp/Meta/API/automation) and leads created by others are off-limits.
 *   · viewer → never.
 * The authored-content ownership rule (author-or-admin may delete), applied to
 * leads. Mirrored exactly by the agent arm of the contacts_delete RLS (066).
 */
export function canDeleteLead(
  role: AccountRole,
  lead: LeadDeleteContext
): boolean {
  if (canDeleteAnyLead(role)) return true;
  if (!hasMinRole(role, 'agent')) return false;
  return (
    isHumanReceived(lead.receivedVia) &&
    lead.createdBy != null &&
    lead.createdBy === lead.userId
  );
}

/** Owner / admin: reverse an incorrect financial ledger entry. */
export function canCorrectPayments(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/**
 * Owner / admin / agent: record a payment against an open membership
 * period. Mirrors the agent-level payments INSERT policy and the
 * `record_membership_payment` RPC guard.
 */
export function canRecordPayments(role: AccountRole): boolean {
  return hasMinRole(role, 'agent');
}

/** Owner / admin: download account-wide financial data. */
export function canExportFinance(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/** Owner / admin: add append-preserving cash-out ledger entries. */
export function canRecordExpenses(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/** Owner / admin: add, rename, archive, and restore expense categories. */
export function canManageExpenseCategories(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/** Owner / admin: reasoned correction of a posted expense. */
export function canVoidExpenses(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/**
 * Owner / admin / agent: set up or pause a member's UPI/card auto-debit
 * mandate (migration 059). Mirrors the payment_mandates agent write RLS.
 * Cancelling a live mandate is admin-only — see canCancelMandate.
 */
export function canManageMandates(role: AccountRole): boolean {
  return hasMinRole(role, 'agent');
}

/**
 * Owner / admin: cancel a live auto-debit mandate (destructive — stops
 * the recurring collection) and edit the account's payment-gateway
 * credentials. Mirrors the account_payment_credentials admin-only RLS
 * and payment_mandates delete policy (migration 059).
 */
export function canConfigurePaymentGateway(role: AccountRole): boolean {
  return hasMinRole(role, 'admin');
}

/** Owner only: irreversible destructive operations. */
export function canDeleteAccount(role: AccountRole): boolean {
  return role === 'owner';
}

/** Owner only: hand the account to another member. */
export function canTransferOwnership(role: AccountRole): boolean {
  return role === 'owner';
}
