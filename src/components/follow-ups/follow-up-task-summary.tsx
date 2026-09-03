import { CircleDot, ClipboardList, Mail, Phone } from 'lucide-react';

import { FOLLOW_UP_TASK_TYPES } from '@/lib/leads/follow-up-dates';
import { REASON_LABEL } from '@/lib/memberships/follow-ups';
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
 * A follow-up's note: 12px muted supporting text beneath the 14px task
 * heading, where size and tone together carry the demotion. It is only ever
 * the stacked cell's second line — a note set beside its heading cannot be
 * demoted by size, and the one queue that tried it (the dashboard) now uses
 * this same stacked shape, so the two-role `variant` and the label-only
 * `FollowUpTaskLabel` it needed both went away with it.
 *
 * `max-w-56` bounds the truncation so one long note cannot stretch the cell
 * it sits in; the full text stays on the title tooltip.
 */
function FollowUpTaskNote({ note }: { note: string }) {
  return (
    <p className="text-muted-foreground max-w-56 truncate text-xs" title={note}>
      {note}
    </p>
  );
}

/**
 * The task on one muted line, for rows whose identity slot already belongs to
 * the person — a dashboard queue that leads with the contact's avatar and name
 * the way every queue beside it does. The note carries the line when there is
 * one; the task type names it when there is not, so the row never loses the
 * second line and the queue keeps one rhythm down the card.
 *
 * The icon stays because it is the only thing on a person-first row that says
 * *how* the follow-up happens. It reads from the same `TASK_ICON` map as the
 * stacked cell, so the vocabulary changes in one place.
 */
export function FollowUpTaskLine({
  taskType,
  note,
}: Pick<FollowUpTaskSummaryProps, 'taskType' | 'note'>) {
  const { TaskIcon, taskLabel } = resolveTask(taskType, undefined);
  const text = note?.trim() || taskLabel;
  return (
    <div
      className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs"
      title={note?.trim() || undefined}
    >
      <TaskIcon className="size-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </div>
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
        {note && <FollowUpTaskNote note={note} />}
      </div>
    </div>
  );
}
