import { CircleDot, ClipboardList, Mail, Phone } from 'lucide-react';

import { FOLLOW_UP_TASK_TYPES } from '@/lib/leads/follow-up-dates';
import { REASON_LABEL } from '@/lib/memberships/follow-ups';
import { cn } from '@/lib/utils';
import type { FollowUp, FollowUpReason } from '@/types';
import { Badge } from '@/components/ui/badge';

/** One task-type icon vocabulary for every follow-up surface — queue cells
 *  and the profile timeline card read from this map, never their own. */
export const TASK_ICON: Record<FollowUp['task_type'], typeof Phone> = {
  call: Phone,
  email: Mail,
  todo: ClipboardList,
};

interface FollowUpTaskSummaryProps {
  taskType?: FollowUp['task_type'] | null;
  note?: string | null;
  /** Optional identity label for compact contexts where the icon conveys type. */
  label?: string;
  /** Member-only context; lead follow-ups intentionally omit this tag. */
  reason?: FollowUpReason;
}

/** The icon and heading text a follow-up is named by, resolved once. */
function resolveTask(
  taskType: FollowUpTaskSummaryProps['taskType'],
  label: FollowUpTaskSummaryProps['label']
) {
  return {
    TaskIcon: taskType ? TASK_ICON[taskType] : CircleDot,
    taskLabel:
      label ??
      (taskType
        ? (FOLLOW_UP_TASK_TYPES.find((task) => task.value === taskType)
            ?.label ?? 'Task')
        : 'Not scheduled'),
  };
}

/** Heading text plus the member-only reason tag, on one line. */
function TaskLabelLine({
  taskLabel,
  reason,
}: {
  taskLabel: string;
  reason?: FollowUpReason;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <p className="text-foreground truncate text-sm">{taskLabel}</p>
      {reason && <Badge variant="neutral">{REASON_LABEL[reason]}</Badge>}
    </div>
  );
}

/**
 * The identity half of a follow-up on its own: task-type icon, heading, and
 * the member reason tag — no note. For row layouts that give the note a
 * column of its own instead of stacking it as a subtitle; the stacked shape
 * stays `FollowUpTaskSummary`. Both read the same icon map and tokens, so a
 * change to the task vocabulary reaches every surface at once.
 */
export function FollowUpTaskLabel({
  taskType,
  label,
  reason,
}: Omit<FollowUpTaskSummaryProps, 'note'>) {
  const { TaskIcon, taskLabel } = resolveTask(taskType, label);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <TaskIcon className="text-muted-foreground size-4 shrink-0" />
      <TaskLabelLine taskLabel={taskLabel} reason={reason} />
    </div>
  );
}

/**
 * A follow-up's note. The `max-w-56` cap belongs to the stacked cell, where
 * the note sits under a heading inside a bounded table column — not to a note
 * that owns a column of its own. Callers opt into a cap through `className`.
 */
export function FollowUpTaskNote({
  note,
  className,
}: {
  note: string;
  className?: string;
}) {
  return (
    <p
      className={cn('text-muted-foreground truncate text-xs', className)}
      title={note}
    >
      {note}
    </p>
  );
}

/**
 * Canonical follow-up table cell: task-type icon, task label, and optional
 * note. Member queues additionally pass `reason`; lead queues do not.
 */
export function FollowUpTaskSummary({
  taskType,
  note,
  label,
  reason,
}: FollowUpTaskSummaryProps) {
  const { TaskIcon, taskLabel } = resolveTask(taskType, label);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <TaskIcon className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0">
        <TaskLabelLine taskLabel={taskLabel} reason={reason} />
        {note && <FollowUpTaskNote note={note} className="max-w-56" />}
      </div>
    </div>
  );
}
