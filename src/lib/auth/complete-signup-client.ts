import type { SupabaseClient } from '@supabase/supabase-js';

export const GYM_NAME_DRAFT_KEY = 'usefuldesk.signup.gym-name';

export type CompleteSignupStatus = 'completed' | 'already_complete';

export function readGymNameDraft(storage?: Pick<Storage, 'getItem'>): string {
  try {
    const target =
      storage ??
      (typeof window === 'undefined' ? undefined : window.sessionStorage);
    return target?.getItem(GYM_NAME_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveGymNameDraft(
  gymName: string,
  storage?: Pick<Storage, 'setItem'>
): void {
  try {
    const target =
      storage ??
      (typeof window === 'undefined' ? undefined : window.sessionStorage);
    target?.setItem(GYM_NAME_DRAFT_KEY, gymName);
  } catch {
    // Auth must remain usable when storage is blocked or unavailable.
  }
}

export function clearGymNameDraft(storage?: Pick<Storage, 'removeItem'>): void {
  try {
    const target =
      storage ??
      (typeof window === 'undefined' ? undefined : window.sessionStorage);
    target?.removeItem(GYM_NAME_DRAFT_KEY);
  } catch {
    // Completion succeeded; a stale draft is harmless if storage is blocked.
  }
}

export async function resolveAuthenticatedDefaultBranch(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError || typeof profile?.account_id !== 'string') {
    throw new Error('Could not resolve your default branch.');
  }

  const { data: membership, error: membershipError } = await supabase
    .from('account_memberships')
    .select('account_id')
    .eq('account_id', profile.account_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (
    membershipError ||
    typeof membership?.account_id !== 'string' ||
    membership.account_id !== profile.account_id
  ) {
    throw new Error('Could not verify access to your default branch.');
  }

  return membership.account_id;
}

export async function completeSignup(
  accountId: string,
  gymName: string,
  request: typeof fetch = fetch
): Promise<CompleteSignupStatus> {
  const response = await request(
    `/api/auth/complete-signup?branch=${encodeURIComponent(accountId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gymName }),
    }
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Could not finish setting up your gym. Try again.';
    throw new Error(message);
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'status' in payload &&
    (payload.status === 'completed' || payload.status === 'already_complete')
  ) {
    return payload.status;
  }

  throw new Error('Could not confirm that gym setup finished. Try again.');
}

export function completionPath(accountId?: string): string {
  return accountId
    ? `/complete-signup?branch=${encodeURIComponent(accountId)}`
    : '/complete-signup';
}

export function dashboardBranchPath(accountId: string): string {
  return `/dashboard?branch=${encodeURIComponent(accountId)}`;
}

export function navigateToCompletion(
  accountId?: string,
  location: Pick<Location, 'href'> = window.location
): void {
  location.href = completionPath(accountId);
}

export function navigateToCompletedBranch(
  accountId: string,
  location: Pick<Location, 'href'> = window.location
): void {
  location.href = dashboardBranchPath(accountId);
}
