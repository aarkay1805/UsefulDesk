'use client';

import { Check } from 'lucide-react';
import type { MouseEventHandler, ReactNode } from 'react';

import type { FollowUp } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ResolvableAction } from '@/components/ui/resolvable-action';

export const FOLLOW_UP_PERMISSION_BLOCKER_CODE = 'permission' as const;

export function followUpPermissionBlocker(
  canAct: boolean,
  gateReason = 'complete follow-ups'
) {
  return canAct
    ? null
    : {
        code: FOLLOW_UP_PERMISSION_BLOCKER_CODE,
        title: 'Admin access required',
        description: `Ask an admin or owner to ${gateReason}.`,
      };
}

interface FollowUpCompletionButtonProps {
  canAct: boolean;
  onComplete: MouseEventHandler<HTMLButtonElement>;
  icon: ReactNode;
  children?: ReactNode;
}

/** Canonical row and bulk completion action used by both follow-up queues. */
export function FollowUpCompletionButton({
  canAct,
  onComplete,
  icon,
  children = 'Complete',
}: FollowUpCompletionButtonProps) {
  const blocker = followUpPermissionBlocker(canAct);
  return (
    <ResolvableAction
      trigger={
        <Button type="button" variant="ghost" size="sm">
          {icon}
          {children}
        </Button>
      }
      onAction={onComplete}
      blocker={blocker}
    />
  );
}

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
  gateReason = 'complete follow-ups',
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

  const blocker = followUpPermissionBlocker(canAct, gateReason);

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
