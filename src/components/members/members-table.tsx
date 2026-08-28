'use client';

// The "All members" table — server-paginated, sortable, filterable, with
// multi-select bulk actions (remind / add note / record payment / delete). Borrows
// the leads table's data-layer idioms: fetch-sequence guard, shared
// filter definition (serialized through the same directory RPC for the page,
// select-all-matching, and CSV export), and the Collapse bulk toolbar.
// Deliberately NOT the leads grid — member columns stay intentionally
// lightweight.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import {
  Check,
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Eye,
  ListChecks,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Settings,
  StickyNote,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/hooks/use-auth';
import { toCsv, downloadCsv } from '@/lib/csv/export';
import { effectiveStatus, daysUntil } from '@/lib/memberships/expiry';
import {
  CHURN_RISK_OPTIONS,
  EMPTY_MEMBER_FILTERS,
  MEMBER_STATUS_OPTIONS,
  type MemberFilters,
} from '@/lib/memberships/filters';
import {
  asMembership,
  type NormalizedMemberCustomerDirectoryRow,
} from '@/lib/memberships/customer-directory';
import {
  EMPTY_MEMBER_DIRECTORY_QUICK_FILTER_COUNTS,
  loadMemberDirectory,
  type MemberDirectoryQuickFilterCounts,
} from '@/lib/memberships/member-directory';
import {
  MEMBER_COLUMN_BY_KEY,
  MEMBER_TABLE_COLUMNS as MEMBER_COLUMNS,
  type MemberColumn,
  type MemberColumnKey,
  type MemberFilterDim,
} from '@/lib/memberships/member-field-registry';
import type { LeadTransfer, Membership } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapse } from '@/components/ui/collapse';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GatedButton } from '@/components/ui/gated-button';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import {
  TableSkeleton,
  type TableSkeletonCellVariant,
} from '@/components/table/table-skeleton';
import { EditableCell } from '@/components/leads/editable-cell';
import {
  AssigneeDisplay,
  PendingAssigneeDisplay,
  TransferPendingDisplay,
  assigneeCellOptions,
} from '@/components/leads/lead-cell-renderers';
import {
  cancelLeadAssignment,
  fetchPendingTransfers,
  pendingTransferMap,
  requestLeadAssignment,
  respondLeadAssignment,
} from '@/lib/leads/transfers';
import { canDeleteMember, canResolveAnyLeadTransfer } from '@/lib/auth/roles';
import {
  ColumnHeader,
  type ColumnFilterProp,
  type SortDir,
} from '@/components/table/column-header';
import { BulkAddNoteDialog } from '@/components/leads/bulk-add-note-dialog';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import {
  MembershipStatusBadge,
  FeeStatusBadge,
  ServiceCustomerStatusBadge,
} from './membership-status-badge';
import { MembersFilters } from './members-filters';
import { MemberIdentity } from './member-identity';
import { buildMemberAvatarPreview } from './member-avatar-quick-view';
import { BulkRecordPaymentDialog } from './bulk-record-payment-dialog';
import { FollowUpDialog } from '@/components/follow-ups/follow-up-dialog';
import { FollowUpButton } from '@/components/follow-ups/follow-up-button';
import { RecordPaymentDialog } from './record-payment-dialog';
import { RenewMembershipDialog } from './renew-membership-dialog';
import { useMembershipPlans } from './use-membership-plans';
import { useAccountStaff } from './use-account-staff';
import {
  SendReminderButton,
  sendRenewalReminder,
  type ReminderReadiness,
} from './send-reminder-button';

const PAGE_SIZE = 25;

type QuickMemberFilter = keyof MemberDirectoryQuickFilterCounts;

const QUICK_MEMBER_FILTERS: { key: QuickMemberFilter; label: string }[] = [
  { key: 'churnRisk', label: 'Churn risk' },
  { key: 'feesDue', label: 'Fees due' },
  { key: 'followUps', label: 'Follow-ups' },
];

// Sortable columns for the toolbar Sort menu. The directory RPC maps these
// flat contract keys to its validated sort allowlist. (Per-header sort covers
// name/expiry/fee; the menu keeps start_date + fee_status which have no
// dedicated column.)
const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'contact_name', label: 'Name' },
  { key: 'member_number', label: 'Member ID' },
  { key: 'display_expiry', label: 'Expiry' },
  { key: 'membership_fee_amount', label: 'Fee' },
  { key: 'membership_fee_status', label: 'Fee status' },
  { key: 'membership_start_date', label: 'Start date' },
];

const CHECKBOX_COL_WIDTH = 40;

// Fee status options for the fee column's header Filter submenu.
const FEE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'due', label: 'Due' },
];

const CHURN_RISK_CELL_OPTIONS = CHURN_RISK_OPTIONS.map((option) => ({
  ...option,
  color:
    option.value === 'yes' ? 'var(--destructive)' : 'var(--muted-foreground)',
}));

/**
 * Bumped whenever a column's DEFAULT visibility changes. Stored prefs always
 * carry an explicit `hidden` array, so "never customised" is otherwise
 * indistinguishable from "deliberately shown"; the version lets a new
 * `defaultHidden` seed apply exactly once and then defer to the user.
 */
const LAYOUT_VERSION = 2;

const DEFAULT_HIDDEN_COLUMNS = MEMBER_COLUMNS.filter(
  (column) => column.defaultHidden
).map((column) => column.key);

interface MembersTablePrefs {
  pageSize: number;
  sort: SortState | null;
  // Persisted column layout (per-user, per-account via useTablePrefs).
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
  /** The required Name column is the table's only freezable column. */
  nameFrozen: boolean;
  /** Absent on layouts saved before default visibility was versioned. */
  layoutVersion?: number;
}

const DEFAULT_PREFS: MembersTablePrefs = {
  pageSize: PAGE_SIZE,
  sort: null,
  order: [],
  hidden: DEFAULT_HIDDEN_COLUMNS,
  widths: {},
  nameFrozen: false,
  layoutVersion: LAYOUT_VERSION,
};

// Debounce a rapidly-changing value (e.g. the search input) so the fetch
// fires on a pause, not every keystroke. (Same local helper as leads.)
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

interface MembersTableProps {
  readiness: ReminderReadiness;
  onSelect: (customer: {
    contactId: string;
    membershipId: string | null;
  }) => void;
  onEdit: (membership: Membership) => void;
  /** Bump to force a refetch after a mutation elsewhere. */
  reloadKey: number;
  /** Refresh the rest of the Members page after a bulk write here. */
  onChanged: () => void;
  /** Gate on row and bulk actions (canSendMessages — agent+). */
  canEdit: boolean;
  /** Lets the page surface this table's filter-aware CSV export in the
   *  app-bar header. The table hands up a caller (or null on unmount);
   *  the page's Export button invokes it. */
  onRegisterExport?: (fn: (() => void) | null) => void;
}

export function MembersTable({
  readiness,
  onSelect,
  onEdit,
  reloadKey,
  onChanged,
  canEdit,
  onRegisterExport,
}: MembersTableProps) {
  const supabase = useMemo(() => createClient(), []);
  const { fmt } = useLocale();
  const reduceMotion = useReducedMotion();
  const { user, profile, accountId } = useAuth();
  const { staff, nameById, avatarById } = useAccountStaff();
  const canResolveAnyAssignment = profile?.account_role
    ? canResolveAnyLeadTransfer(profile.account_role)
    : false;
  const canDeleteSelected = profile?.account_role
    ? canDeleteMember(profile.account_role)
    : false;
  // Include archived plans so members on a retired plan still filter.
  const { plans } = useMembershipPlans(false);

  const [rows, setRows] = useState<NormalizedMemberCustomerDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);
  const [filters, setFilters] = useState<MemberFilters>(EMPTY_MEMBER_FILTERS);
  const [quickFilterCounts, setQuickFilterCounts] = useState<
    Record<QuickMemberFilter, number>
  >(EMPTY_MEMBER_DIRECTORY_QUICK_FILTER_COUNTS);
  const [prefs, setPrefs] = useTablePrefs<MembersTablePrefs>(
    'members-all',
    DEFAULT_PREFS
  );
  // Drops out-of-order responses: only the latest fetch may set state.
  const fetchSeq = useRef(0);

  // Selection — membership id → contact id (bulk note needs contact ids,
  // and select-all-matching spans rows never loaded onto a page).
  const [selected, setSelected] = useState<Map<string, string>>(new Map());

  // Bulk dialogs.
  const [noteOpen, setNoteOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Contextual row-action dialogs opened from the Actions column.
  const [followUpFor, setFollowUpFor] =
    useState<NormalizedMemberCustomerDirectoryRow | null>(null);
  const [renewFor, setRenewFor] = useState<Membership | null>(null);
  const [paymentFor, setPaymentFor] = useState<Membership | null>(null);

  // Inline editing mirrors the leads table: one active cell, an explicit
  // dropdown choice, and a visible save state.
  const [editingCell, setEditingCell] = useState<{
    id: string;
    key: 'assignee' | 'trainer' | 'churnRisk';
  } | null>(null);
  const [savingCell, setSavingCell] = useState(false);
  // Active trainer roster for the Trainer cell. Unlike the staff roster this
  // needs no login seat, so it lists gym identities rather than teammates.
  const [trainers, setTrainers] = useState<
    { id: string; display_name: string }[]
  >([]);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('trainers')
        .select('id, display_name')
        .eq('is_active', true)
        .order('display_name');
      if (cancelled) return;
      setTrainers((data as { id: string; display_name: string }[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);
  const trainerNameById = useMemo(
    () =>
      new Map(trainers.map((trainer) => [trainer.id, trainer.display_name])),
    [trainers]
  );

  // Pending assignment approvals use the same contacts-level workflow as
  // Leads. A member is backed by a contact, so requests are keyed by the
  // embedded contact id and can be rendered with the identical overlay.
  const [assignmentRequests, setAssignmentRequests] = useState<
    Record<string, LeadTransfer>
  >({});
  const [assignmentNonce, setAssignmentNonce] = useState(0);
  const fetchAssignmentRequests = useCallback(async () => {
    const transfers = await fetchPendingTransfers(supabase);
    setAssignmentRequests(pendingTransferMap(transfers, 'assignment'));
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await fetchAssignmentRequests();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAssignmentRequests]);

  useEffect(() => {
    const channel = supabase
      .channel('member-assignment-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_transfers' },
        () => {
          void fetchAssignmentRequests();
          setAssignmentNonce((nonce) => nonce + 1);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchAssignmentRequests]);

  // Freeze the last non-zero count so the collapsing toolbar never
  // flashes "0 selected" mid-exit (leads pattern, render-time adjust).
  const [bulkCount, setBulkCount] = useState(0);
  if (selected.size > 0 && selected.size !== bulkCount) {
    setBulkCount(selected.size);
  }

  // A new search term / filter set shrinks the result set — snap back to
  // page 0 and drop the selection (it may reference now-hidden rows).
  // Render-time adjust (state guard), not an effect.
  const querySig = JSON.stringify({ search, filters });
  const [prevQuerySig, setPrevQuerySig] = useState(querySig);
  if (querySig !== prevQuerySig) {
    setPrevQuerySig(querySig);
    setPage(0);
    setSelected(new Map());
  }

  const pageSize = prefs.pageSize || PAGE_SIZE;
  const sort = prefs.sort;
  // Account-zone today for the render-time status/day derivations.
  const todayDisplay = fmt.today();

  // ── Column layout (persisted order / hidden / widths) ──────────────
  // Saved order plus any columns added since. A new key is inserted before
  // its next canonical neighbour, so Member ID lands beside Name for existing
  // users instead of after Actions; unknown saved keys are dropped.
  const orderedKeys = useMemo(() => {
    const known = MEMBER_COLUMNS.map((c) => c.key);
    const saved = prefs.order.filter(
      (key): key is MemberColumnKey => key in MEMBER_COLUMN_BY_KEY
    );
    const merged = [...saved];
    known.forEach((key, index) => {
      if (merged.includes(key)) return;
      const nextKnown = known
        .slice(index + 1)
        .find((next) => merged.includes(next));
      if (nextKnown) merged.splice(merged.indexOf(nextKnown), 0, key);
      else merged.push(key);
    });
    return merged;
  }, [prefs.order]);

  // Seed applied in render rather than an effect: `set-state-in-effect` is
  // enforced, and any column-visibility edit stamps the current version, so
  // the seed stops the moment the user expresses a preference.
  const hiddenKeys = useMemo(() => {
    const keys = new Set(prefs.hidden);
    if ((prefs.layoutVersion ?? 1) < LAYOUT_VERSION) {
      for (const key of DEFAULT_HIDDEN_COLUMNS) keys.add(key);
    }
    return keys;
  }, [prefs.hidden, prefs.layoutVersion]);

  const visibleColumns = useMemo(
    () =>
      orderedKeys
        .map((k) => MEMBER_COLUMN_BY_KEY[k])
        .filter((c): c is MemberColumn => Boolean(c) && !hiddenKeys.has(c.key)),
    [orderedKeys, hiddenKeys]
  );

  // Live width while dragging a resize grip (transient — commits on release).
  const [resizing, setResizing] = useState<{
    key: string;
    width: number;
  } | null>(null);
  function widthOf(col: MemberColumn) {
    if (resizing?.key === col.key) return resizing.width;
    return prefs.widths[col.key] ?? col.defaultWidth;
  }
  const totalWidth =
    CHECKBOX_COL_WIDTH + visibleColumns.reduce((sum, c) => sum + widthOf(c), 0);

  // Column resize — drag the header's right edge (leads pattern). Width
  // tracks the pointer live and commits to prefs on release.
  function startResize(e: React.MouseEvent, col: MemberColumn) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthOf(col);
    function onMove(ev: MouseEvent) {
      const w = Math.max(col.minWidth, startWidth + (ev.clientX - startX));
      setResizing({ key: col.key, width: w });
    }
    function onUp(ev: MouseEvent) {
      const w = Math.max(col.minWidth, startWidth + (ev.clientX - startX));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setResizing(null);
      setPrefs((p) => ({ ...p, widths: { ...p.widths, [col.key]: w } }));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function hideColumn(key: string) {
    setPrefs((p) => ({
      ...p,
      layoutVersion: LAYOUT_VERSION,
      hidden: [...hiddenKeys].includes(key)
        ? [...hiddenKeys]
        : [...hiddenKeys, key],
    }));
  }
  function toggleColumnVisible(key: string) {
    setPrefs((p) => ({
      ...p,
      layoutVersion: LAYOUT_VERSION,
      hidden: hiddenKeys.has(key)
        ? [...hiddenKeys].filter((k) => k !== key)
        : [...hiddenKeys, key],
    }));
  }

  function toggleNameFrozen() {
    setPrefs((p) => ({ ...p, nameFrozen: !p.nameFrozen }));
  }

  function sortByColumn(key: string, dir: SortDir) {
    setPrefs((p) => ({ ...p, sort: { key, dir } }));
  }

  // Toggle a value in one of the shared MemberFilters facets — used by
  // each column's header Filter submenu so it stays in sync with the
  // Filters panel (single source of truth, leads pattern).
  function toggleColumnFilter(dim: MemberFilterDim, value: string) {
    setFilters((f) => {
      const arr = f[dim] as string[];
      const next = arr.includes(value)
        ? arr.filter((v) => v !== value)
        : [...arr, value];
      return { ...f, [dim]: next };
    });
  }

  function quickFilterPressed(key: QuickMemberFilter): boolean {
    switch (key) {
      case 'churnRisk':
        return filters.churnRisk.length === 1 && filters.churnRisk[0] === 'yes';
      case 'feesDue':
        return filters.feeStatus.length === 1 && filters.feeStatus[0] === 'due';
      case 'followUps':
        return (
          filters.followUps.length === 1 && filters.followUps[0] === 'open'
        );
    }
  }

  // Quick chips intentionally replace their facet with the one useful value.
  // This avoids surprising states when the full Filters panel had "No" or
  // both values selected; tapping a chip always means exactly what it says.
  function setQuickFilter(key: QuickMemberFilter, pressed: boolean) {
    setFilters((current) => {
      switch (key) {
        case 'churnRisk':
          return { ...current, churnRisk: pressed ? ['yes'] : [] };
        case 'feesDue':
          return { ...current, feeStatus: pressed ? ['due'] : [] };
        case 'followUps':
          return { ...current, followUps: pressed ? ['open'] : [] };
      }
    });
  }

  function activeQuickFilters(): QuickMemberFilter[] {
    return QUICK_MEMBER_FILTERS.filter(({ key }) =>
      quickFilterPressed(key)
    ).map(({ key }) => key);
  }

  function setQuickFilters(next: QuickMemberFilter[]) {
    const current = activeQuickFilters();
    const changed = QUICK_MEMBER_FILTERS.find(
      ({ key }) => current.includes(key) !== next.includes(key)
    )?.key;
    if (changed) setQuickFilter(changed, next.includes(changed));
  }

  // Build the header Filter submenu prop for a column, or undefined for
  // free-text columns (name/expiry).
  function filterFor(col: MemberColumn): ColumnFilterProp | undefined {
    if (!col.filterDim) return undefined;
    const options =
      col.filterDim === 'plans'
        ? plans.map((p) => ({ value: p.id, label: p.name }))
        : col.filterDim === 'statuses'
          ? MEMBER_STATUS_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))
          : col.filterDim === 'feeStatus'
            ? FEE_STATUS_OPTIONS
            : CHURN_RISK_OPTIONS;
    return {
      options,
      selected: (filters[col.filterDim] as string[]) ?? [],
      onToggle: (v) => toggleColumnFilter(col.filterDim!, v),
    };
  }

  async function commitChurnRisk(
    customer: NormalizedMemberCustomerDirectoryRow,
    rawValue: string
  ) {
    const next = rawValue === 'yes';
    setSavingCell(true);
    try {
      // Returning the id distinguishes a successful write from an
      // RLS-blocked update that affected zero rows.
      const { data, error } = await supabase
        .from('contacts')
        .update({ churn_risk: next })
        .eq('id', customer.contact_id)
        .select('id')
        .maybeSingle();

      if (error || !data) {
        toast.error(getErrorMessage(error, 'Failed to update churn risk'));
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.contact_id === customer.contact_id && row.contact
            ? {
                ...row,
                contact_churn_risk: next,
                contact: { ...row.contact, churn_risk: next },
              }
            : row
        )
      );
    } finally {
      setSavingCell(false);
      setEditingCell(null);
    }
  }

  async function commitTrainer(
    customer: NormalizedMemberCustomerDirectoryRow,
    rawValue: string
  ) {
    const contact = customer.contact;
    if (!contact) return;
    const target = rawValue || null;
    if (target === (contact.trainer_id ?? null)) {
      setEditingCell(null);
      return;
    }
    setSavingCell(true);
    try {
      // RLS-blocked updates return no error and zero rows, so the select is
      // the only proof the write landed.
      const { data, error } = await supabase
        .from('contacts')
        .update({ trainer_id: target })
        .eq('id', contact.id)
        .select('id');
      if (error || !data || data.length === 0) {
        toast.error(getErrorMessage(error, 'Could not update the trainer'));
        return;
      }
      setRows((current) =>
        current.map((row) =>
          row.contact_id === customer.contact_id && row.contact
            ? { ...row, contact: { ...row.contact, trainer_id: target } }
            : row
        )
      );
      toast.success(target ? 'Trainer updated' : 'Trainer cleared');
    } finally {
      setSavingCell(false);
      setEditingCell(null);
    }
  }

  async function commitAssignee(
    customer: NormalizedMemberCustomerDirectoryRow,
    rawValue: string
  ) {
    const contact = customer.contact;
    if (!contact) return;
    const target = rawValue || null;
    if (target === (contact.assigned_to ?? null)) {
      setEditingCell(null);
      return;
    }

    setSavingCell(true);
    try {
      const outcome = await requestLeadAssignment(supabase, contact.id, target);
      if (outcome === 'approved') {
        setRows((current) =>
          current.map((row) =>
            row.contact_id === customer.contact_id && row.contact
              ? {
                  ...row,
                  contact_assigned_to: target,
                  contact: {
                    ...row.contact,
                    assigned_to: target,
                    pending_invitation_id: null,
                    pending_assignee_name: null,
                  },
                }
              : row
          )
        );
        toast.success(target ? 'Member assigned' : 'Member unassigned');
      } else {
        await fetchAssignmentRequests();
        toast.success('Sent to the contact owner for approval');
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update assignee'));
    } finally {
      setSavingCell(false);
      setEditingCell(null);
    }
  }

  async function handleAssignmentAction(
    requestId: string,
    action: 'approve' | 'reject' | 'cancel'
  ) {
    try {
      if (action === 'cancel') {
        await cancelLeadAssignment(supabase, requestId);
        toast.success('Request withdrawn');
      } else {
        await respondLeadAssignment(supabase, requestId, action === 'approve');
        toast.success(
          action === 'approve' ? 'Assignment approved' : 'Assignment rejected'
        );
      }
      await fetchAssignmentRequests();
      setAssignmentNonce((nonce) => nonce + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Action failed'));
    }
  }

  function renderAssignee(customer: NormalizedMemberCustomerDirectoryRow) {
    const contact = customer.contact;
    if (!contact) {
      return <span className="text-muted-foreground text-sm">Unassigned</span>;
    }

    const request = assignmentRequests[contact.id];
    if (request) {
      const fromId = request.from_user_id ?? contact.assigned_to ?? null;
      const targetName = request.to_user_id
        ? (nameById.get(request.to_user_id) ?? 'Teammate')
        : 'Unassign';
      const badge = (
        <TransferPendingDisplay
          ownerName={fromId ? (nameById.get(fromId) ?? 'Unassigned') : null}
          ownerAvatarUrl={fromId ? avatarById.get(fromId) : null}
          targetName={targetName}
        />
      );
      const canApprove =
        request.approver_user_id === user?.id || canResolveAnyAssignment;
      const canCancel =
        request.requested_by === user?.id || canResolveAnyAssignment;
      if (!canApprove && !canCancel) return badge;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="max-w-full min-w-0 text-left"
                onClick={(event) => event.stopPropagation()}
              />
            }
          >
            {badge}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            {canApprove && (
              <>
                <DropdownMenuItem
                  onClick={() =>
                    void handleAssignmentAction(request.id, 'approve')
                  }
                >
                  <Check className="size-4" />
                  Approve assignment
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void handleAssignmentAction(request.id, 'reject')
                  }
                >
                  <X className="size-4" />
                  Reject
                </DropdownMenuItem>
              </>
            )}
            {canCancel && (
              <DropdownMenuItem
                onClick={() =>
                  void handleAssignmentAction(request.id, 'cancel')
                }
              >
                <Ban className="size-4" />
                Withdraw request
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (contact.pending_invitation_id && contact.pending_assignee_name) {
      return <PendingAssigneeDisplay name={contact.pending_assignee_name} />;
    }
    if (!contact.assigned_to) {
      return <span className="text-muted-foreground text-sm">Unassigned</span>;
    }
    return (
      <AssigneeDisplay
        name={nameById.get(contact.assigned_to) ?? 'Teammate'}
        avatarUrl={avatarById.get(contact.assigned_to)}
      />
    );
  }

  function renderRowActions(customer: NormalizedMemberCustomerDirectoryRow) {
    const m = asMembership(customer);
    const memberName = customer.contact?.name?.trim() || 'customer';
    if (!m) {
      return (
        <div className="flex items-center justify-end gap-1">
          <FollowUpButton
            canAct={canEdit}
            onClick={() => setFollowUpFor(customer)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More actions for ${memberName}`}
                  title="More actions"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem
                onClick={() =>
                  onSelect({
                    contactId: customer.contact_id,
                    membershipId: null,
                  })
                }
              >
                <Eye className="size-4" />
                View details
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    }
    const canRenewOrConvert = m.status === 'active';
    const canRecordPayment =
      !m.is_trial && m.status !== 'cancelled' && m.fee_status === 'due';

    return (
      <div className="flex items-center justify-end gap-1">
        <FollowUpButton
          canAct={canEdit}
          onClick={() => setFollowUpFor(customer)}
        />
        <SendReminderButton membership={m} readiness={readiness} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`More actions for ${memberName}`}
                title="More actions"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem
              onClick={() =>
                onSelect({ contactId: m.contact_id, membershipId: m.id })
              }
            >
              <Eye className="size-4" />
              View details
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canEdit} onClick={() => onEdit(m)}>
              <Pencil className="size-4" />
              Edit membership
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {canRenewOrConvert && (
              <DropdownMenuItem
                disabled={!canEdit}
                onClick={() => setRenewFor(m)}
              >
                {m.is_trial ? (
                  <UserPlus className="size-4" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {m.is_trial ? 'Convert to member' : 'Renew membership'}
              </DropdownMenuItem>
            )}
            {canRecordPayment && (
              <DropdownMenuItem
                disabled={!canEdit}
                onClick={() => setPaymentFor(m)}
              >
                <Wallet className="size-4" />
                Record payment
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // Cell body per column key — reaches fmt/readiness/todayDisplay closures.
  function renderCell(
    key: string,
    customer: NormalizedMemberCustomerDirectoryRow
  ) {
    const m = asMembership(customer);
    switch (key) {
      case 'name':
        return (
          <MemberIdentity
            name={customer.contact?.name}
            secondary={customer.contact?.phone}
            src={customer.contact?.avatar_url}
            avatarPreview={
              m
                ? buildMemberAvatarPreview({
                    membership: m,
                    accountId,
                    view: 'all',
                    readiness,
                    canFollowUp: canEdit,
                    onSelect: () =>
                      onSelect({
                        contactId: m.contact_id,
                        membershipId: m.id,
                      }),
                    onFollowUp: () => setFollowUpFor(customer),
                  })
                : undefined
            }
          />
        );
      case 'memberId':
        return (
          <span className="text-foreground font-mono text-sm tabular-nums">
            {m?.member_number ?? '—'}
          </span>
        );
      case 'plan':
        return (
          <span className="text-muted-foreground truncate">
            {m?.plan?.name ?? '—'}
          </span>
        );
      case 'expiry':
        return (
          <span className="text-muted-foreground">
            {customer.display_expiry ? fmt.date(customer.display_expiry) : '—'}
          </span>
        );
      case 'status': {
        if (!m) return <ServiceCustomerStatusBadge />;
        const eff = effectiveStatus(m, todayDisplay);
        const days = daysUntil(m.end_date, todayDisplay);
        return <MembershipStatusBadge status={eff} daysToExpiry={days} />;
      }
      case 'assignee':
        return renderAssignee(customer);
      case 'trainer': {
        const trainerId = customer.contact?.trainer_id ?? null;
        if (!trainerId) {
          return (
            <span className="text-muted-foreground text-sm">No trainer</span>
          );
        }
        return (
          <span className="truncate text-sm">
            {trainerNameById.get(trainerId) ?? 'Trainer'}
          </span>
        );
      }
      case 'fee':
        if (!m) {
          return (
            <span className="text-muted-foreground text-sm tabular-nums">
              {fmt.money(customer.generic_balance)}
            </span>
          );
        }
        return (
          <div className="flex items-center gap-1.5">
            <FeeStatusBadge status={m.fee_status} />
            <span className="text-muted-foreground text-xs tabular-nums">
              {fmt.money(m.fee_amount)}
            </span>
          </div>
        );
      case 'churnRisk':
        return customer.contact?.churn_risk ? (
          <Badge variant="danger">Yes</Badge>
        ) : (
          <span className="text-muted-foreground">No</span>
        );
      case 'reminder':
        return renderRowActions(customer);
      default:
        return null;
    }
  }

  useEffect(() => {
    const seq = ++fetchSeq.current;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = fmt.today();
      const result = await loadMemberDirectory(supabase, {
        today,
        search,
        filters,
        sort,
        page,
        pageSize,
      });
      if (cancelled || seq !== fetchSeq.current) return;
      setRows(result.rows);
      setTotalCount(result.totalCount);
      setQuickFilterCounts(result.quickFilterCounts);
      setLoading(false);
    })().catch((error) => {
      if (cancelled || seq !== fetchSeq.current) return;
      toast.error(getErrorMessage(error, 'Failed to load members'));
      setRows([]);
      setTotalCount(0);
      setQuickFilterCounts(EMPTY_MEMBER_DIRECTORY_QUICK_FILTER_COUNTS);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    supabase,
    reloadKey,
    assignmentNonce,
    search,
    filters,
    sort,
    page,
    pageSize,
    fmt,
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasPrev = page > 0;
  const hasNext = page < totalPages - 1;

  const selectableRows = rows.filter((row) => row.membership_id !== null);
  const allOnPageSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selected.has(row.membership_id!));
  const someOnPageSelected = selectableRows.some((row) =>
    selected.has(row.membership_id!)
  );

  function toggleSelect(customer: NormalizedMemberCustomerDirectoryRow) {
    if (!customer.membership_id) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(customer.membership_id!)) {
        next.delete(customer.membership_id!);
      } else {
        next.set(customer.membership_id!, customer.contact_id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allOnPageSelected) {
        selectableRows.forEach((row) => next.delete(row.membership_id!));
      } else {
        selectableRows.forEach((row) =>
          next.set(row.membership_id!, row.contact_id)
        );
      }
      return next;
    });
  }

  // Select every membership-backed customer matching the current search +
  // filters, including rows on other pages. The explicit action requests the
  // unbounded form of the same RLS-invoker snapshot, then retains only ids.
  async function selectAllMatching() {
    const today = fmt.today();
    const result = await loadMemberDirectory(supabase, {
      today,
      search,
      filters,
      sort: null,
      page: 0,
      pageSize: null,
    }).catch((error) => {
      toast.error(getErrorMessage(error, 'Failed to select members'));
      return null;
    });
    if (!result) return;
    setSelected(
      new Map(
        result.rows.flatMap((customer) =>
          customer.membership_id
            ? [[customer.membership_id, customer.contact_id]]
            : []
        )
      )
    );
  }

  function clearSelection() {
    setSelected(new Map());
  }

  // Export every member matching the current search + filters (not just
  // the page), resolved through the same display helpers as the table so
  // the file matches the screen.
  async function handleExport() {
    const today = fmt.today();
    const result = await loadMemberDirectory(supabase, {
      today,
      search,
      filters,
      sort: null,
      page: 0,
      pageSize: null,
    }).catch((error) => {
      toast.error(getErrorMessage(error, 'Export failed'));
      return null;
    });
    if (!result) return;
    const all = result.rows;
    const csv = toCsv(
      [
        'Name',
        'Member ID',
        'Phone',
        'Email',
        'Plan',
        'Start',
        'Expiry',
        'Status',
        'Assigned to',
        'Fee',
        'Fee status',
        'Churn risk',
      ],
      all.map((customer) => {
        const membership = asMembership(customer);
        return [
          customer.contact?.name ?? '',
          membership?.member_number ?? '',
          customer.contact?.phone ?? '',
          customer.contact?.email ?? '',
          membership?.plan?.name ?? '',
          membership?.start_date ?? '',
          customer.display_expiry ?? '',
          membership ? effectiveStatus(membership, today) : 'Service customer',
          customer.contact?.pending_assignee_name ??
            (customer.contact?.assigned_to
              ? (nameById.get(customer.contact.assigned_to) ?? 'Teammate')
              : 'Unassigned'),
          fmt.money(membership?.fee_amount ?? customer.generic_balance),
          membership?.fee_status ?? '',
          customer.contact?.churn_risk ? 'Yes' : 'No',
        ];
      })
    );
    downloadCsv(`members-${today}.csv`, csv);
    toast.success(
      `Exported ${all.length} member${all.length === 1 ? '' : 's'}`
    );
  }

  // Keep a live handle on handleExport (it closes over the current
  // search/filters), then register a stable caller with the page once —
  // so the header Export button always runs the latest-filtered export.
  const exportRef = useRef(handleExport);
  useEffect(() => {
    exportRef.current = handleExport;
  });
  useEffect(() => {
    onRegisterExport?.(() => {
      void exportRef.current();
    });
    return () => onRegisterExport?.(null);
  }, [onRegisterExport]);

  function bulkDone() {
    clearSelection();
    onChanged();
  }

  // Bulk WhatsApp reminders — sequential sends so one member's failure
  // doesn't abort the rest; single tally toast at the end.
  async function sendBulkReminders() {
    if (!readiness.ready) {
      if (readiness.reason) toast.error(readiness.reason);
      return;
    }
    setReminding(true);
    const ids = [...selected.keys()];
    const { data } = await supabase
      .from('memberships')
      .select('*, contact:contacts(*), plan:membership_plans(*)')
      .in('id', ids);
    const memberships = (data as Membership[]) ?? [];

    let sent = 0;
    let noPhone = 0;
    let failed = 0;
    for (const m of memberships) {
      if (!m.contact?.phone?.trim()) {
        noPhone++;
        continue;
      }
      try {
        await sendRenewalReminder(m, readiness, fmt);
        sent++;
      } catch {
        failed++;
      }
    }
    setReminding(false);
    setRemindOpen(false);

    const parts = [`${sent} reminder${sent === 1 ? '' : 's'} sent`];
    if (noPhone) parts.push(`${noPhone} without a phone skipped`);
    if (failed) parts.push(`${failed} failed`);
    (sent === 0 && failed ? toast.error : toast.success)(parts.join(' · '));
    bulkDone();
  }

  // Delete through the same admin-gated RPC as the member profile danger
  // zone. A small worker pool keeps an all-matching selection responsive
  // without flooding PostgREST, and successful rows disappear even when a
  // later row fails.
  async function deleteSelectedMembers() {
    const entries = [...selected.entries()];
    if (entries.length === 0 || !canDeleteSelected) return;

    setDeleting(true);
    const contactIds = [...new Set(entries.map(([, contactId]) => contactId))];
    const results: { contactId: string; error: unknown }[] = [];
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < contactIds.length) {
        const contactId = contactIds[nextIndex++];
        try {
          const { error } = await supabase.rpc('delete_member', {
            p_contact_id: contactId,
          });
          results.push({ contactId, error });
        } catch (error) {
          results.push({ contactId, error });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(5, contactIds.length) }, () => worker())
    );

    const failed = results.filter((result) => result.error);
    const failedContactIds = new Set(failed.map((result) => result.contactId));
    const deletedCount = contactIds.length - failed.length;

    setDeleting(false);
    setDeleteOpen(false);

    if (deletedCount > 0) {
      setSelected(
        new Map(
          entries.filter(([, contactId]) => failedContactIds.has(contactId))
        )
      );
      onChanged();
    }

    if (failed.length === 0) {
      toast.success(
        `${deletedCount} member${deletedCount === 1 ? '' : 's'} deleted`
      );
    } else if (deletedCount > 0) {
      toast.success(
        `${deletedCount} member${deletedCount === 1 ? '' : 's'} deleted · ${failed.length} failed`
      );
    } else {
      toast.error(
        getErrorMessage(failed[0]?.error, 'Failed to delete members')
      );
    }
  }

  return (
    <div className="space-y-3">
      {/* Match the Leads data surface: search and table actions live inside
          the same rounded container as the selection row and table. */}
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          <SearchInput
            value={searchInput}
            onValueChange={setSearchInput}
            placeholder="Search by name or ID"
            aria-label="Search members by name or Member ID"
          />

          {/* Data controls stay beside search; column management is the
              trailing gear, matching the Leads table interaction. */}
          <LayoutGroup id="member-table-filter-controls">
            <div className="flex shrink-0 items-center gap-2">
              <MembersFilters
                value={filters}
                onChange={setFilters}
                plans={plans}
              />
              <motion.div
                data-slot="member-filter-following-controls"
                layout="position"
                transition={{
                  duration: reduceMotion ? 0 : 0.2,
                  ease: [0.2, 0, 0, 1],
                }}
                className="flex items-center gap-2"
              >
                <LeadsSort
                  value={prefs.sort}
                  onChange={(next) => setPrefs((p) => ({ ...p, sort: next }))}
                  columns={SORT_COLUMNS}
                />
                <Separator
                  orientation="vertical"
                  className="mx-0.5 h-5 data-vertical:self-center"
                />
                <ChipGroup<QuickMemberFilter>
                  selectionMode="multiple"
                  value={activeQuickFilters()}
                  onValueChange={setQuickFilters}
                  aria-label="Quick filters"
                >
                  {QUICK_MEMBER_FILTERS.map((filter) => (
                    <Chip key={filter.key} value={filter.key}>
                      {filter.label}
                      <ChipCount count={quickFilterCounts[filter.key]} />
                    </Chip>
                  ))}
                </ChipGroup>
              </motion.div>
            </div>
          </LayoutGroup>

          {/* Show/hide columns — the unhide surface for header "Hide column". */}
          <div className="ml-auto flex shrink-0 items-center">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Manage columns"
                    title="Manage columns"
                  />
                }
              >
                <Settings className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {MEMBER_COLUMNS.map((col) => {
                  const shown = !prefs.hidden.includes(col.key);
                  return (
                    <DropdownMenuItem
                      key={col.key}
                      closeOnClick={false}
                      disabled={col.required}
                      onClick={() => toggleColumnVisible(col.key)}
                      className="gap-2"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                          shown
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input-border bg-card'
                        )}
                      >
                        {shown && <Check className="size-3.5" />}
                      </span>
                      <span className="truncate">{col.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Bulk-selection toolbar (leads pattern — Collapse + frozen count). */}
        <Collapse open={selected.size > 0}>
          <div className="border-border bg-muted/20 flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group font-semibold"
                  />
                }
              >
                {bulkCount} member{bulkCount === 1 ? '' : 's'} selected
                <ChevronDown className="size-4 transition-transform duration-150 group-data-[popup-open]:rotate-180" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                <DropdownMenuItem onClick={clearSelection}>
                  <X className="size-4" />
                  None
                </DropdownMenuItem>
                <DropdownMenuItem onClick={selectAllMatching}>
                  <ListChecks className="size-4" />
                  All {totalCount} matching
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="bg-border mx-0.5 h-4 w-px" />

            <GatedButton
              variant="ghost"
              size="sm"
              canAct={canEdit}
              gateReason="send reminders"
              onClick={() => setRemindOpen(true)}
            >
              <MessageCircle />
              Remind
            </GatedButton>
            <GatedButton
              variant="ghost"
              size="sm"
              canAct={canEdit}
              gateReason="add notes"
              onClick={() => setNoteOpen(true)}
            >
              <StickyNote />
              Add note
            </GatedButton>
            <GatedButton
              variant="ghost"
              size="sm"
              canAct={canEdit}
              gateReason="record payments"
              onClick={() => setPayOpen(true)}
            >
              <Wallet />
              Record payment
            </GatedButton>
            <GatedButton
              variant="destructive-ghost"
              size="sm"
              canAct={canDeleteSelected}
              gateReason="delete members"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
              Delete
            </GatedButton>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="ml-auto"
            >
              <X />
            </Button>
          </div>
        </Collapse>

        {loading && rows.length === 0 ? (
          <div className="min-w-0">
            <TableSkeleton
              className="table-fixed"
              style={{ minWidth: totalWidth }}
              label="Loading members"
              rows={9}
              columns={[
                {
                  label: '',
                  variant: 'checkbox',
                  width: CHECKBOX_COL_WIDTH,
                  headClassName: cn(
                    'px-0',
                    prefs.nameFrozen && 'bg-card sticky left-0 z-20'
                  ),
                  cellClassName: cn(
                    'px-0',
                    prefs.nameFrozen && 'bg-card-2 sticky left-0 z-10'
                  ),
                },
                ...visibleColumns.map((col) => ({
                  label: col.label,
                  variant: (col.key === 'name'
                    ? 'identity'
                    : col.key === 'status'
                      ? 'badge'
                      : col.key === 'fee'
                        ? 'stacked'
                        : col.key === 'reminder'
                          ? 'actions'
                          : 'text') as TableSkeletonCellVariant,
                  width: widthOf(col),
                  headClassName: cn(
                    col.align === 'right' && 'text-right',
                    col.key === 'name' && prefs.nameFrozen
                      ? 'bg-card sticky z-20'
                      : 'relative'
                  ),
                  headStyle:
                    col.key === 'name' && prefs.nameFrozen
                      ? {
                          position: 'sticky' as const,
                          left: CHECKBOX_COL_WIDTH,
                        }
                      : undefined,
                  cellClassName:
                    col.key === 'name' && prefs.nameFrozen
                      ? 'bg-card-2 sticky z-10'
                      : undefined,
                  cellStyle:
                    col.key === 'name' && prefs.nameFrozen
                      ? {
                          position: 'sticky' as const,
                          left: CHECKBOX_COL_WIDTH,
                        }
                      : undefined,
                })),
              ]}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Dumbbell className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">
              {totalCount === 0 && !search.trim()
                ? 'No members yet. Add your first member.'
                : 'No members match your search or filters.'}
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <Table className="table-fixed" style={{ minWidth: totalWidth }}>
              <colgroup>
                <col style={{ width: CHECKBOX_COL_WIDTH }} />
                {visibleColumns.map((col) => (
                  <col key={col.key} style={{ width: widthOf(col) }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className={cn(
                      'px-0',
                      prefs.nameFrozen && 'bg-card sticky left-0 z-20'
                    )}
                  >
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={allOnPageSelected}
                        indeterminate={!allOnPageSelected && someOnPageSelected}
                        onCheckedChange={toggleSelectAll}
                        disabled={rows.length === 0}
                        aria-label="Select all members on this page"
                      />
                    </div>
                  </TableHead>
                  {visibleColumns.map((col) => (
                    <TableHead
                      key={col.key}
                      style={
                        col.key === 'name' && prefs.nameFrozen
                          ? { position: 'sticky', left: CHECKBOX_COL_WIDTH }
                          : undefined
                      }
                      className={cn(
                        'text-muted-foreground select-none',
                        col.key === 'name' && prefs.nameFrozen
                          ? 'bg-card z-20'
                          : 'relative'
                      )}
                    >
                      <ColumnHeader
                        label={col.label}
                        sortable={Boolean(col.sortKey)}
                        sortDir={
                          col.sortKey && sort?.key === col.sortKey
                            ? sort.dir
                            : null
                        }
                        onSort={(dir) =>
                          col.sortKey && sortByColumn(col.sortKey, dir)
                        }
                        filter={filterFor(col)}
                        onHide={
                          col.required ? undefined : () => hideColumn(col.key)
                        }
                        frozen={col.key === 'name' && prefs.nameFrozen}
                        onToggleFreeze={
                          col.key === 'name' ? toggleNameFrozen : undefined
                        }
                      />
                      {/* Resize grip on the right edge (leads pattern). */}
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={(e) => startResize(e, col)}
                        className="border-border hover:border-primary absolute top-2 right-0 bottom-2 w-1.5 cursor-col-resize border-r hover:border-r-2"
                      />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((customer) => {
                  const membership = asMembership(customer);
                  return (
                    <TableRow
                      key={customer.contact_id}
                      className="group cursor-pointer"
                      onClick={() =>
                        onSelect({
                          contactId: customer.contact_id,
                          membershipId: customer.membership_id,
                        })
                      }
                    >
                      <TableCell
                        className={cn(
                          'px-0',
                          prefs.nameFrozen &&
                            'bg-card group-hover:bg-card-2 sticky left-0 z-10'
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={Boolean(
                              customer.membership_id &&
                              selected.has(customer.membership_id)
                            )}
                            onCheckedChange={() => toggleSelect(customer)}
                            disabled={!membership}
                            aria-label={`Select ${customer.contact?.name || 'customer'}`}
                          />
                        </div>
                      </TableCell>
                      {visibleColumns.map((col) => (
                        <TableCell
                          key={col.key}
                          style={
                            col.key === 'name' && prefs.nameFrozen
                              ? { position: 'sticky', left: CHECKBOX_COL_WIDTH }
                              : undefined
                          }
                          className={cn(
                            'overflow-hidden',
                            col.key === 'name' &&
                              prefs.nameFrozen &&
                              'bg-card group-hover:bg-card-2 z-10',
                            (col.key === 'assignee' ||
                              col.key === 'trainer' ||
                              col.key === 'churnRisk') &&
                              canEdit &&
                              'p-0',
                            col.align === 'right' && 'text-right'
                          )}
                          onClick={
                            col.key === 'reminder'
                              ? (e) => e.stopPropagation()
                              : undefined
                          }
                        >
                          {col.key === 'assignee' && canEdit ? (
                            <EditableCell
                              editing={
                                editingCell?.id === customer.contact_id &&
                                editingCell.key === 'assignee'
                              }
                              saving={savingCell}
                              kind="select"
                              value={customer.contact?.assigned_to ?? ''}
                              options={assigneeCellOptions(staff)}
                              display={renderCell(col.key, customer)}
                              onStart={() =>
                                setEditingCell({
                                  id: customer.contact_id,
                                  key: 'assignee',
                                })
                              }
                              onCommit={(value) =>
                                void commitAssignee(customer, value)
                              }
                              onCancel={() => setEditingCell(null)}
                            />
                          ) : col.key === 'trainer' && canEdit ? (
                            <EditableCell
                              editing={
                                editingCell?.id === customer.contact_id &&
                                editingCell.key === 'trainer'
                              }
                              saving={savingCell}
                              kind="select"
                              value={customer.contact?.trainer_id ?? ''}
                              options={[
                                { value: '', label: 'No trainer' },
                                ...trainers.map((trainer) => ({
                                  value: trainer.id,
                                  label: trainer.display_name,
                                })),
                              ]}
                              display={renderCell(col.key, customer)}
                              onStart={() =>
                                setEditingCell({
                                  id: customer.contact_id,
                                  key: 'trainer',
                                })
                              }
                              onCommit={(value) =>
                                void commitTrainer(customer, value)
                              }
                              onCancel={() => setEditingCell(null)}
                            />
                          ) : col.key === 'churnRisk' && canEdit ? (
                            <EditableCell
                              editing={
                                editingCell?.id === customer.contact_id &&
                                editingCell.key === 'churnRisk'
                              }
                              saving={savingCell}
                              kind="status"
                              value={
                                customer.contact?.churn_risk ? 'yes' : 'no'
                              }
                              options={CHURN_RISK_CELL_OPTIONS}
                              display={renderCell(col.key, customer)}
                              onStart={() =>
                                setEditingCell({
                                  id: customer.contact_id,
                                  key: 'churnRisk',
                                })
                              }
                              onCommit={(value) =>
                                commitChurnRisk(customer, value)
                              }
                              onCancel={() => setEditingCell(null)}
                            />
                          ) : (
                            renderCell(col.key, customer)
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Pager footer (leads pattern) */}
            <div className="border-border flex items-center justify-between border-t px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {totalCount > 0
                  ? `${totalCount} member${totalCount === 1 ? '' : 's'}`
                  : 'No members'}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!hasPrev}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-muted-foreground px-2 text-xs">
                  Page {page + 1} of {Math.max(totalPages, 1)}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!hasNext}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {followUpFor &&
        (asMembership(followUpFor) ? (
          <FollowUpDialog
            open
            onOpenChange={(open) => !open && setFollowUpFor(null)}
            membership={asMembership(followUpFor)!}
            onSaved={onChanged}
          />
        ) : (
          <FollowUpDialog
            open
            onOpenChange={(open) => !open && setFollowUpFor(null)}
            contactId={followUpFor.contact_id}
            contactName={followUpFor.contact.name}
            onSaved={onChanged}
          />
        ))}
      {renewFor && (
        <RenewMembershipDialog
          open
          onOpenChange={(open) => !open && setRenewFor(null)}
          membership={renewFor}
          variant={renewFor.is_trial ? 'convert' : 'renew'}
          onSaved={onChanged}
        />
      )}
      {paymentFor && (
        <RecordPaymentDialog
          open
          onOpenChange={(open) => !open && setPaymentFor(null)}
          membership={paymentFor}
          onSaved={onChanged}
        />
      )}

      {/* Bulk dialogs */}
      <BulkAddNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        contactIds={[...new Set(selected.values())]}
        onDone={bulkDone}
        noun="member"
      />
      <BulkRecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        membershipIds={[...selected.keys()]}
        onDone={bulkDone}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => !deleting && setDeleteOpen(open)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size} selected member
              {selected.size === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the selected member profiles,
              memberships, attendance, and notes. Payment ledger entries are
              retained without member links for accounting. This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={deleteSelectedMembers}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete member{selected.size === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk-remind confirm — a WhatsApp blast shouldn't be one stray click. */}
      <Dialog open={remindOpen} onOpenChange={setRemindOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Send renewal reminders</DialogTitle>
            <DialogDescription>
              Send the WhatsApp renewal template to {selected.size} selected
              member{selected.size === 1 ? '' : 's'}? Members without a phone
              number are skipped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemindOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={sendBulkReminders}
              disabled={reminding || !readiness.ready}
              title={readiness.reason ?? undefined}
            >
              {reminding && <Loader2 className="size-4 animate-spin" />}
              Send reminders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
