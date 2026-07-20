'use client';

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import type { LeadColumn } from '@/lib/leads/status';
import type { LeadFieldOption } from '@/lib/leads/field-options';
import type { StaffMember } from '@/components/members/use-account-staff';
import type { Tag } from '@/types';
import { Filter } from 'lucide-react';

// Create-date presets. '' = any time. Resolved to an ISO lower bound in
// the page's fetch (IST-agnostic — a coarse "since" boundary is enough).
export type CreatedRange = '' | 'today' | '7d' | '30d' | 'month';

const CREATED_RANGE_OPTIONS: { value: CreatedRange; label: string }[] = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
];

// Sentinel for the "Unassigned" bucket in the Assigned-to filter.
export const UNASSIGNED = '__unassigned__';

// Prefix marking a pending-invite option in the Assigned-to filter
// (value = `pending:${invitationId}`) — filters on pending_invitation_id
// rather than assigned_to. See migration 049.
export const PENDING_FILTER_PREFIX = 'pending:';

export interface LeadFilters {
  owner: string[]; // contacts.user_id (creator / current owner)
  assigned: string[]; // contacts.assigned_to (UNASSIGNED = null)
  createdBy: string[]; // contacts.created_by (original creator, migration 051)
  leadStatus: string[]; // LeadColumnKey incl. 'new' (= null)
  source: string[];
  tags: string[]; // tag ids
  gender: string[];
  createdRange: CreatedRange;
  // Custom-field value filters (text/number-type fields): custom_field_id →
  // selected raw values. Resolved to contact ids before the query, like tags.
  // Set from the column header menu, not this panel.
  customValues: Record<string, string[]>;
}

export const EMPTY_FILTERS: LeadFilters = {
  owner: [],
  assigned: [],
  createdBy: [],
  leadStatus: [],
  source: [],
  tags: [],
  gender: [],
  createdRange: '',
  customValues: {},
};

/** Number of active filter groups — drives the button badge. */
export function activeFilterCount(f: LeadFilters): number {
  return (
    (f.owner.length ? 1 : 0) +
    (f.assigned.length ? 1 : 0) +
    (f.createdBy.length ? 1 : 0) +
    (f.leadStatus.length ? 1 : 0) +
    (f.source.length ? 1 : 0) +
    (f.tags.length ? 1 : 0) +
    (f.gender.length ? 1 : 0) +
    (f.createdRange ? 1 : 0) +
    Object.values(f.customValues).filter((v) => v.length).length
  );
}

interface LeadsFiltersProps {
  value: LeadFilters;
  onChange: (next: LeadFilters) => void;
  staff: StaffMember[];
  tags: Tag[];
  /** Account status columns (incl. 'new') — useLeadFieldOptions().statuses. */
  statuses: LeadColumn[];
  sources: LeadFieldOption[];
  genders: LeadFieldOption[];
  /** Pending-invite owners in use, offered under "Assigned to" (migration 049). */
  pendingInvites?: { id: string; name: string }[];
}

export function LeadsFilters({
  value,
  onChange,
  staff,
  tags,
  statuses,
  sources,
  genders,
  pendingInvites = [],
}: LeadsFiltersProps) {
  const count = activeFilterCount(value);

  function toggle(
    key: keyof Omit<LeadFilters, 'createdRange' | 'customValues'>,
    v: string
  ) {
    const cur = value[key];
    const next = cur.includes(v)
      ? cur.filter((x) => x !== v)
      : [...cur, v];
    onChange({ ...value, [key]: next });
  }

  const staffOptions = staff.map((s) => ({ value: s.user_id, label: s.full_name }));
  const pendingOptions = pendingInvites.map((p) => ({
    value: `${PENDING_FILTER_PREFIX}${p.id}`,
    label: `${p.name} · pending`,
  }));

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="pill" aria-pressed={count > 0} />}
      >
        <Filter className="size-4" />
        Filters
        {count > 0 && (
          <span className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold text-popover-foreground">
            Filters
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-3 py-3">
          <RadioGroup
            label="Create date"
            options={CREATED_RANGE_OPTIONS}
            value={value.createdRange}
            onChange={(v) => onChange({ ...value, createdRange: v as CreatedRange })}
          />

          <Divider />
          <CheckGroup
            label="Lead status"
            options={statuses.map((c) => ({ value: c.key, label: c.label }))}
            selected={value.leadStatus}
            onToggle={(v) => toggle('leadStatus', v)}
          />

          <Divider />
          <CheckGroup
            label="Source"
            options={sources.map((o) => ({ value: o.key, label: o.label }))}
            selected={value.source}
            onToggle={(v) => toggle('source', v)}
          />

          <Divider />
          <CheckGroup
            label="Tags"
            options={tags.map((t) => ({ value: t.id, label: t.name }))}
            selected={value.tags}
            onToggle={(v) => toggle('tags', v)}
            emptyHint="No tags yet."
          />

          <Divider />
          <CheckGroup
            label="Gender"
            options={genders.map((o) => ({ value: o.key, label: o.label }))}
            selected={value.gender}
            onToggle={(v) => toggle('gender', v)}
          />

          <Divider />
          <CheckGroup
            label="Contact owner"
            options={staffOptions}
            selected={value.owner}
            onToggle={(v) => toggle('owner', v)}
            emptyHint="No teammates."
          />

          <Divider />
          <CheckGroup
            label="Assigned to"
            options={[
              { value: UNASSIGNED, label: 'Unassigned' },
              ...staffOptions,
              ...pendingOptions,
            ]}
            selected={value.assigned}
            onToggle={(v) => toggle('assigned', v)}
          />

          <Divider />
          <CheckGroup
            label="Created by"
            options={staffOptions}
            selected={value.createdBy}
            onToggle={(v) => toggle('createdBy', v)}
            emptyHint="No teammates."
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Divider() {
  return <Separator className="my-3" />;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function CheckGroup({
  label,
  options,
  selected,
  onToggle,
  emptyHint,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  emptyHint?: string;
}) {
  return (
    <div>
      <GroupLabel>{label}</GroupLabel>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint ?? 'None.'}</p>
      ) : (
        <div className="max-h-40 space-y-0.5 overflow-y-auto">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 hover:bg-muted/60"
            >
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={() => onToggle(o.value)}
                aria-label={`Filter by ${o.label}`}
              />
              <span className="truncate text-sm text-popover-foreground">
                {o.label}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function RadioGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <GroupLabel>{label}</GroupLabel>
      <div className="space-y-0.5">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-left hover:bg-muted/60"
            >
              <span
                className={
                  'flex size-4 shrink-0 items-center justify-center rounded-full border ' +
                  (active ? 'border-primary' : 'border-border')
                }
              >
                {active && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="truncate text-sm text-popover-foreground">
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
