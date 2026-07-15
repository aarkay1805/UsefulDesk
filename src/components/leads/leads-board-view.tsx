'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  LeadsBoard,
  type BoardDensity,
  type BoardLead,
  type BoardSortWithin,
} from '@/components/leads/leads-board';
import type { LeadColumn } from '@/lib/leads/status';
import type { Contact, LeadStatus, LeadTransfer } from '@/types';
import type { AccountRole } from '@/lib/auth/roles';
import type { createClient } from '@/lib/supabase/client';

interface LeadsBoardViewProps {
  /** Fetched leads from the page — the source of truth. The island mirrors
   *  this locally for optimistic drags and re-syncs whenever it changes
   *  (a refetch). */
  leads: BoardLead[];
  columns: LeadColumn[];
  canEdit: boolean;
  accountRole: AccountRole | null;
  nameById: ReadonlyMap<string, string>;
  avatarById: ReadonlyMap<string, string | null>;
  transfers: Record<string, LeadTransfer>;
  assignmentRequests: Record<string, LeadTransfer>;
  currentUserId?: string;
  sourceLabel: (key: string) => string;
  density: BoardDensity;
  sortWithin: BoardSortWithin;
  collapseEmpty: boolean;
  onOpenLead: (contactId: string) => void;
  onEditLead: (lead: Contact) => void;
  onDeleteLead: (lead: Contact) => void;
  supabase: ReturnType<typeof createClient>;
  /** Called AFTER the DB write commits so the page can sync its own copies
   *  (its board mirror + the table's Status column). The page defers this
   *  (startTransition) so it can't interrupt the in-flight drop settle. */
  onStatusPersisted: (contactId: string, status: LeadStatus | null) => void;
}

/**
 * Board island. Owns a LOCAL optimistic mirror of the fetched leads +
 * the drag-drop status write, so a drop re-renders ONLY this subtree —
 * NOT the ~4k-line LeadsPage (with its toolbar, filters, and ~10
 * always-mounted dialogs). That page re-render is a fixed, card-count-
 * INDEPENDENT cost that on the drop frame competes with the card's Motion
 * FLIP settle and hitches it (the stutter that persisted even at low card
 * counts). The page stays the fetch owner; `leads` (prop) drives the mirror
 * and re-syncs it on every refetch.
 */
export function LeadsBoardView({
  leads: leadsProp,
  columns,
  canEdit,
  accountRole,
  nameById,
  avatarById,
  transfers,
  assignmentRequests,
  currentUserId,
  sourceLabel,
  density,
  sortWithin,
  collapseEmpty,
  onOpenLead,
  onEditLead,
  onDeleteLead,
  supabase,
  onStatusPersisted,
}: LeadsBoardViewProps) {
  const [leads, setLeads] = useState(leadsProp);

  // Re-sync the mirror when the page hands down a freshly-fetched array
  // (new identity). Adjust-state-during-render — NOT a useEffect — so the
  // reset lands in the same commit; `syncedProp` (state, not a ref, per the
  // repo's react-hooks lint) holds the last prop we synced so the guard
  // fires once and doesn't loop. Same pattern the page uses for `bulkCount`.
  const [syncedProp, setSyncedProp] = useState(leadsProp);
  if (syncedProp !== leadsProp) {
    setSyncedProp(leadsProp);
    setLeads(leadsProp);
  }

  const handleStatusChange = useCallback(
    async (contactId: string, status: LeadStatus | null) => {
      // Optimistic — LOCAL only, so the drop frame re-renders just this
      // island + the board, never the page. Motion's FLIP then settles on a
      // clean frame. Bump updated_at too so the "Recently updated" sort
      // reflects the move immediately (the DB write sets the same).
      const now = new Date().toISOString();
      setLeads((prev) =>
        prev.map((l) =>
          l.id === contactId
            ? { ...l, lead_status: status, updated_at: now }
            : l,
        ),
      );
      // `.select('id')` turns an RLS-blocked write (silently zero rows) into
      // a visible failure, so the optimistic card can't stay in a column the
      // DB never agreed to.
      const { data, error } = await supabase
        .from('contacts')
        .update({ lead_status: status, updated_at: now })
        .eq('id', contactId)
        .select('id');
      if (error || !data || data.length === 0) {
        toast.error('Failed to update lead status');
        setLeads(leadsProp); // revert to the last fetched set
        return;
      }
      onStatusPersisted(contactId, status);
    },
    [supabase, onStatusPersisted, leadsProp],
  );

  return (
    <LeadsBoard
      leads={leads}
      columns={columns}
      onStatusChange={handleStatusChange}
      onOpenLead={onOpenLead}
      onEditLead={onEditLead}
      onDeleteLead={onDeleteLead}
      canEdit={canEdit}
      accountRole={accountRole}
      nameById={nameById}
      avatarById={avatarById}
      transfers={transfers}
      assignmentRequests={assignmentRequests}
      currentUserId={currentUserId}
      sourceLabel={sourceLabel}
      density={density}
      sortWithin={sortWithin}
      collapseEmpty={collapseEmpty}
    />
  );
}
