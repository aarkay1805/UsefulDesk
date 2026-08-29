import type { MemberCustomerDirectoryRow } from './customer-directory';

export type MemberSelection = Map<string, string | null>;

export type MemberSelectionRow = Pick<
  MemberCustomerDirectoryRow,
  'contact_id' | 'membership_id'
>;

export type MembershipBulkActionState = 'available' | 'blocked' | 'hidden';

export interface MemberSelectionSummary {
  totalCount: number;
  membershipCount: number;
  serviceOnlyCount: number;
  contactIds: string[];
  membershipIds: string[];
  membershipActionState: MembershipBulkActionState;
}

/**
 * All Members is a contact-backed directory, so selection identity must be a
 * contact first. A real membership id remains attached when one exists so a
 * membership-only action can prove the entire selection is compatible.
 */
export function memberSelectionFromRows(
  rows: readonly MemberSelectionRow[]
): MemberSelection {
  return new Map(rows.map((row) => [row.contact_id, row.membership_id]));
}

export function summarizeMemberSelection(
  selection: ReadonlyMap<string, string | null>
): MemberSelectionSummary {
  const contactIds = [...selection.keys()];
  const membershipIds = [...selection.values()].filter(
    (id): id is string => id !== null
  );
  const serviceOnlyCount = selection.size - membershipIds.length;

  return {
    totalCount: selection.size,
    membershipCount: membershipIds.length,
    serviceOnlyCount,
    contactIds,
    membershipIds,
    membershipActionState:
      membershipIds.length === 0
        ? 'hidden'
        : serviceOnlyCount > 0
          ? 'blocked'
          : 'available',
  };
}

export function toggleMemberSelection(
  selection: ReadonlyMap<string, string | null>,
  row: MemberSelectionRow
): MemberSelection {
  const next = new Map(selection);
  if (next.has(row.contact_id)) next.delete(row.contact_id);
  else next.set(row.contact_id, row.membership_id);
  return next;
}

/** Select or clear every contact on the current page without touching other pages. */
export function toggleMemberPageSelection(
  selection: ReadonlyMap<string, string | null>,
  rows: readonly MemberSelectionRow[]
): MemberSelection {
  const next = new Map(selection);
  const allOnPageSelected =
    rows.length > 0 && rows.every((row) => next.has(row.contact_id));

  for (const row of rows) {
    if (allOnPageSelected) next.delete(row.contact_id);
    else next.set(row.contact_id, row.membership_id);
  }
  return next;
}

/** Explicit resolution for a mixed selection's membership-only blocker. */
export function membershipOnlyMemberSelection(
  selection: ReadonlyMap<string, string | null>
): MemberSelection {
  return new Map([...selection].filter(([, membershipId]) => membershipId));
}

/** Keep only contact-backed rows that still need attention after a bulk write. */
export function retainFailedMemberSelection(
  selection: ReadonlyMap<string, string | null>,
  failedContactIds: ReadonlySet<string>
): MemberSelection {
  return new Map(
    [...selection].filter(([contactId]) => failedContactIds.has(contactId))
  );
}
