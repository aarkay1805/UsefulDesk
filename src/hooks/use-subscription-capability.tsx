'use client';

import { createContext, useContext } from 'react';
import { canUseSubscriptionCapability } from '@/lib/auth/roles';
import type { ProductAccessSnapshot } from '@/lib/platform-access/model';
import type { SubscriptionCapability } from '@/lib/subscriptions/plans';
import type { ActionBlocker } from '@/components/ui/resolvable-action';

/** Supplied by the existing account-keyed access gate; never loads a second grant. */
export const SubscriptionAccessContext =
  createContext<ProductAccessSnapshot | null>(null);

export function useSubscriptionCapability(
  capability: SubscriptionCapability
): boolean {
  return canUseSubscriptionCapability(
    useContext(SubscriptionAccessContext),
    capability
  );
}

export const SUBSCRIPTION_CAPABILITY_BLOCKER: ActionBlocker = {
  title: 'A different plan is needed',
  description:
    'Growth and Ultimate include this action. Contact your gym owner to review plans.',
};
