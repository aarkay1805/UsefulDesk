'use client';

import type { ComponentProps } from 'react';
import { ListPlus } from 'lucide-react';

import { GatedButton } from '@/components/ui/gated-button';

type FollowUpButtonProps = Omit<
  ComponentProps<typeof GatedButton>,
  'children' | 'variant' | 'size'
>;

/** Canonical manual follow-up trigger for lead and member action rows. */
export function FollowUpButton({
  gateReason = 'create follow-ups',
  ...props
}: FollowUpButtonProps) {
  return (
    <GatedButton
      type="button"
      variant="ghost"
      size="sm"
      gateReason={gateReason}
      {...props}
    >
      <ListPlus className="size-3.5" />
      Follow up
    </GatedButton>
  );
}
