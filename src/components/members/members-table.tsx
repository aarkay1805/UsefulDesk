"use client";

// The "All members" table — server-paginated, sortable, filterable, with
// multi-select bulk actions (remind / add note / record payment). Borrows
// the leads table's data-layer idioms: fetch-sequence guard, shared
// filter definition (applyMemberFilters — also used by select-all-matching
// and CSV export), and the Collapse bulk toolbar. Deliberately NOT the
// leads grid — no column customization; members stay lightweight.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  ListChecks,
  Loader2,
  MessageCircle,
  StickyNote,
  Wallet,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import { toCsv, downloadCsv } from "@/lib/csv/export";
import { effectiveStatus, daysUntil } from "@/lib/memberships/expiry";
import {
  applyMemberFilters,
  EMPTY_MEMBER_FILTERS,
  type MemberFilters,
} from "@/lib/memberships/filters";
import type { Membership } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapse } from "@/components/ui/collapse";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GatedButton } from "@/components/ui/gated-button";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LeadsSort, type SortState } from "@/components/leads/leads-sort";
import { BulkAddNoteDialog } from "@/components/leads/bulk-add-note-dialog";
import { useTablePrefs } from "@/hooks/use-table-prefs";
import {
  MembershipStatusBadge,
  FeeStatusBadge,
} from "./membership-status-badge";
import { MembersFilters } from "./members-filters";
import { BulkRecordPaymentDialog } from "./bulk-record-payment-dialog";
import { useMembershipPlans } from "./use-membership-plans";
import {
  SendReminderButton,
  sendRenewalReminder,
  type ReminderReadiness,
} from "./send-reminder-button";

const PAGE_SIZE = 25;

// Sortable columns. `name` orders the parent by the embedded contact
// (PostgREST `order=contact(name)`); the rest are memberships columns.
const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "end_date", label: "Expiry" },
  { key: "fee_amount", label: "Fee" },
  { key: "fee_status", label: "Fee status" },
  { key: "start_date", label: "Start date" },
];

interface MembersTablePrefs {
  pageSize: number;
  sort: SortState | null;
}

const DEFAULT_PREFS: MembersTablePrefs = {
  pageSize: PAGE_SIZE,
  sort: null,
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
  onSelect: (membershipId: string) => void;
  /** Bump to force a refetch after a mutation elsewhere. */
  reloadKey: number;
  /** Refresh the rest of the Members page after a bulk write here. */
  onChanged: () => void;
  /** Gate on bulk actions (canSendMessages — agent+). */
  canEdit: boolean;
  /** Lets the page surface this table's filter-aware CSV export in the
   *  app-bar header. The table hands up a caller (or null on unmount);
   *  the page's Export button invokes it. */
  onRegisterExport?: (fn: (() => void) | null) => void;
}

export function MembersTable({
  readiness,
  onSelect,
  reloadKey,
  onChanged,
  canEdit,
  onRegisterExport,
}: MembersTableProps) {
  const supabase = useMemo(() => createClient(), []);
  const { fmt } = useLocale();
  // Include archived plans so members on a retired plan still filter.
  const { plans } = useMembershipPlans(false);

  const [rows, setRows] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput, 300);
  const [filters, setFilters] = useState<MemberFilters>(EMPTY_MEMBER_FILTERS);
  const [prefs, setPrefs] = useTablePrefs<MembersTablePrefs>(
    "members-all",
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
  const [reminding, setReminding] = useState(false);

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

  useEffect(() => {
    const seq = ++fetchSeq.current;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = fmt.today();
      let q = supabase
        .from("memberships")
        .select("*, contact:contacts!inner(*), plan:membership_plans(*)", {
          count: "exact",
        });

      const term = search.trim();
      if (term) {
        const like = `%${term}%`;
        q = q.or(`name.ilike.${like},phone.ilike.${like}`, {
          referencedTable: "contact",
        });
      }
      q = applyMemberFilters(q, filters, today);

      if (sort?.key === "name") {
        q = q.order("contact(name)", { ascending: sort.dir === "asc" });
      } else if (sort) {
        q = q.order(sort.key, { ascending: sort.dir === "asc" });
      } else {
        // Default: soonest expiry first — the renewal-first ordering.
        q = q.order("end_date", { ascending: true });
      }

      const from = page * pageSize;
      const { data, count } = await q.range(from, from + pageSize - 1);
      if (cancelled || seq !== fetchSeq.current) return;
      setRows((data as Membership[]) ?? []);
      setTotalCount(count ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, reloadKey, search, filters, sort, page, pageSize, fmt]);

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasPrev = page > 0;
  const hasNext = page < totalPages - 1;

  const allOnPageSelected =
    rows.length > 0 && rows.every((m) => selected.has(m.id));
  const someOnPageSelected = rows.some((m) => selected.has(m.id));

  function toggleSelect(m: Membership) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.set(m.id, m.contact_id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allOnPageSelected) rows.forEach((m) => next.delete(m.id));
      else rows.forEach((m) => next.set(m.id, m.contact_id));
      return next;
    });
  }

  // Select every member matching the current search + filters — including
  // rows on other pages. Same query shape as the fetch, ids only.
  async function selectAllMatching() {
    const today = fmt.today();
    let q = supabase
      .from("memberships")
      .select("id, contact_id, contact:contacts!inner(id)");
    const term = search.trim();
    if (term) {
      const like = `%${term}%`;
      q = q.or(`name.ilike.${like},phone.ilike.${like}`, {
        referencedTable: "contact",
      });
    }
    q = applyMemberFilters(q, filters, today);
    const { data } = await q;
    setSelected(
      new Map(
        ((data as { id: string; contact_id: string }[]) ?? []).map((m) => [
          m.id,
          m.contact_id,
        ])
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
    let q = supabase
      .from("memberships")
      .select("*, contact:contacts!inner(*), plan:membership_plans(*)");
    const term = search.trim();
    if (term) {
      const like = `%${term}%`;
      q = q.or(`name.ilike.${like},phone.ilike.${like}`, {
        referencedTable: "contact",
      });
    }
    q = applyMemberFilters(q, filters, today).order("end_date", {
      ascending: true,
    });
    const { data, error } = await q;
    if (error) {
      toast.error("Export failed");
      return;
    }
    const all = (data as Membership[]) ?? [];
    const csv = toCsv(
      ["Name", "Phone", "Email", "Plan", "Start", "Expiry", "Status", "Fee", "Fee status"],
      all.map((m) => [
        m.contact?.name ?? "",
        m.contact?.phone ?? "",
        m.contact?.email ?? "",
        m.plan?.name ?? "",
        m.start_date,
        m.end_date,
        effectiveStatus(m, today),
        fmt.money(m.fee_amount),
        m.fee_status,
      ])
    );
    downloadCsv(`members-${today}.csv`, csv);
    toast.success(`Exported ${all.length} member${all.length === 1 ? "" : "s"}`);
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
      .from("memberships")
      .select("*, contact:contacts(*), plan:membership_plans(*)")
      .in("id", ids);
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

    const parts = [`${sent} reminder${sent === 1 ? "" : "s"} sent`];
    if (noPhone) parts.push(`${noPhone} without a phone skipped`);
    if (failed) parts.push(`${failed} failed`);
    (sent === 0 && failed ? toast.error : toast.success)(parts.join(" · "));
    bulkDone();
  }

  return (
    <div className="space-y-3">
      {/* Toolbar — search + sort + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          containerClassName="max-w-xs flex-1 basis-52"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search members…"
        />
        <div className="ml-auto flex items-center gap-2">
          <LeadsSort
            value={prefs.sort}
            onChange={(next) => setPrefs((p) => ({ ...p, sort: next }))}
            columns={SORT_COLUMNS}
          />
          <MembersFilters value={filters} onChange={setFilters} plans={plans} />
        </div>
      </div>

      {/* Bulk-selection toolbar (leads pattern — Collapse + frozen count). */}
      <Collapse open={selected.size > 0}>
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-card px-1.5 py-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="group flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[0.8rem] font-semibold text-foreground hover:bg-muted"
                />
              }
            >
              {bulkCount} member{bulkCount === 1 ? "" : "s"} selected
              <ChevronDown className="size-4 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56 border-border bg-popover">
              <DropdownMenuItem
                onClick={clearSelection}
                className="text-popover-foreground focus:bg-muted focus:text-foreground"
              >
                <X className="size-4" />
                None
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={selectAllMatching}
                className="text-popover-foreground focus:bg-muted focus:text-foreground"
              >
                <ListChecks className="size-4" />
                All {totalCount} matching
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="mx-0.5 h-4 w-px bg-border" />

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={canEdit}
            gateReason="send reminders"
            onClick={() => setRemindOpen(true)}
            className="text-foreground"
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
            className="text-foreground"
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
            className="text-foreground"
          >
            <Wallet />
            Record payment
          </GatedButton>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={clearSelection}
            aria-label="Clear selection"
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <X />
          </Button>
        </div>
      </Collapse>

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading members…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <Dumbbell className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {totalCount === 0 && !search.trim()
              ? "No members yet. Add your first member."
              : "No members match your search or filters."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allOnPageSelected}
                    indeterminate={!allOnPageSelected && someOnPageSelected}
                    onCheckedChange={toggleSelectAll}
                    disabled={rows.length === 0}
                    aria-label="Select all members on this page"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead className="text-right">Reminder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const eff = effectiveStatus(m, todayDisplay);
                const days = daysUntil(m.end_date, todayDisplay);
                return (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(m.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(m.id)}
                        onCheckedChange={() => toggleSelect(m)}
                        aria-label={`Select ${m.contact?.name || "member"}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {m.contact?.name || "Unnamed"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.contact?.phone}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.plan?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmt.date(m.end_date)}
                    </TableCell>
                    <TableCell>
                      <MembershipStatusBadge status={eff} daysToExpiry={days} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <FeeStatusBadge status={m.fee_status} />
                        <span className="text-xs text-muted-foreground">
                          {fmt.money(m.fee_amount)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <SendReminderButton membership={m} readiness={readiness} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Pager footer (leads pattern) */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">
              {totalCount > 0
                ? `${totalCount} member${totalCount === 1 ? "" : "s"}`
                : "No members"}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!hasPrev}
                onClick={() => setPage((p) => p - 1)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 text-xs text-muted-foreground">
                Page {page + 1} of {Math.max(totalPages, 1)}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
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

      {/* Bulk-remind confirm — a WhatsApp blast shouldn't be one stray click. */}
      <Dialog open={remindOpen} onOpenChange={setRemindOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Send renewal reminders</DialogTitle>
            <DialogDescription>
              Send the WhatsApp renewal template to {selected.size} selected
              member{selected.size === 1 ? "" : "s"}? Members without a phone
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
              className="bg-primary text-primary-foreground hover:bg-primary/90"
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
