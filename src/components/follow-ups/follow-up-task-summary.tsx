import { CircleDot, ClipboardList, Mail, Phone } from 'lucide-react';

import { FOLLOW_UP_TASK_TYPES } from '@/lib/leads/follow-up-dates';
import { REASON_LABEL } from '@/lib/memberships/follow-ups';
import type { FollowUp, FollowUpReason } from '@/types';
import { Badge } from '@/components/ui/badge';

const TASK_ICON: Record<FollowUp['task_type'], typeof Phone> = {
  call: Phone,
  email: Mail,
  todo: ClipboardList,
};

interface FollowUpTaskSummaryProps {
  taskType?: FollowUp['task_type'] | null;
  note?: string | null;
  /** Member-only context; lead follow-ups intentionally omit this tag. */
  reason?: FollowUpReason;
}

/**
 * Canonical follow-up table cell: task-type icon, task label, and optional
 * note. Member queues additionally pass `reason`; lead queues do not.
 */
export function FollowUpTaskSummary({
  taskType,
  note,
  reason,
}: FollowUpTaskSummaryProps) {
  const TaskIcon = taskType ? TASK_ICON[taskType] : CircleDot;
  const taskLabel = taskType
    ? (FOLLOW_UP_TASK_TYPES.find((task) => task.value === taskType)?.label ??
      'Task')
    : 'Not scheduled';

  return (
    <div className="flex min-w-0 items-center gap-2">
      <TaskIcon className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="text-foreground text-sm">{taskLabel}</p>
          {reason && <Badge variant="neutral">{REASON_LABEL[reason]}</Badge>}
        </div>
        {note && (
          <p
            className="text-muted-foreground max-w-56 truncate text-xs"
            title={note}
          >
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
