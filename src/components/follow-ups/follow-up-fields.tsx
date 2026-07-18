'use client';

import { useId } from 'react';
import { ChevronDown, Timer } from 'lucide-react';

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
import { Label, labelVariants } from '@/components/ui/label';
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
  /** Notes can toggle a task on; standalone creation always shows the fields. */
  showEnabledToggle?: boolean;
  className?: string;
}

/**
 * The single manual follow-up field set used by notes and assignment dialogs.
 * Keeping reason, action, date, owner, and reminder here prevents the two
 * entry points from drifting into different task models again.
 */
export function FollowUpFields({
  draft,
  onPatch,
  staff,
  currentUserId,
  showEnabledToggle = true,
  className,
}: FollowUpFieldsProps) {
  const { fmt } = useLocale();
  const reasonLabelId = useId();
  const nextActionLabelId = useId();
  const presets = duePresets(fmt.today());
  const fieldsVisible = !showEnabledToggle || draft.enabled;
  const dueLabel =
    draft.dueId === 'custom'
      ? draft.customDate || 'Custom date'
      : (presets.find((preset) => preset.id === draft.dueId)?.label ??
        presets[3].label);
  const effectiveAssignee = draft.assignee || currentUserId;
  const assigneeMember = staff.find(
    (member) => member.user_id === effectiveAssignee
  );
  const assigneeLabel = assigneeMember
    ? `${assigneeMember.full_name}${effectiveAssignee === currentUserId ? ' (Me)' : ''}`
    : 'Me';
  const remindLabel =
    REMINDER_SLOTS.find((slot) => slot.value === draft.remindSlot)?.label ??
    'Set reminder';

  return (
    <div
      className={cn(
        showEnabledToggle
          ? 'border-border border-t'
          : 'border-border bg-card overflow-hidden rounded-lg border',
        className
      )}
    >
      <div className="flex flex-col px-3 py-2">
        {showEnabledToggle && (
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-foreground text-sm">Add a follow-up</span>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(value) => onPatch({ enabled: value === true })}
              aria-label="Add a follow-up"
            />
          </div>
        )}

        {fieldsVisible && (
          <div className={cn('space-y-3 py-1', showEnabledToggle && 'mt-2')}>
            <div className="space-y-1.5">
              <Label id={reasonLabelId} size="sm">
                Reason
              </Label>
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
            </div>

            <div className="space-y-1.5">
              <Label id={nextActionLabelId} size="sm">
                Next action
              </Label>
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-labelledby={nextActionLabelId}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button type="button" variant="outline" size="sm" />
                    }
                  >
                    {
                      FOLLOW_UP_TASK_TYPES.find(
                        (taskType) => taskType.value === draft.type
                      )?.label
                    }
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

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button type="button" variant="outline" size="sm" />
                    }
                  >
                    {dueLabel}
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
                  <div className="w-48">
                    <DatePicker
                      value={draft.customDate}
                      min={fmt.today()}
                      onChange={(value) => onPatch({ customDate: value })}
                      aria-label="Follow-up date"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {fieldsVisible && (
        <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-3 py-2">
          <span className="flex items-center gap-1">
            <span className={labelVariants({ size: 'sm' })}>Assign to</span>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="ghost" size="sm" />}
              >
                {assigneeLabel}
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
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="ghost" size="sm" />}
            >
              <Timer className="text-muted-foreground" />
              {remindLabel}
              <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onPatch({ remindSlot: '' })}>
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
        </div>
      )}
    </div>
  );
}
