'use client';

import type { ComponentProps } from 'react';
import { ListPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ResolvableAction } from '@/components/ui/resolvable-action';
import { followUpPermissionBlocker } from './follow-up-completion-control';

type FollowUpButtonProps = Omit<
  ComponentProps<typeof Button>,
  'children' | 'variant' | 'size'
> & {
  canAct?: boolean;
  gateReason?: string;
};

/** Canonical manual follow-up trigger for lead and member action rows. */
export function FollowUpButton({
  canAct = true,
  gateReason = 'create follow-ups',
  onClick,
  ...props
}: FollowUpButtonProps) {
  const blocker = followUpPermissionBlocker(canAct, gateReason);

  return (
    <ResolvableAction
      trigger={
        <Button type="button" variant="ghost" size="sm" {...props}>
          <ListPlus className="size-3.5" />
          Follow up
        </Button>
      }
      onAction={onClick}
      blocker={blocker}
    />
  );
}
