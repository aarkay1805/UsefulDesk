import { normalizeKey } from '@/lib/contacts/dedupe';

import {
  revalidateMemberImportCandidates,
  type MemberImportCandidate,
  type MemberImportCandidateContext,
} from './member-import-candidates';

export interface MemberImportMatchContact {
  id: string;
  phone_normalized: string | null;
  received_via: string | null;
  [key: string]: unknown;
}

export interface MemberImportMatchPage<T> {
  data: T[] | null;
  error: unknown;
}

export interface MemberImportMatchLoader {
  contactsPage: (
    from: number,
    to: number
  ) => PromiseLike<MemberImportMatchPage<MemberImportMatchContact>>;
  membershipsPage: (
    from: number,
    to: number
  ) => PromiseLike<MemberImportMatchPage<{ contact_id: string }>>;
}

export interface MemberImportMatchIndex {
  contactsByPhone: Map<string, MemberImportMatchContact>;
  memberContactIds: Set<string>;
}

const PAGE_SIZE = 1_000;

function reviewedProfileFingerprint(
  imported: Record<string, unknown>,
  contact: MemberImportMatchContact
) {
  return JSON.stringify(
    Object.keys(imported)
      .sort()
      .map((key) => [key, imported[key] ?? null, contact[key] ?? null])
  );
}

async function loadAll<T>(
  page: (from: number, to: number) => PromiseLike<MemberImportMatchPage<T>>
): Promise<T[]> {
  const values: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    values.push(...rows);
    if (rows.length < PAGE_SIZE) return values;
  }
}

/** Loads every tenant contact and membership through stable bounded pages. */
export async function loadMemberImportMatchIndex(
  loader: MemberImportMatchLoader
): Promise<MemberImportMatchIndex> {
  const [contacts, memberships] = await Promise.all([
    loadAll(loader.contactsPage),
    loadAll(loader.membershipsPage),
  ]);
  const contactsByPhone = new Map<string, MemberImportMatchContact>();
  for (const contact of contacts) {
    if (contact.phone_normalized) {
      contactsByPhone.set(normalizeKey(contact.phone_normalized), contact);
    }
  }
  return {
    contactsByPhone,
    memberContactIds: new Set(
      memberships.map((membership) => membership.contact_id)
    ),
  };
}

/**
 * Refreshes stale identity facts after a reviewer changes a phone or profile.
 * An old keep/use-contact choice cannot apply to newly matched contact data.
 */
export function rematchMemberImportCandidates(
  candidates: MemberImportCandidate[],
  index: MemberImportMatchIndex,
  context: MemberImportCandidateContext,
  clearContactResolution = false
): MemberImportCandidate[] {
  const matched = candidates.map((candidate) => {
    const contact = index.contactsByPhone.get(
      normalizeKey(candidate.draftValues.phone)
    );
    if (!contact) {
      return {
        ...candidate,
        existingMatch: null,
        resolutions: clearContactResolution
          ? { ...candidate.resolutions, existingContact: null }
          : candidate.resolutions,
      };
    }
    const profileConflict = Object.entries(candidate.built.contact).some(
      ([key, value]) =>
        value !== null && String(contact[key] ?? '') !== String(value)
    );
    const profileFingerprint = reviewedProfileFingerprint(
      candidate.built.contact,
      contact
    );
    const mayKeepResolution =
      !clearContactResolution ||
      (candidate.existingMatch?.contactId === contact.id &&
        candidate.existingMatch.profileFingerprint === profileFingerprint);
    return {
      ...candidate,
      existingMatch: {
        contactId: contact.id,
        isMember: index.memberContactIds.has(contact.id),
        receivedVia: contact.received_via,
        profileConflict,
        profileFingerprint,
      },
      resolutions: !mayKeepResolution
        ? { ...candidate.resolutions, existingContact: null }
        : candidate.resolutions,
    };
  });
  return revalidateMemberImportCandidates(matched, context);
}

/**
 * A durable execution journal owns attempted rows. Keep their complete
 * candidate snapshot when another row is re-matched, rather than letting a
 * live lookup alter a saved retry payload or confirmed receipt facts.
 */
export function preserveMemberImportCandidateSnapshots(
  current: MemberImportCandidate[],
  rematched: MemberImportCandidate[],
  sourceKeys: ReadonlySet<string>
): MemberImportCandidate[] {
  const currentBySourceKey = new Map(
    current.map((candidate) => [candidate.sourceKey, candidate])
  );
  return rematched.map((candidate) =>
    sourceKeys.has(candidate.sourceKey)
      ? (currentBySourceKey.get(candidate.sourceKey) ?? candidate)
      : candidate
  );
}
