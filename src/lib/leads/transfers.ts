// Lead ownership transfer — client wrappers over the migration 050 RPCs
// plus small pure helpers (unit-tested). All mutations go through the
// SECURITY DEFINER functions, which enforce the role rules + state
// machine; the client never writes lead_transfers directly.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadTransfer, LeadTransferKind } from '@/types';

/** Result of request_lead_transfer: instant reassign vs pending handshake. */
export type TransferOutcome = 'accepted' | 'pending';

/**
 * Ask to hand a lead to `toUser`. Admin/owner (or an agent self-claiming an
 * unassigned lead) resolves instantly → 'accepted'; an agent handing off a
 * lead they own → 'pending' (target must accept). Throws on error.
 */
export async function requestLeadTransfer(
  supabase: SupabaseClient,
  contactId: string,
  toUser: string,
  note?: string
): Promise<TransferOutcome> {
  const { data, error } = await supabase.rpc('request_lead_transfer', {
    p_contact_id: contactId,
    p_to_user: toUser,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as TransferOutcome;
}

/** Accept or decline a pending transfer (target, or an admin force-resolving). */
export async function respondLeadTransfer(
  supabase: SupabaseClient,
  transferId: string,
  accept: boolean
): Promise<'accepted' | 'declined'> {
  const { data, error } = await supabase.rpc('respond_lead_transfer', {
    p_transfer_id: transferId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
  return data as 'accepted' | 'declined';
}

/** Withdraw a pending transfer (requester, or an admin). */
export async function cancelLeadTransfer(
  supabase: SupabaseClient,
  transferId: string
): Promise<void> {
  const { error } = await supabase.rpc('cancel_lead_transfer', {
    p_transfer_id: transferId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Ask to change a lead's Assigned-to delegate (contacts.assigned_to,
 * migration 052). Owner (Received-by) or admin → 'approved' instantly; any
 * other agent → 'pending' (the OWNER must approve). `toAssignee` null =
 * unassign. Throws on error.
 */
export async function requestLeadAssignment(
  supabase: SupabaseClient,
  contactId: string,
  toAssignee: string | null,
  note?: string
): Promise<'approved' | 'pending'> {
  const { data, error } = await supabase.rpc('request_lead_assignment', {
    p_contact_id: contactId,
    p_to_assignee: toAssignee,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as 'approved' | 'pending';
}

/** Approve or reject a pending assignment request (lead owner or admin). */
export async function respondLeadAssignment(
  supabase: SupabaseClient,
  requestId: string,
  approve: boolean
): Promise<'approved' | 'rejected'> {
  const { data, error } = await supabase.rpc('respond_lead_assignment', {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
  return data as 'approved' | 'rejected';
}

/** Withdraw a pending assignment request (requester or admin). */
export async function cancelLeadAssignment(
  supabase: SupabaseClient,
  requestId: string
): Promise<void> {
  const { error } = await supabase.rpc('cancel_lead_assignment', {
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
}

/**
 * All in-flight (pending) transfers/requests in the account — the light
 * query the leads list runs to overlay pending badges, mirroring fetchTags
 * / fetchPendingAssignees. RLS scopes rows to the account. Both kinds
 * (ownership + assignment) come back; split with pendingTransferMap.
 */
export async function fetchPendingTransfers(
  supabase: SupabaseClient
): Promise<LeadTransfer[]> {
  const { data } = await supabase
    .from('lead_transfers')
    .select('*')
    .eq('status', 'pending');
  return (data ?? []) as LeadTransfer[];
}

/**
 * Index pending rows by contact_id, optionally filtered to one kind. One
 * pending per (contact, kind) is enforced by the DB's partial unique index,
 * so last-wins is just defensive.
 */
export function pendingTransferMap(
  transfers: LeadTransfer[],
  kind?: LeadTransferKind
): Record<string, LeadTransfer> {
  const map: Record<string, LeadTransfer> = {};
  for (const t of transfers) {
    if (t.status !== 'pending') continue;
    if (kind && t.kind !== kind) continue;
    map[t.contact_id] = t;
  }
  return map;
}

/** True iff `userId` is the teammate a pending transfer is waiting on. */
export function isIncomingTo(transfer: LeadTransfer, userId: string): boolean {
  return transfer.status === 'pending' && transfer.to_user_id === userId;
}
