'use client';

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

import { useLocale } from '@/hooks/use-locale';
import {
  duePresets,
  FOLLOW_UP_TASK_TYPES,
  REMINDER_SLOTS,
  type FollowUpTaskType,
} from '@/lib/leads/follow-up-dates';
import { REASON_LABEL } from '@/lib/memberships/follow-ups';
import { cn } from '@/lib/utils';
import type { FollowUpReason } from '@/types';
import type { StaffMember } from '@/components/members/use-account-staff';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Chip, ChipGroup } from '@/components/ui/chip';

const REASONS = Object.keys(REASON_LABEL) as FollowUpReason[];

/** Shared editor state for every manual follow-up entry point. */
export interface FollowUpDraft {
  enabled: boolean;
  reason: FollowUpReason;
  type: FollowUpTaskType;
  /** duePresets() id, or 'custom'. */
  dueId: string;
  customDate: string;
  /** '' = current user. */
  assignee: string;
  /** '' = no reminder; otherwise an account-local slot like '08:00'. */
  remindSlot: string;
}

export const DEFAULT_FOLLOW_UP_DRAFT: FollowUpDraft = {
  enabled: false,
  reason: 'other',
  type: 'todo',
  dueId: '3d',
  customDate: '',
  assignee: '',
  remindSlot: '',
};

/** The concrete due date a draft resolves to (undefined = invalid). */
export function resolveDueDate(
  draft: FollowUpDraft,
  today?: string
): string | undefined {
  return draft.dueId === 'custom'
    ? draft.customDate || undefined
    : duePresets(today).find((preset) => preset.id === draft.dueId)?.date;
}

interface FollowUpFieldsProps {
  draft: FollowUpDraft;
  onPatch: (patch: Partial<FollowUpDraft>) => void;
  staff: StaffMember[];
  currentUserId: string;
  /** Member follow-ups explain the renewal/retention reason. Lead follow-ups
   *  are general sales work and intentionally omit that taxonomy. */
  showReason?: boolean;
  /** Notes can toggle a task on; standalone creation always shows the fields. */
  showEnabledToggle?: boolean;
  className?: string;
}

/** One captioned field: `Label` above its control(s), grouped for assistive tech. */
function FollowUpField({
  label,
  labelId,
  className,
  children,
}: {
  label: string;
  labelId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label id={labelId} size="sm">
        {label}
      </Label>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-2"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The single manual follow-up field set, rendered only through
 * `FollowUpComposer` — so the profile Notes section and the standalone
 * dialog cannot drift into different task models again.
 *
 * Every value control is the same menu-trigger recipe (outline / small) under
 * its own caption, so no field in the set reads as a lesser control than
 * another. Only Reason differs, because a chip strip owns its full row.
 */
export function FollowUpFields({
  draft,
  onPatch,
  staff,
  currentUserId,
  showReason = true,
  showEnabledToggle = true,
  className,
}: FollowUpFieldsProps) {
  const { fmt } = useLocale();
  const reasonLabelId = useId();
  const taskLabelId = useId();
  const dueLabelId = useId();
  const assigneeLabelId = useId();
  const reminderLabelId = useId();
  const presets = duePresets(fmt.today());
  const fieldsVisible = !showEnabledToggle || draft.enabled;
  const typeLabel =
    FOLLOW_UP_TASK_TYPES.find((taskType) => taskType.value === draft.type)
      ?.label ?? 'To-do';
  // A custom date renders through the account's formatter — never the raw
  // 'YYYY-MM-DD' the draft stores. Before one is picked the trigger names the
  // CHOICE ('Custom date'), leaving the instruction to the date field below it
  // — two stacked controls both reading 'Pick a date' told the user nothing.
  const dueLabel =
    draft.dueId === 'custom'
      ? draft.customDate
        ? fmt.date(draft.customDate)
        : 'Custom date'
      : (presets.find((preset) => preset.id === draft.dueId)?.label ??
        'Pick a date');
  const effectiveAssignee = draft.assignee || currentUserId;
  const assigneeMember = staff.find(
    (member) => member.user_id === effectiveAssignee
  );
  const assigneeLabel = assigneeMember
    ? `${assigneeMember.full_name}${effectiveAssignee === currentUserId ? ' (Me)' : ''}`
    : 'Me';
  const remindLabel =
    REMINDER_SLOTS.find((slot) => slot.value === draft.remindSlot)?.label ??
    'No reminder';

  return (
    // Always the attached treatment: this set only ever renders beneath a
    // note textarea inside `FollowUpComposer`, so the composer owns the
    // card and this owns the divider.
    <div className={cn('border-border border-t', className)}>
      <div className="flex flex-col gap-3 p-3">
        {showEnabledToggle && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground text-sm">Add a follow-up</span>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(value) => onPatch({ enabled: value === true })}
              aria-label="Add a follow-up"
            />
          </div>
        )}

        {fieldsVisible && (
          <>
            {showReason && (
              <FollowUpField label="Reason" labelId={reasonLabelId}>
                <ChipGroup<FollowUpReason>
                  selectionMode="single"
                  value={[draft.reason]}
                  onValueChange={(reasons) => {
                    const reason = reasons[0];
                    if (reason) onPatch({ reason });
                  }}
                  aria-labelledby={reasonLabelId}
                >
                  {REASONS.map((reason) => (
                    <Chip key={reason} value={reason}>
                      {REASON_LABEL[reason]}
                    </Chip>
                  ))}
                </ChipGroup>
              </FollowUpField>
            )}

            {/* Task and due date each keep their own caption: "Follow-up" is
                the product's noun for the work, "Due date" for when it is
                owed. One shared caption over both reads as neither. */}
            <div className="flex flex-wrap gap-x-4 gap-y-3">
              <FollowUpField
                label="Follow-up"
                labelId={taskLabelId}
                className="min-w-0 flex-1 basis-40"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-between"
                      />
                    }
                  >
                    <span className="min-w-0 truncate">{typeLabel}</span>
                    <ChevronDown className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {FOLLOW_UP_TASK_TYPES.map((taskType) => (
                      <DropdownMenuItem
                        key={taskType.value}
                        onClick={() => onPatch({ type: taskType.value })}
                      >
                        {taskType.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </FollowUpField>

              <FollowUpField
                label="Due date"
                labelId={dueLabelId}
                className="min-w-0 flex-1 basis-40"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-between"
                      />
                    }
                  >
                    <span className="min-w-0 truncate">{dueLabel}</span>
                    <ChevronDown className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {presets.map((preset) => (
                      <DropdownMenuItem
                        key={preset.id}
                        onClick={() => onPatch({ dueId: preset.id })}
                      >
                        {preset.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem
                      onClick={() => onPatch({ dueId: 'custom' })}
                    >
                      Custom date
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {draft.dueId === 'custom' && (
                  <div className="w-full">
                    <DatePicker
                      value={draft.customDate}
                      min={fmt.today()}
                      onChange={(value) => onPatch({ customDate: value })}
                      aria-label="Due date"
                    />
                  </div>
                )}
              </FollowUpField>
            </div>

            {/* Owner and reminder share a row and collapse to one column in a
                narrow composer. */}
            <div className="flex flex-wrap gap-x-4 gap-y-3">
              <FollowUpField
                label="Assign to"
                labelId={assigneeLabelId}
                className="min-w-0 flex-1 basis-40"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-between"
                      />
                    }
                  >
                    <span className="min-w-0 truncate">{assigneeLabel}</span>
                    <ChevronDown className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {staff.map((member) => (
                      <DropdownMenuItem
                        key={member.user_id}
                        onClick={() => onPatch({ assignee: member.user_id })}
                      >
                        {member.user_id === currentUserId
                          ? `${member.full_name} (Me)`
                          : member.full_name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </FollowUpField>

              <FollowUpField
                label="Reminder"
                labelId={reminderLabelId}
                className="min-w-0 flex-1 basis-40"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-between"
                      />
                    }
                  >
                    <span className="min-w-0 truncate">{remindLabel}</span>
                    <ChevronDown className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => onPatch({ remindSlot: '' })}
                    >
                      No reminder
                    </DropdownMenuItem>
                    {REMINDER_SLOTS.map((slot) => (
                      <DropdownMenuItem
                        key={slot.value}
                        onClick={() => onPatch({ remindSlot: slot.value })}
                      >
                        {slot.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </FollowUpField>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
