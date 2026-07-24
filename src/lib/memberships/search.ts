import type { createClient } from '@/lib/supabase/client';

interface SearchableMembership {
  id?: string;
  member_number?: number | null;
  contact?: {
    name?: string | null;
    phone?: string | null;
  } | null;
}

export type MemberSearchResolution =
  | { kind: 'none' }
  | { kind: 'contact'; term: string }
  | { kind: 'membershipIds'; ids: string[] };

/** A UUID sentinel used to turn an empty resolved ID set into no rows. */
export const NO_MATCHING_MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Attendance's canonical member-search semantics: a locale-aware,
 * case-insensitive substring match across name, Member ID, and phone.
 */
export function memberMatchesSearch(
  membership: SearchableMembership,
  rawSearch: string,
  locale?: string
): boolean {
  const query = rawSearch.trim().toLocaleLowerCase(locale);
  if (!query) return true;

  const name = membership.contact?.name?.toLocaleLowerCase(locale) ?? '';
  const phone = membership.contact?.phone?.toLocaleLowerCase(locale) ?? '';
  const memberId = String(membership.member_number ?? '');

  return (
    name.includes(query) || memberId.includes(query) || phone.includes(query)
  );
}

/**
 * PostgREST cannot OR a related contact field with the memberships table's
 * integer member_number. Numeric searches are therefore resolved to the
 * matching membership IDs once, then applied to the caller's normal query.
 * Non-numeric searches keep using the existing server-side contact filter.
 */
export async function resolveMemberSearch(
  supabase: ReturnType<typeof createClient>,
  rawSearch: string
): Promise<MemberSearchResolution> {
  const term = rawSearch.trim();
  if (!term) return { kind: 'none' };
  if (!/^\d+$/.test(term)) return { kind: 'contact', term };

  const { data, error } = await supabase
    .from('memberships')
    .select('id, member_number, contact:contacts!inner(name, phone)');
  if (error) throw error;

  const ids = (
    (data as unknown as (SearchableMembership & { id: string })[]) ?? []
  )
    .filter((membership) => memberMatchesSearch(membership, term))
    .map((membership) => membership.id);

  return { kind: 'membershipIds', ids };
}

export function resolvedMembershipIds(
  resolution: Extract<MemberSearchResolution, { kind: 'membershipIds' }>
): string[] {
  return resolution.ids.length > 0
    ? resolution.ids
    : [NO_MATCHING_MEMBERSHIP_ID];
}
