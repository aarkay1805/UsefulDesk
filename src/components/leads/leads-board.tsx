"use client";

import { useMemo, useState } from "react";
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
import type { Contact, LeadStatus } from "@/types";
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
import { Building2, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface LeadsBoardProps {
  leads: Contact[];
  /** Board columns — the fixed "New" bucket + the account's statuses
   *  (useLeadFieldOptions().statuses). */
  columns: LeadColumn[];
  /** Persist a drag: `status` is already NULL for the "New" column. */
  onStatusChange: (contactId: string, status: LeadStatus | null) => void;
  /** Open the lead's detail slide-over (card click). */
  onOpenLead: (contactId: string) => void;
  /** Viewers can look but not drag. */
  canEdit: boolean;
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
  canEdit,
}: LeadsBoardProps) {
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);

  const { allColumns, leadsByColumn } = useMemo(() => {
    const map = new Map<LeadColumnKey, Contact[]>();
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
    return { allColumns: [...columns, ...extras], leadsByColumn: map };
  }, [leads, columns]);

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
      <div className="leads-scroll flex h-full snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
        {allColumns.map((col) => (
          <StatusColumn
            key={col.key}
            column={col}
            leads={leadsByColumn.get(col.key) ?? []}
            canEdit={canEdit}
            onOpenLead={onOpenLead}
          />
        ))}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeLead ? (
          <div className="opacity-90">
            <LeadCard lead={activeLead} onOpen={() => {}} isOverlay />
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

function StatusColumn({
  column,
  leads,
  canEdit,
  onOpenLead,
}: {
  column: LeadColumn;
  leads: Contact[];
  canEdit: boolean;
  onOpenLead: (contactId: string) => void;
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
        className={`mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {leads.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {canEdit ? "Drop a lead here" : "No leads"}
          </div>
        ) : (
          leads.map((lead) => (
            <DraggableLeadCard
              key={lead.id}
              lead={lead}
              canEdit={canEdit}
              onOpen={onOpenLead}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableLeadCard({
  lead,
  canEdit,
  onOpen,
}: {
  lead: Contact;
  canEdit: boolean;
  onOpen: (contactId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <LeadCard lead={lead} onOpen={onOpen} />
    </div>
  );
}

function LeadCard({
  lead,
  onOpen,
  isOverlay = false,
}: {
  lead: Contact;
  onOpen: (contactId: string) => void;
  isOverlay?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(lead.id)}
      className={`w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/60 ${
        isOverlay ? "shadow-lg" : ""
      }`}
    >
      <p className="truncate text-sm font-medium text-foreground">
        {lead.name || <span className="italic text-muted-foreground">Unnamed</span>}
      </p>
      <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
        <Phone className="size-3 shrink-0" />
        <span className="truncate">{lead.phone}</span>
      </p>
      {lead.company && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="size-3 shrink-0" />
          <span className="truncate">{lead.company}</span>
        </p>
      )}
    </button>
  );
}
