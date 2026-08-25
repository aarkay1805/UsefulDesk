'use client';

import { Check } from 'lucide-react';
import type { MouseEventHandler } from 'react';

import type { FollowUp } from '@/types';
import { Badge } from '@/components/ui/badge';
import { ResolvableAction } from '@/components/ui/resolvable-action';

interface FollowUpCompletionControlProps {
  status: FollowUp['status'];
  onMarkDone: MouseEventHandler<HTMLButtonElement>;
  canAct?: boolean;
  gateReason?: string;
  ariaLabel?: string;
}

/**
 * Canonical completion control for a follow-up shown outside a data table.
 * Open tasks use the profile timeline's circular tick; terminal states render
 * their established completion/cancellation treatment.
 */
export function FollowUpCompletionControl({
  status,
  onMarkDone,
  canAct = true,
  gateReason,
  ariaLabel = 'Complete follow-up',
}: FollowUpCompletionControlProps) {
  if (status === 'done') {
    return (
      <span
        title="Completed"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-white"
      >
        <Check className="size-4" />
      </span>
    );
  }

  if (status === 'cancelled') {
    return <Badge variant="neutral">Cancelled</Badge>;
  }

  const blocker = canAct
    ? null
    : {
        title: 'Admin access required',
        description: `Ask an admin or owner to ${gateReason}.`,
      };

  return (
    <ResolvableAction
      trigger={
        <button
          type="button"
          aria-label={ariaLabel}
          title={canAct ? ariaLabel : undefined}
          className="border-border text-muted-foreground hover:text-green-foreground flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors hover:border-green-500 disabled:pointer-events-none disabled:opacity-50"
        >
          <Check className="size-4" />
        </button>
      }
      onAction={onMarkDone}
      blocker={blocker}
    />
  );
}
