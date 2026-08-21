'use client';

import { Check } from 'lucide-react';
import type { MouseEventHandler } from 'react';

import type { FollowUp } from '@/types';
import { Badge } from '@/components/ui/badge';

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

  const button = (
    <button
      type="button"
      onClick={onMarkDone}
      disabled={!canAct}
      aria-label={ariaLabel}
      title={canAct ? ariaLabel : undefined}
      className="border-border text-muted-foreground hover:text-green-foreground flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors hover:border-green-500 disabled:pointer-events-none disabled:opacity-50"
    >
      <Check className="size-4" />
    </button>
  );

  if (canAct) return button;

  return (
    <span
      className="inline-flex cursor-not-allowed"
      title={
        gateReason ? `Read-only — your role can't ${gateReason}` : undefined
      }
    >
      {button}
    </span>
  );
}
