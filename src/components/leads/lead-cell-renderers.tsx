'use client';

// Shared lead cell renderers + editor option builders, consumed by BOTH
// the Leads table (`/leads/page.tsx`) and the import wizard's preview
// grid — extracted so the import preview is pixel-identical to the table
// (the whole point of the Preview step) and a restyle lands in both.

import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/user-avatar';
import { SourceIcon } from '@/components/leads/source-icon';
import type { CellOption } from '@/components/leads/editable-cell';
import type { LeadColumn } from '@/lib/leads/status';
import type { LeadFieldOption } from '@/lib/leads/field-options';
import type { StaffRef } from '@/lib/leads/import-coerce';

/** The status pill — `statusFor(key)` in, coloured Badge out. */
export function StatusBadge({ column }: { column: LeadColumn }) {
  return <Badge color={column.color}>{column.label}</Badge>;
}

/** Avatar + name chip for assignee / received-by cells. */
export function AssigneeDisplay({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <UserAvatar
        name={name}
        src={avatarUrl ?? null}
        className="size-5 shrink-0"
        fallbackClassName="text-[10px]"
      />
      <span className="text-foreground truncate text-sm">{name}</span>
    </span>
  );
}

/**
 * A lead parked on a not-yet-joined teammate (a pending invite). Amber to
 * signal "not a real owner yet" — the person activates via their invite
 * link, at which point the lead flips to a normal assignment. Used on the
 * import preview grid and the /leads assignee column.
 */
export function PendingAssigneeDisplay({ name }: { name: string }) {
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-amber-700 dark:text-amber-400"
      title={`Invite pending — ${name} hasn't joined yet`}
    >
      <UserAvatar
        name={name}
        src={null}
        className="size-5 shrink-0 opacity-90"
        fallbackClassName="bg-amber-500/15 text-amber-700 text-[10px] dark:text-amber-400"
      />
      <span className="min-w-0 truncate text-sm">
        <span className="truncate">{name}</span>
        <span className="text-[10px] font-medium opacity-80"> · pending</span>
      </span>
    </span>
  );
}

/**
 * A lead with a pending ownership transfer (migration 050). Shows the
 * CURRENT owner (ownership hasn't moved yet) plus a warning chip pointing
 * at the proposed new owner. `incoming` = the request is waiting on the
 * viewer, so the chip reads "to you" to cue the Accept/Decline action.
 */
export function TransferPendingDisplay({
  ownerName,
  ownerAvatarUrl,
  targetName,
  incoming = false,
}: {
  ownerName?: string | null;
  ownerAvatarUrl?: string | null;
  targetName: string;
  incoming?: boolean;
}) {
  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      title={
        incoming
          ? `Transfer awaiting your acceptance`
          : `Transfer pending → ${targetName}`
      }
    >
      <UserAvatar
        name={ownerName ?? 'Unassigned'}
        src={ownerAvatarUrl ?? null}
        className="size-5 shrink-0 opacity-80"
        fallbackClassName="text-[10px]"
      />
      <span className="text-muted-foreground min-w-0 truncate text-sm">
        {ownerName ?? 'Unassigned'}
      </span>
      <Badge variant="warning" className="shrink-0 gap-0.5">
        <ArrowRight className="size-3" />
        {incoming ? 'to you' : targetName}
      </Badge>
    </span>
  );
}

// ---- EditableCell option builders -----------------------------------------
// One place decides how the dropdown editors present their choices, so
// the table's inline editors and the import preview grid can't drift.

/** Status options as coloured pills ('new' bucket included by caller). */
export function statusCellOptions(statuses: LeadColumn[]): CellOption[] {
  return statuses.map((c) => ({ value: c.key, label: c.label, color: c.color }));
}

/** Source options with their brand glyph (dropdown shows logo + name). */
export function sourceCellOptions(sources: LeadFieldOption[]): CellOption[] {
  return sources.map((o) => ({
    value: o.key,
    label: o.label,
    icon: <SourceIcon source={o.key} label={o.label} />,
  }));
}

export function genderCellOptions(genders: LeadFieldOption[]): CellOption[] {
  return genders.map((o) => ({ value: o.key, label: o.label }));
}

/** Staff roster with a leading "Unassigned" ('' sentinel). */
export function assigneeCellOptions(staff: StaffRef[]): CellOption[] {
  return [
    { value: '', label: 'Unassigned' },
    ...staff.map((s) => ({ value: s.user_id, label: s.full_name })),
  ];
}

/** Map a custom field's data type to the inline editor's input kind. */
export function customEditKind(
  type?: string,
): 'text' | 'email' | 'number' | 'date' {
  switch (type) {
    case 'currency':
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'email':
      return 'email';
    default:
      return 'text'; // text, phone, url
  }
}
