"use client";

import { memo, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Contact, LeadStatus, LeadTransfer, Tag } from "@/types";
import { canDeleteLead, type AccountRole } from "@/lib/auth/roles";
import {
  columnToStatus,
  leadColumnKey,
  type LeadColumn,
  type LeadColumnKey,
} from "@/lib/leads/status";
import {
  humaniseKey,
  UNKNOWN_STATUS_COLOR,
} from "@/lib/leads/field-options";
import {
  ArrowRight,
  Building2,
  Eye,
  MoreHorizontal,
  Pencil,
  Phone,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { SourceIcon } from "@/components/leads/source-icon";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/use-locale";

/** Board rows are table rows — same enrichment (tags ride along). */
export type BoardLead = Contact & { tags?: Tag[] };

// Board view settings (Tier 1), persisted in the shared `table_preferences`
// 'leads' blob (migration 053). Density = how much each card shows (the
// board's peer of the table's clip/wrap); sort-within = card order inside
// each status column (the board hard-coded newest-first before this).
export type BoardDensity = 'compact' | 'comfortable';
export type BoardSortWithin = 'newest' | 'oldest' | 'name' | 'updated';

/** Everything a card needs beyond its own lead row. Assembled once
 *  (memoised) by LeadsBoard so it's a STABLE reference — the whole card
 *  tree is memoised against it, so a dnd-kit re-render can't cascade into
 *  the cards (see the perf note on ColumnCards). */
interface LeadCardContext {
  onOpenLead: (contactId: string) => void;
  onEditLead: (lead: Contact) => void;
  onDeleteLead: (lead: Contact) => void;
  canEdit: boolean;
  /** Acting user's role — with currentUserId, drives the per-lead delete
   *  gate (canDeleteLead: admins any, agents only their own human leads). */
  accountRole: AccountRole | null;
  nameById: ReadonlyMap<string, string>;
  avatarById: ReadonlyMap<string, string | null>;
  transfers: Record<string, LeadTransfer>;
  assignmentRequests: Record<string, LeadTransfer>;
  currentUserId?: string;
  sourceLabel: (key: string) => string;
  /** Compact drops company / tags / the source+date footer strip; the
      owner + name + phone always show. */
  density: BoardDensity;
}

interface LeadsBoardProps {
  leads: BoardLead[];
  /** Board columns — the fixed "New" bucket + the account's statuses
   *  (useLeadFieldOptions().statuses). */
  columns: LeadColumn[];
  /** Persist a drag: `status` is already NULL for the "New" column. */
  onStatusChange: (contactId: string, status: LeadStatus | null) => void;
  /** Open the lead's detail slide-over (card click). */
  onOpenLead: (contactId: string) => void;
  /** Card ⋮ menu → the page's edit form / delete confirm. */
  onEditLead: (lead: Contact) => void;
  onDeleteLead: (lead: Contact) => void;
  /** Viewers can look but not drag/edit/delete. */
  canEdit: boolean;
  /** Acting user's role — drives the per-lead delete gate (see ctx). */
  accountRole: AccountRole | null;
  /** Teammate lookups (useAccountStaff) — assignee avatar + pending chips. */
  nameById: ReadonlyMap<string, string>;
  avatarById: ReadonlyMap<string, string | null>;
  /** In-flight ownership transfers / assignment requests, keyed by
      contact_id (migrations 050/052) — same maps the table cells overlay. */
  transfers: Record<string, LeadTransfer>;
  assignmentRequests: Record<string, LeadTransfer>;
  /** Viewer's user id — a transfer aimed at them reads "to you". */
  currentUserId?: string;
  /** Account-aware source label (fieldOptions.sourceLabel). */
  sourceLabel: (key: string) => string;
  /** Board view settings — how much each card shows, and the card order
      within each status column (Tier 1); hide empty columns at rest (Tier 2). */
  density: BoardDensity;
  sortWithin: BoardSortWithin;
  collapseEmpty: boolean;
}

const CARD_TAG_LIMIT = 2;

// Order the cards inside one status column. created_at / updated_at are
// stored ISO, so a string compare is chronological. Newest is the default
// (matches the pre-settings board); oldest surfaces stale leads to the top
// (the action-list use). Name sorts blanks (Unnamed) last, both empty = tie.
function sortColumnLeads(
  list: BoardLead[],
  mode: BoardSortWithin,
): BoardLead[] {
  const arr = [...list];
  switch (mode) {
    case 'oldest':
      arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
      break;
    case 'name':
      arr.sort((a, b) => {
        const an = a.name?.trim() ?? '';
        const bn = b.name?.trim() ?? '';
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn);
      });
      break;
    case 'updated':
      arr.sort((a, b) =>
        (b.updated_at ?? b.created_at).localeCompare(
          a.updated_at ?? a.created_at,
        ),
      );
      break;
    case 'newest':
    default:
      arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return arr;
}

// Compact created-on stamp — "9 Jul", year suffix only when it isn't this
// year. Full date rides the title tooltip. Locale comes from the account
// config (passed in — module fn, no hook access).
function formatCardDate(iso: string, localeTag: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(localeTag, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

/**
 * Footer-right owner slot, in the table's own precedence order:
 * pending assignment approval → pending ownership transfer → pending
 * invite → assignee avatar → unassigned placeholder. Pending states are
 * icon + text + colour (never colour alone), with the full story on title.
 */
function CardOwner({ lead, ctx }: { lead: BoardLead; ctx: LeadCardContext }) {
  const assignmentReq = ctx.assignmentRequests[lead.id];
  if (assignmentReq) {
    const targetName = assignmentReq.to_user_id
      ? ctx.nameById.get(assignmentReq.to_user_id) ?? "Teammate"
      : "Unassign";
    return (
      <Badge
        variant="warning"
        className="shrink-0 gap-0.5"
        title={`Assignment pending the owner's approval → ${targetName}`}
      >
        <ArrowRight className="size-3" />
        {targetName}
      </Badge>
    );
  }

  const transfer = ctx.transfers[lead.id];
  if (transfer) {
    const incoming = transfer.to_user_id === ctx.currentUserId;
    const targetName = transfer.to_user_id
      ? ctx.nameById.get(transfer.to_user_id) ?? "Teammate"
      : "Teammate";
    return (
      <Badge
        variant="warning"
        className="shrink-0 gap-0.5"
        title={
          incoming
            ? "Ownership transfer awaiting your acceptance"
            : `Ownership transfer pending → ${targetName}`
        }
      >
        <ArrowRight className="size-3" />
        {incoming ? "to you" : targetName}
      </Badge>
    );
  }

  // Parked on a not-yet-joined teammate (migration 049) — amber initial,
  // matching PendingAssigneeDisplay's palette.
  if (lead.pending_invitation_id && lead.pending_assignee_name) {
    return (
      <span
        title={`Invite pending — ${lead.pending_assignee_name} hasn't joined yet`}
      >
        <UserAvatar
          name={lead.pending_assignee_name}
          src={null}
          className="size-5 shrink-0 opacity-90"
          fallbackClassName="bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-400"
        />
      </span>
    );
  }

  if (lead.assigned_to) {
    const name = ctx.nameById.get(lead.assigned_to) ?? "Teammate";
    return (
      <span title={`Assigned to ${name}`}>
        <UserAvatar
          name={name}
          src={ctx.avatarById.get(lead.assigned_to)}
          className="size-5 shrink-0"
          fallbackClassName="text-[10px]"
        />
      </span>
    );
  }

  return (
    <span
      title="Unassigned"
      aria-label="Unassigned"
      className="size-5 shrink-0 rounded-full border border-dashed border-muted-foreground/40"
    />
  );
}

/** Card ⋮ — the table row menu, verbatim: View details / Edit / Delete. */
function CardMenu({ lead, ctx }: { lead: BoardLead; ctx: LeadCardContext }) {
  const canDelete = ctx.accountRole
    ? canDeleteLead(ctx.accountRole, {
        createdBy: lead.created_by ?? null,
        userId: ctx.currentUserId ?? null,
        receivedVia: lead.received_via ?? null,
      })
    : false;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Actions for ${lead.name || lead.phone}`}
            // Hidden until card hover, but keyboard focus and an open menu
            // both force it visible — no hover-only affordance. pointer-down
            // is stopped so the drag sensor never eats the click.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100 data-[popup-open]:opacity-100"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border">
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            ctx.onOpenLead(lead.id);
          }}
          className="text-popover-foreground focus:bg-muted focus:text-foreground"
        >
          <Eye className="size-4" />
          View details
        </DropdownMenuItem>
        {ctx.canEdit && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              ctx.onEditLead(lead);
            }}
            className="text-popover-foreground focus:bg-muted focus:text-foreground"
          >
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                ctx.onDeleteLead(lead);
              }}
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One kanban card's VISUAL body — pure presentation, memoised. Information
 * scent mirrors the table row, compressed: name → contact/company meta →
 * tags → a hairline footer with the origin (source glyph + created date)
 * on the left and the OWNER on the right (assignee avatar, or an amber
 * pending chip when a transfer / assignment approval / invite is in flight
 * — the same states the table cells overlay, so a lead mid-handoff can't
 * look "normal" here).
 *
 * `contain: layout` (the `[contain:layout]` util) is the reason the drag +
 * drop FLIP stays smooth with this rich body. Motion's FLIP flushes layout
 * once per move to measure every card; layout containment makes each card
 * an isolated layout subtree, so that flush skips the ~30 unchanged nodes
 * inside every card (avatar, source SVG, badges, dropdown root) and only
 * re-lays-out the column's card boxes — i.e. it costs what a bare
 * title+phone card cost before this redesign.
 *
 * memo() keeps the body render itself off the drag path (see ColumnCards).
 * The card is a clickable div, NOT a button — it contains real buttons
 * (name = the keyboard/AT open affordance, ⋮ = the actions menu), and
 * nesting those inside a button is invalid HTML.
 */
const LeadCard = memo(function LeadCard({
  lead,
  ctx,
  isOverlay = false,
}: {
  lead: BoardLead;
  ctx: LeadCardContext;
  isOverlay?: boolean;
}) {
  // AuthContext changes only on account load/save, so this subscription
  // doesn't disturb the board's drag-perf memoization.
  const { locale, fmt } = useLocale();
  const tags = lead.tags ?? [];
  const overflowTags = tags.length - CARD_TAG_LIMIT;

  return (
    <div
      onClick={() => ctx.onOpenLead(lead.id)}
      className={cn(
        "group/card w-full cursor-pointer rounded-lg border border-border bg-card p-3 text-left transition-colors [contain:layout] hover:border-primary/40 hover:bg-muted/60",
        isOverlay && "shadow-lg",
      )}
    >
      {/* Header — name + hover-reveal actions menu. The name is the real
          <button> (keyboard/AT path to the detail sheet); the wrapping div's
          onClick is the pointer convenience. */}
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            ctx.onOpenLead(lead.id);
          }}
          className="min-w-0 truncate text-left text-sm font-medium text-foreground hover:underline"
        >
          {lead.name || (
            <span className="italic text-muted-foreground">Unnamed</span>
          )}
        </button>
        {!isOverlay && <CardMenu lead={lead} ctx={ctx} />}
      </div>

      <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
        <Phone className="size-3 shrink-0" />
        <span className="truncate">{lead.phone}</span>
      </p>

      {/* Comfortable-only detail: company, tags, and the source+date footer
          strip. Compact keeps just name / phone / owner for a dense scan. */}
      {ctx.density === "comfortable" && lead.company && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="size-3 shrink-0" />
          <span className="truncate">{lead.company}</span>
        </p>
      )}

      {ctx.density === "comfortable" && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {tags.slice(0, CARD_TAG_LIMIT).map((tag) => (
            <Badge key={tag.id} variant="neutral">
              {tag.name}
            </Badge>
          ))}
          {overflowTags > 0 && (
            <span
              className="text-[10px] text-muted-foreground"
              title={tags
                .slice(CARD_TAG_LIMIT)
                .map((t) => t.name)
                .join(", ")}
            >
              +{overflowTags}
            </span>
          )}
        </div>
      )}

      {ctx.density === "comfortable" ? (
        // Footer — origin (source glyph + created date) vs owner. Hairline
        // top border groups it apart from the identity block above.
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {lead.source && (
              <SourceIcon
                source={lead.source}
                label={ctx.sourceLabel(lead.source)}
                className="size-3.5"
              />
            )}
            <span
              className="text-[11px] text-muted-foreground"
              title={`Created ${fmt.date(lead.created_at)}`}
            >
              {formatCardDate(lead.created_at, locale.locale)}
            </span>
          </span>
          <CardOwner lead={lead} ctx={ctx} />
        </div>
      ) : (
        // Compact — owner only, no border/meta strip.
        <div className="mt-2 flex justify-end">
          <CardOwner lead={lead} ctx={ctx} />
        </div>
      )}
    </div>
  );
});

/**
 * The dnd-kit draggable. This is the ONLY node in the card tree that
 * subscribes to the drag context, so it's the only one that re-renders on
 * every pointer/column change — deliberately kept featherweight (a bare
 * wrapper div; the heavy `LeadCard` body is memoised and skipped). The
 * `motion.div` that owns layout projection is its PARENT (rendered by the
 * memoised ColumnCards, which doesn't re-render mid-drag), so these
 * re-renders never touch the projection node. The whole wrapper is the
 * drag handle; `touch-none` stops a touch-drag from scrolling the column;
 * `isDragging` dims the source while the DragOverlay carries the lifted copy.
 */
function DraggableLeadCard({
  lead,
  ctx,
}: {
  lead: BoardLead;
  ctx: LeadCardContext;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: !ctx.canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn("touch-none transition-opacity", isDragging && "opacity-30")}
    >
      <LeadCard lead={lead} ctx={ctx} />
    </div>
  );
}

/**
 * The animated card list for one column. memo()'d against `leads` + `ctx`,
 * both stable references while a drag is in flight (LeadsBoard doesn't
 * re-render on pointer-move / column-over changes). So when dnd-kit
 * re-renders a StatusColumn for its `isOver` outline, THIS subtree — every
 * `motion.div` with layout projection — is skipped, and no card is
 * re-measured mid-drag. Only the leaf DraggableLeadCards (which subscribe to
 * the drag context directly) re-render, and those are cheap.
 *
 * `layout="position"` (not full `layout`): cards never change size on the
 * board, only position, so we skip Motion's size-interpolation + scale
 * correction. `layoutId` bridges a card across columns for the fly-to-new-
 * home FLIP. The drop's one-shot layout flush stays cheap because each
 * LeadCard is `contain: layout` (see LeadCard).
 */
const ColumnCards = memo(function ColumnCards({
  leads,
  ctx,
}: {
  leads: BoardLead[];
  ctx: LeadCardContext;
}) {
  return (
    // popLayout pulls an exiting card out of flow immediately so the
    // remaining cards slide up to close the gap while it animates out.
    <AnimatePresence mode="popLayout" initial={false}>
      {leads.map((lead) => (
        <motion.div
          key={lead.id}
          layout="position"
          layoutId={lead.id}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 550, damping: 38, mass: 0.7 }}
        >
          <DraggableLeadCard lead={lead} ctx={ctx} />
        </motion.div>
      ))}
    </AnimatePresence>
  );
});

function StatusColumn({
  column,
  leads,
  ctx,
}: {
  column: LeadColumn;
  leads: BoardLead[];
  ctx: LeadCardContext;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // On lg+ the five columns share the row.
    <div className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[240px] lg:shrink lg:snap-none">
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: column.color }}
      />
      <div className="flex items-center justify-between pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {column.label}
        </h3>
        <Badge variant="neutral" className="shrink-0">
          {leads.length}
        </Badge>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          // Transition only the drop-affordance colours — NOT `transition-all`,
          // which would watch layout properties too and can thrash as cards
          // enter/leave the column on every drop.
          "mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg transition-[background-color,outline-color] duration-150",
          isOver &&
            "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2",
        )}
      >
        {leads.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {ctx.canEdit ? "Drop a lead here" : "No leads"}
          </div>
        ) : (
          <ColumnCards leads={leads} ctx={ctx} />
        )}
      </div>
    </div>
  );
}

// Kanban view of the Leads list. Columns are the account's lead
// statuses (per-account editable, migration 042) — dragging a card
// between columns rewrites contacts.lead_status. Leads holding a key
// that's no longer in the account list (legacy imports) get their own
// muted trailing column instead of silently vanishing.
// Layout/scroll behaviour mirrors the old pipeline board.
export function LeadsBoard({
  leads,
  columns,
  onStatusChange,
  onOpenLead,
  onEditLead,
  onDeleteLead,
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
}: LeadsBoardProps) {
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);

  const { allColumns, leadsByColumn } = useMemo(() => {
    const map = new Map<LeadColumnKey, BoardLead[]>();
    for (const col of columns) map.set(col.key, []);
    const extras: LeadColumn[] = [];
    for (const lead of leads) {
      const key = leadColumnKey(lead.lead_status);
      if (!map.has(key)) {
        extras.push({
          key,
          label: humaniseKey(key),
          color: UNKNOWN_STATUS_COLOR,
        });
        map.set(key, []);
      }
      map.get(key)!.push(lead);
    }
    // Order each column by the chosen sort. Reordering animates for free —
    // the cards' layoutId FLIP flies them to their new slots.
    for (const key of map.keys()) {
      map.set(key, sortColumnLeads(map.get(key)!, sortWithin));
    }
    return { allColumns: [...columns, ...extras], leadsByColumn: map };
  }, [leads, columns, sortWithin]);

  // Collapse-empty (Tier 2): hide 0-count columns at REST, but reveal every
  // column mid-drag so an empty stage stays a valid drop target — pick a card
  // up (activeLeadId set) and all columns reappear; drop and empties
  // re-collapse. handleDragEnd still validates the target against allColumns.
  const displayColumns = useMemo(() => {
    if (!collapseEmpty || activeLeadId) return allColumns;
    return allColumns.filter(
      (c) => (leadsByColumn.get(c.key)?.length ?? 0) > 0,
    );
  }, [allColumns, leadsByColumn, collapseEmpty, activeLeadId]);

  // Card render context — memoised into ONE stable reference so the
  // memoised card tree (LeadCard / ColumnCards) actually skips re-renders
  // during a drag. Rebuilding this inline every render would hand every
  // card a fresh `ctx` prop and defeat the memo.
  const cardCtx = useMemo<LeadCardContext>(
    () => ({
      onOpenLead,
      onEditLead,
      onDeleteLead,
      canEdit,
      accountRole,
      nameById,
      avatarById,
      transfers,
      assignmentRequests,
      currentUserId,
      sourceLabel,
      density,
    }),
    [
      onOpenLead,
      onEditLead,
      onDeleteLead,
      canEdit,
      accountRole,
      nameById,
      avatarById,
      transfers,
      assignmentRequests,
      currentUserId,
      sourceLabel,
      density,
    ],
  );

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor),
  );

  const activeLead = activeLeadId
    ? leads.find((l) => l.id === activeLeadId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveLeadId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveLeadId(null);
    const { active, over } = event;
    if (!over) return;
    const leadId = String(active.id);
    const targetKey = String(over.id) as LeadColumnKey;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    if (!allColumns.some((c) => c.key === targetKey)) return;
    if (leadColumnKey(lead.lead_status) === targetKey) return;

    onStatusChange(leadId, columnToStatus(targetKey));
  }

  function handleDragCancel() {
    setActiveLeadId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* snap-x + snap-mandatory on mobile so swipes land the next
          column cleanly at the viewport edge instead of mid-column.
          Disabled on lg+ where snapping would interfere with the
          natural layout. */}
      {/* LayoutGroup shares layoutId across columns so a card dragged from
          one status to another *flies* to its new home instead of teleporting. */}
      <LayoutGroup>
        <div className="leads-scroll flex h-full snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
          {displayColumns.map((col) => (
            <StatusColumn
              key={col.key}
              column={col}
              leads={leadsByColumn.get(col.key) ?? []}
              ctx={cardCtx}
            />
          ))}
        </div>
      </LayoutGroup>

      {/* dropAnimation disabled: Motion's layoutId FLIP owns the settle, so the
          real card flies to its new column. A dnd-kit drop tween here would
          double-animate against it. The FLIP stays cheap because each card is
          `contain: layout` (see LeadCard) — the drop's layout flush skips card
          internals. */}
      <DragOverlay dropAnimation={null}>
        {activeLead ? (
          <div className="opacity-90">
            <LeadCard lead={activeLead} ctx={cardCtx} isOverlay />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .leads-scroll {
          scroll-behavior: smooth;
        }
        /* Hide the scrollbar on touch (peek/snap already signals more
           content); keep a thin themed one on desktop where overflow
           has no other hint. Same treatment the pipeline board used. */
        @media (hover: none), (pointer: coarse) {
          .leads-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .leads-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .leads-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .leads-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .leads-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .leads-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .leads-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}
