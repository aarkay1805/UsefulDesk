'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export interface ManageColumn {
  key: string;
  label: string;
  required?: boolean;
}

interface ManageColumnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All manageable columns, in their current effective order. */
  columns: ManageColumn[];
  /** Keys currently hidden. */
  hidden: string[];
  onSave: (order: string[], hidden: string[]) => void;
}

export function ManageColumnsDialog({
  open,
  onOpenChange,
  columns,
  hidden,
  onSave,
}: ManageColumnsDialogProps) {
  // Draft state — edits stay local until Save, so Cancel discards them.
  const [order, setOrder] = useState<string[]>([]);
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const metaByKey = useMemo(() => {
    const map: Record<string, ManageColumn> = {};
    columns.forEach((c) => (map[c.key] = c));
    return map;
  }, [columns]);

  // Re-seed the draft each time the dialog opens.
  useEffect(() => {
    if (open) {
      setOrder(columns.map((c) => c.key));
      setHiddenSet(new Set(hidden));
      setQuery('');
    }
    // Only re-seed on open — columns/hidden are snapshots at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sensors = useSensors(useSensor(PointerSensor));

  const term = query.trim().toLowerCase();
  const searching = term.length > 0;
  const visibleKeys = searching
    ? order.filter((k) => metaByKey[k]?.label.toLowerCase().includes(term))
    : order;

  function toggle(key: string) {
    const col = metaByKey[key];
    if (col?.required) return; // required columns can't be hidden
    setHiddenSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const from = prev.indexOf(active.id as string);
      const to = prev.indexOf(over.id as string);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function handleSave() {
    onSave(order, [...hiddenSet]);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Columns</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="bg-card pl-8"
          />
        </div>

        <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
          {visibleKeys.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No columns found.
            </p>
          ) : searching ? (
            // Reorder is disabled while filtering — render a plain list.
            <ul className="flex flex-col">
              {visibleKeys.map((key) => (
                <ColumnRow
                  key={key}
                  column={metaByKey[key]}
                  checked={!hiddenSet.has(key)}
                  onToggle={() => toggle(key)}
                  draggable={false}
                />
              ))}
            </ul>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={order}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col">
                  {order.map((key) => (
                    <SortableColumnRow
                      key={key}
                      column={metaByKey[key]}
                      checked={!hiddenSet.has(key)}
                      onToggle={() => toggle(key)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ColumnRowProps {
  column?: ManageColumn;
  checked: boolean;
  onToggle: () => void;
  draggable: boolean;
  dragHandle?: React.ReactNode;
  style?: React.CSSProperties;
  setNodeRef?: (node: HTMLElement | null) => void;
  dragging?: boolean;
}

function ColumnRow({
  column,
  checked,
  onToggle,
  draggable,
  dragHandle,
  style,
  setNodeRef,
  dragging,
}: ColumnRowProps) {
  if (!column) return null;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md py-1.5 pr-2',
        dragging && 'bg-muted shadow-sm'
      )}
    >
      {draggable ? (
        dragHandle
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-sm">
        <Checkbox
          checked={checked}
          disabled={column.required}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${column.label} column`}
        />
        <span className="text-foreground">
          {column.label}
          {column.required && <span className="text-destructive"> *</span>}
        </span>
      </label>
    </li>
  );
}

function SortableColumnRow({
  column,
  checked,
  onToggle,
}: {
  column?: ManageColumn;
  checked: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: column?.key ?? '' });

  return (
    <ColumnRow
      column={column}
      checked={checked}
      onToggle={onToggle}
      draggable
      dragging={isDragging}
      setNodeRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      dragHandle={
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      }
    />
  );
}
