'use client';

// Step 3 of the Leads import wizard: an editable preview that renders
// through the SAME cell renderers/editors as the /leads table, so what
// the owner approves is exactly what lands. Includes the docked
// "Fix values" panel — HubSpot-style value-level remapping: each
// unmatched status/source/gender value is fixed ONCE (with a row count)
// and the fix applies to every row carrying it. All edits mutate the
// in-memory PreviewRow[] only; nothing is written until Confirm.

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  UserPlus,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapse } from '@/components/ui/collapse';
import { MotionList, MotionListItem } from '@/components/ui/motion-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EditableCell, type CellOption } from '@/components/leads/editable-cell';
import {
  AssigneeDisplay,
  PendingAssigneeDisplay,
  StatusBadge,
  assigneeCellOptions,
  customEditKind,
  genderCellOptions,
  sourceCellOptions,
  statusCellOptions,
} from '@/components/leads/lead-cell-renderers';
import { SourceIcon } from '@/components/leads/source-icon';
import {
  applyValueFix,
  coerceAssignee,
  fuzzyMatchOption,
  unmatchedValues,
  PENDING_ASSIGNEE_PREFIX,
  type FixableField,
  type PreviewRow,
  type StaffRef,
  type UnmatchedValue,
} from '@/lib/leads/import-coerce';
import type { CustomFieldRef } from '@/lib/contacts/field-mapping';
import { coerceCustomValue } from '@/lib/contacts/field-mapping';
import type { LeadColumn } from '@/lib/leads/status';
import type { LeadFieldOption } from '@/lib/leads/field-options';
import { formatCustomFieldValue } from '@/lib/contacts/custom-fields';
import { currencySymbol } from '@/lib/currency';
import { cn } from '@/lib/utils';

/** Rows rendered in the grid — every row is still processed at import. */
const PREVIEW_CAP = 200;

export interface FieldOptionSets {
  /** Status board columns — fixed 'new' first (useLeadFieldOptions().statuses). */
  statuses: LeadColumn[];
  sources: LeadFieldOption[];
  genders: LeadFieldOption[];
  statusFor: (key: string | null | undefined) => LeadColumn;
  sourceLabel: (value: string | null | undefined) => string;
  genderLabel: (value: string | null | undefined) => string;
}

interface ImportPreviewGridProps {
  rows: PreviewRow[];
  onRowsChange: (rows: PreviewRow[]) => void;
  /** Called once per value-level fix, for the Confirm receipt's audit. */
  onRemapLogged: (fix: { field: FixableField; raw: string; key: string; count: number }) => void;
  /** Mapped target keys — decides which columns the grid shows. */
  mappedKeys: Set<string>;
  customFields: CustomFieldRef[];
  fieldOptions: FieldOptionSets;
  staff: StaffRef[];
  nameById: Map<string, string>;
  avatarById: Map<string, string | null>;
  /** Existing not-yet-redeemed invites, offered as assignee targets so a
   *  repeat import reuses "Rahul" instead of minting a duplicate. */
  pendingInvites: PendingInvite[];
  /** Admin only — gate the "Create teammate" action. */
  canCreateTeammate: boolean;
  /** Create (or reuse) a pending invite for `name`; returns it, or null on
   *  failure. Owned by the wizard (holds the API call). */
  onCreateTeammate: (name: string) => Promise<PendingInvite | null>;
  defaultCurrency?: string;
  dateOrder: 'DMY' | 'MDY';
  skippedNoPhone: number;
  skippedDupes: number;
}

/** A not-yet-redeemed teammate invite, as an assignee target. */
export interface PendingInvite {
  id: string;
  name: string;
}

interface GridColumn {
  key: string;
  label: string;
  render: (row: PreviewRow, index: number) => React.ReactNode;
  edit?: {
    kind: 'text' | 'email' | 'number' | 'date' | 'status' | 'select';
    options?: CellOption[];
    value: (row: PreviewRow) => string;
    commit: (row: PreviewRow, value: string) => PreviewRow;
    prefix?: string;
  };
}

/** Clear a field's unmatched flag when the user picks a value in-cell.
 *  Picking a real assignee also drops any pending-invite overlay. */
function resolveField(
  row: PreviewRow,
  field: 'status' | 'source' | 'gender' | 'assignee',
  patch: Partial<PreviewRow>,
): PreviewRow {
  const flags = new Set(row.unmatched);
  flags.delete(field);
  const clearPending =
    field === 'assignee'
      ? { pendingInvitationId: null, pendingAssigneeName: null }
      : {};
  return { ...row, ...clearPending, ...patch, unmatched: flags };
}

const UNMATCHED_CHIP_CLASS =
  'inline-flex max-w-full items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs text-amber-700 dark:text-amber-400';

/** The amber "unmatched value" cell. With `onClick` it's an inline editor
 *  trigger (assignee); without, a static flag — the Fix-values panel
 *  (always docked when anything is unmatched) is the resolution surface. */
function UnmatchedChip({ raw, onClick }: { raw: string; onClick?: () => void }) {
  const body = (
    <>
      <AlertTriangle className="size-3 shrink-0" />
      <span className="truncate">{raw || '(empty)'}</span>
    </>
  );
  if (!onClick) {
    return (
      <span
        title="Doesn't match your options — fix it in the panel on the right"
        className={UNMATCHED_CHIP_CLASS}
      >
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Doesn't match — click to pick a value"
      className={cn(UNMATCHED_CHIP_CLASS, 'underline decoration-dashed underline-offset-2')}
    >
      {body}
    </button>
  );
}

export function ImportPreviewGrid({
  rows,
  onRowsChange,
  onRemapLogged,
  mappedKeys,
  customFields,
  fieldOptions,
  staff,
  nameById,
  avatarById,
  pendingInvites,
  canCreateTeammate,
  onCreateTeammate,
  defaultCurrency,
  dateOrder,
  skippedNoPhone,
  skippedDupes,
}: ImportPreviewGridProps) {
  const [editingCell, setEditingCell] = useState<{
    row: number;
    key: string;
  } | null>(null);

  const unmatched = useMemo(() => unmatchedValues(rows), [rows]);
  const unmatchedRowCount = unmatched.reduce((n, v) => n + v.count, 0);
  // The panel is docked (open, non-dismissible) whenever anything needs
  // fixing — no toggle, no "N values to fix" button to click through.
  const showPanel = unmatched.length > 0;
  const newCount = rows.filter((r) => !r.exists).length;
  const updateCount = rows.length - newCount;
  const skipped = skippedNoPhone + skippedDupes;

  function patchRow(index: number, next: PreviewRow) {
    const copy = [...rows];
    copy[index] = next;
    onRowsChange(copy);
  }

  function fixValue(field: FixableField, raw: string, key: string, count: number) {
    onRowsChange(applyValueFix(rows, field, raw, key));
    onRemapLogged({ field, raw, key, count });
  }

  function autoMatch() {
    // Best-effort pass over the still-unmatched values; applied one by
    // one so each lands in the remap log with its count. Assignee uses the
    // staff-name matcher; option fields use the fuzzy label matcher.
    let current = rows;
    for (const v of unmatched) {
      let hit: string | null = null;
      if (v.field === 'assignee') {
        hit = coerceAssignee(v.raw, staff);
      } else {
        const options =
          v.field === 'status'
            ? fieldOptions.statuses
            : v.field === 'source'
              ? fieldOptions.sources
              : fieldOptions.genders;
        hit = fuzzyMatchOption(v.raw, options);
      }
      if (!hit) continue;
      current = applyValueFix(current, v.field, v.raw, hit);
      onRemapLogged({ field: v.field, raw: v.raw, key: hit, count: v.count });
    }
    if (current !== rows) onRowsChange(current);
  }

  const columns = useMemo<GridColumn[]>(() => {
    const cols: GridColumn[] = [
      {
        key: 'name',
        label: 'Name',
        render: (r) =>
          r.base.name ? (
            <span className="text-foreground font-medium">{r.base.name}</span>
          ) : (
            <span className="text-muted-foreground italic">Unnamed</span>
          ),
        edit: {
          kind: 'text',
          value: (r) => r.base.name ?? '',
          commit: (r, v) => ({
            ...r,
            base: { ...r.base, name: v.trim() || undefined },
          }),
        },
      },
      {
        key: 'phone',
        label: 'Phone',
        render: (r) => (
          <span className="text-muted-foreground font-mono text-sm">
            {r.base.phone}
          </span>
        ),
        edit: {
          kind: 'text',
          value: (r) => r.base.phone,
          // Phone stays the identity key — an emptied cell keeps the old
          // value rather than producing an unimportable row.
          commit: (r, v) =>
            v.trim() ? { ...r, base: { ...r.base, phone: v.trim() } } : r,
        },
      },
    ];

    if (mappedKeys.has('lead_status')) {
      cols.push({
        key: 'status',
        label: 'Status',
        render: (r) => {
          if (r.unmatched.has('status')) {
            return <UnmatchedChip raw={r.base.leadStatus ?? ''} />;
          }
          if (!r.leadStatus)
            return <span className="text-muted-foreground text-sm">—</span>;
          return <StatusBadge column={fieldOptions.statusFor(r.leadStatus)} />;
        },
        edit: {
          kind: 'status',
          options: statusCellOptions(fieldOptions.statuses),
          value: (r) => r.leadStatus ?? 'new',
          commit: (r, v) => resolveField(r, 'status', { leadStatus: v }),
        },
      });
    }

    if (mappedKeys.has('email')) {
      cols.push({
        key: 'email',
        label: 'Email',
        render: (r) => (
          <span className="text-muted-foreground text-sm">
            {r.base.email || '-'}
          </span>
        ),
        edit: {
          kind: 'email',
          value: (r) => r.base.email ?? '',
          commit: (r, v) => ({
            ...r,
            base: { ...r.base, email: v.trim() || undefined },
          }),
        },
      });
    }

    if (mappedKeys.has('company')) {
      cols.push({
        key: 'company',
        label: 'Company',
        render: (r) => (
          <span className="text-muted-foreground text-sm">
            {r.base.company || '-'}
          </span>
        ),
        edit: {
          kind: 'text',
          value: (r) => r.base.company ?? '',
          commit: (r, v) => ({
            ...r,
            base: { ...r.base, company: v.trim() || undefined },
          }),
        },
      });
    }

    if (mappedKeys.has('source')) {
      cols.push({
        key: 'source',
        label: 'Source',
        render: (r) => {
          if (r.unmatched.has('source')) {
            return <UnmatchedChip raw={r.base.source ?? ''} />;
          }
          if (!r.source)
            return <span className="text-muted-foreground text-sm">—</span>;
          return (
            <SourceIcon
              source={r.source}
              label={fieldOptions.sourceLabel(r.source)}
            />
          );
        },
        edit: {
          kind: 'select',
          options: sourceCellOptions(fieldOptions.sources),
          value: (r) => r.source ?? '',
          commit: (r, v) => resolveField(r, 'source', { source: v || null }),
        },
      });
    }

    if (mappedKeys.has('gender')) {
      cols.push({
        key: 'gender',
        label: 'Gender',
        render: (r) => {
          if (r.unmatched.has('gender')) {
            return <UnmatchedChip raw={r.base.gender ?? ''} />;
          }
          return (
            <span className="text-muted-foreground text-sm">
              {fieldOptions.genderLabel(r.gender)}
            </span>
          );
        },
        edit: {
          kind: 'select',
          options: genderCellOptions(fieldOptions.genders),
          value: (r) => r.gender ?? '',
          commit: (r, v) => resolveField(r, 'gender', { gender: v || null }),
        },
      });
    }

    if (mappedKeys.has('assignee')) {
      cols.push({
        key: 'assignee',
        label: 'Assigned to',
        render: (r, i) => {
          if (r.unmatched.has('assignee')) {
            return (
              <UnmatchedChip
                raw={r.base.assignedTo ?? ''}
                onClick={() => setEditingCell({ row: i, key: 'assignee' })}
              />
            );
          }
          if (r.pendingInvitationId && r.pendingAssigneeName) {
            return <PendingAssigneeDisplay name={r.pendingAssigneeName} />;
          }
          if (!r.assignedTo) {
            return (
              <span className="text-muted-foreground text-sm">
                You (importer)
              </span>
            );
          }
          return (
            <AssigneeDisplay
              name={nameById.get(r.assignedTo) ?? 'Teammate'}
              avatarUrl={avatarById.get(r.assignedTo)}
            />
          );
        },
        edit: {
          kind: 'select',
          options: assigneeCellOptions(staff),
          value: (r) => r.assignedTo ?? '',
          commit: (r, v) =>
            resolveField(r, 'assignee', { assignedTo: v || null }),
        },
      });
    }

    if (mappedKeys.has('tags')) {
      cols.push({
        key: 'tags',
        label: 'Tags',
        render: (r) =>
          r.base.tagNames.length === 0 ? (
            <span className="text-muted-foreground text-xs">-</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {r.base.tagNames.slice(0, 3).map((name) => (
                <Badge key={name} variant="neutral">
                  {name}
                </Badge>
              ))}
              {r.base.tagNames.length > 3 && (
                <span className="text-muted-foreground text-[10px]">
                  +{r.base.tagNames.length - 3}
                </span>
              )}
            </div>
          ),
      });
    }

    for (const field of customFields) {
      if (!mappedKeys.has(`custom:${field.id}`)) continue;
      const type = field.field_type ?? 'text';
      cols.push({
        key: `cf:${field.id}`,
        label: field.field_name,
        render: (r) => {
          const cv = r.base.customValues.find((v) => v.fieldId === field.id);
          return (
            <span className="text-muted-foreground text-sm">
              {cv
                ? formatCustomFieldValue(cv.value, type, defaultCurrency)
                : '-'}
            </span>
          );
        },
        edit: {
          kind: customEditKind(type),
          prefix:
            type === 'currency' ? currencySymbol(defaultCurrency) : undefined,
          value: (r) =>
            r.base.customValues.find((v) => v.fieldId === field.id)?.value ??
            '',
          commit: (r, v) => {
            const rest = r.base.customValues.filter(
              (cv) => cv.fieldId !== field.id,
            );
            const coerced = v.trim()
              ? coerceCustomValue(v, type, dateOrder)
              : null;
            return {
              ...r,
              base: {
                ...r.base,
                customValues: coerced
                  ? [...rest, { fieldId: field.id, value: coerced }]
                  : rest,
              },
            };
          },
        },
      });
    }

    return cols;
  }, [
    mappedKeys,
    customFields,
    fieldOptions,
    staff,
    nameById,
    avatarById,
    defaultCurrency,
    dateOrder,
  ]);

  const shown = rows.slice(0, PREVIEW_CAP);

  return (
    // Fills the modal body (which is flex-col + overflow-hidden for this
    // step) so the grid owns its own scroll and the footer stays put — the
    // horizontal scrollbar rests just above the sticky dialog footer.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Summary chips — the fix state is a STATUS indicator now, not a
          button (the panel is always docked when anything is unmatched). */}
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip label="new" count={newCount} tone="ok" />
        {updateCount > 0 && (
          <SummaryChip label="already exist" count={updateCount} tone="info" />
        )}
        {skipped > 0 && (
          <SummaryChip
            label="skipped"
            count={skipped}
            tone="muted"
            title={`${skippedNoPhone} without a phone · ${skippedDupes} duplicate${skippedDupes === 1 ? '' : 's'} in the file`}
          />
        )}
        {unmatchedRowCount > 0 ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            {unmatchedRowCount} value{unmatchedRowCount === 1 ? '' : 's'} to fix →
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="size-3" />
            All values match your options
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-3">
        {/* The grid — a flex column so the scroll region fills and the
            "showing N of M" strip pins to its bottom. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <TableHeader className="sticky top-0 z-10 bg-popover">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-20 text-xs">Row</TableHead>
                  {columns.map((col) => (
                    <TableHead key={col.key} className="text-xs whitespace-nowrap">
                      {col.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row, i) => (
                  <TableRow key={i} className="hover:bg-muted/40">
                    <TableCell className="py-1.5">
                      {row.exists ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-700 dark:text-cyan-400">
                          <span className="size-1.5 rounded-full bg-current" />
                          UPDATE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <span className="size-1.5 rounded-full bg-current" />
                          NEW
                        </span>
                      )}
                    </TableCell>
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={cn('align-middle', col.edit && 'p-0')}
                      >
                        {col.edit ? (
                          <EditableCell
                            editing={
                              editingCell?.row === i &&
                              editingCell?.key === col.key
                            }
                            saving={false}
                            kind={col.edit.kind}
                            value={col.edit.value(row)}
                            options={col.edit.options}
                            prefix={col.edit.prefix}
                            display={col.render(row, i)}
                            onStart={() =>
                              setEditingCell({ row: i, key: col.key })
                            }
                            onCommit={(v) => {
                              patchRow(i, col.edit!.commit(row, v));
                              setEditingCell(null);
                            }}
                            onCancel={() => setEditingCell(null)}
                          />
                        ) : (
                          col.render(row, i)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          {rows.length > PREVIEW_CAP && (
            <p className="shrink-0 border-t border-border bg-background/50 px-3 py-1.5 text-[11px] text-muted-foreground">
              Showing the first {PREVIEW_CAP} of {rows.length} rows — all{' '}
              {rows.length} will be imported, and value fixes apply to every
              row.
            </p>
          )}
        </div>

        {/* Docked fix-values panel — open by default, non-dismissible while
            anything is unmatched; disappears only when everything is clean.
            `Collapse axis="width"` slides it open/shut horizontally; the grid
            (flex sibling) reflows into the freed space with NO transform, so
            its sticky header stays put. */}
        <Collapse open={showPanel} axis="width" className="flex">
          <FixValuesPanel
            values={unmatched}
            fieldOptions={fieldOptions}
            staff={staff}
            nameById={nameById}
            avatarById={avatarById}
            pendingInvites={pendingInvites}
            canCreateTeammate={canCreateTeammate}
            onCreateTeammate={onCreateTeammate}
            onFix={fixValue}
            onAutoMatch={autoMatch}
          />
        </Collapse>
      </div>

      <p className="shrink-0 text-xs text-muted-foreground">
        Every cell is editable — click one to fix it. Changes live in this
        preview only; nothing is written until you confirm.
      </p>
    </div>
  );
}

function SummaryChip({
  label,
  count,
  tone,
  title,
}: {
  label: string;
  count: number;
  tone: 'ok' | 'info' | 'muted';
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border border-border bg-background/60 px-2.5 text-xs text-muted-foreground',
      )}
    >
      <b
        className={cn(
          'font-semibold',
          tone === 'ok' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'info' && 'text-cyan-700 dark:text-cyan-400',
          tone === 'muted' && 'text-foreground',
        )}
      >
        {count}
      </b>
      {label}
    </span>
  );
}

// ---- Fix values panel ------------------------------------------------------

const FIELD_TITLES: Record<FixableField, string> = {
  status: 'Status',
  source: 'Source',
  gender: 'Gender',
  assignee: 'Assigned to',
};

function FixValuesPanel({
  values,
  fieldOptions,
  staff,
  nameById,
  avatarById,
  pendingInvites,
  canCreateTeammate,
  onCreateTeammate,
  onFix,
  onAutoMatch,
}: {
  values: UnmatchedValue[];
  fieldOptions: FieldOptionSets;
  staff: StaffRef[];
  nameById: Map<string, string>;
  avatarById: Map<string, string | null>;
  pendingInvites: PendingInvite[];
  canCreateTeammate: boolean;
  onCreateTeammate: (name: string) => Promise<PendingInvite | null>;
  onFix: (field: FixableField, raw: string, key: string, count: number) => void;
  onAutoMatch: () => void;
}) {
  const total = values.reduce((n, v) => n + v.count, 0);

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background/50">
      <div className="flex items-start gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Fix values</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Fix each value once — it applies to every row carrying it.
          </p>
        </div>
        <span className="rounded-lg bg-amber-500/10 px-2 py-1 text-center text-amber-700 dark:text-amber-400">
          <b className="block text-base leading-none font-bold tabular-nums">
            {total}
          </b>
          <span className="text-[9px] font-semibold tracking-wider uppercase">
            rows
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {/* Cards fade/slide out as each value is fixed (drops from `values`);
            the rest reflow up. */}
        <MotionList>
          {values.map((v) => (
            <MotionListItem key={`${v.field}:${v.raw.toLowerCase()}`}>
              <FixValueCard
                value={v}
                fieldOptions={fieldOptions}
                staff={staff}
                nameById={nameById}
                avatarById={avatarById}
                pendingInvites={pendingInvites}
                canCreateTeammate={canCreateTeammate}
                onCreateTeammate={onCreateTeammate}
                onFix={(key) => onFix(v.field, v.raw, key, v.count)}
              />
            </MotionListItem>
          ))}
        </MotionList>
      </div>

      <div className="border-t border-border p-2.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAutoMatch}
          className="w-full border-border text-muted-foreground hover:bg-muted"
        >
          <Sparkles className="size-3.5" />
          Auto-match remaining
        </Button>
        <p className="mt-1.5 text-center text-[10px] leading-snug text-muted-foreground">
          Unfixed values still import safely — stored as-is, shown muted.
        </p>
      </div>
    </aside>
  );
}

function FixValueCard({
  value,
  fieldOptions,
  staff,
  nameById,
  avatarById,
  pendingInvites,
  canCreateTeammate,
  onCreateTeammate,
  onFix,
}: {
  value: UnmatchedValue;
  fieldOptions: FieldOptionSets;
  staff: StaffRef[];
  nameById: Map<string, string>;
  avatarById: Map<string, string | null>;
  pendingInvites: PendingInvite[];
  canCreateTeammate: boolean;
  onCreateTeammate: (name: string) => Promise<PendingInvite | null>;
  onFix: (key: string) => void;
}) {
  const [creating, setCreating] = useState(false);

  async function createTeammate() {
    setCreating(true);
    const invite = await onCreateTeammate(value.raw);
    setCreating(false);
    if (invite) onFix(`${PENDING_ASSIGNEE_PREFIX}${invite.id}`);
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-popover p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs font-semibold text-foreground">
          &quot;{value.raw}&quot;
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {FIELD_TITLES[value.field]} · {value.count} row
          {value.count === 1 ? '' : 's'}
        </span>
      </div>
      {/* DropdownMenu + pills/avatars, matching the bulk-edit dialogs' picker
          pattern (ui/Select echoes raw values — see CLAUDE.md). */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex h-7 w-full items-center justify-between gap-1.5 rounded-md border border-input-border bg-transparent px-2 text-xs text-muted-foreground outline-none transition-colors select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
            />
          }
        >
          {value.field === 'assignee' ? 'Assign to…' : `Choose ${FIELD_TITLES[value.field].toLowerCase()}…`}
          <ChevronDown className="size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44 bg-popover border-border">
          {value.field === 'assignee'
            ? [
                { user_id: '', full_name: 'Assign to me (importer)' },
                ...staff,
              ].map((s) => (
                <DropdownMenuItem
                  key={s.user_id || '__importer__'}
                  onClick={() => onFix(s.user_id)}
                  className="text-popover-foreground focus:bg-muted"
                >
                  {s.user_id ? (
                    <AssigneeDisplay
                      name={nameById.get(s.user_id) ?? s.full_name}
                      avatarUrl={avatarById.get(s.user_id)}
                    />
                  ) : (
                    <span className="text-sm">{s.full_name}</span>
                  )}
                </DropdownMenuItem>
              ))
            : (value.field === 'status'
                ? fieldOptions.statuses
                : value.field === 'source'
                  ? fieldOptions.sources
                  : fieldOptions.genders
              ).map((o) => (
                <DropdownMenuItem
                  key={o.key}
                  onClick={() => onFix(o.key)}
                  className="text-popover-foreground focus:bg-muted"
                >
                  {value.field === 'status' ? (
                    <Badge color={(o as LeadColumn).color ?? '#64748b'}>
                      {o.label}
                    </Badge>
                  ) : (
                    <span className="flex items-center gap-2 text-sm">
                      {value.field === 'source' && (
                        <SourceIcon source={o.key} label={o.label} />
                      )}
                      {o.label}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}

          {/* Assignee only: existing pending invites + create-new. */}
          {value.field === 'assignee' && pendingInvites.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {pendingInvites.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => onFix(`${PENDING_ASSIGNEE_PREFIX}${p.id}`)}
                  className="text-popover-foreground focus:bg-muted"
                >
                  <PendingAssigneeDisplay name={p.name} />
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {value.field === 'assignee' && canCreateTeammate && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={creating}
          onClick={createTeammate}
          className="h-6 w-full min-w-0 justify-start px-1.5 text-[11px] text-primary-text hover:bg-primary/5"
        >
          {creating ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : (
            <UserPlus className="size-3 shrink-0" />
          )}
          <span className="truncate">
            Invite &quot;{value.raw}&quot; as a teammate
          </span>
        </Button>
      )}
    </div>
  );
}
