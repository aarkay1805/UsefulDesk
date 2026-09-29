'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SUBSCRIPTION_CAPABILITY_BLOCKER } from '@/hooks/use-subscription-capability';

/** Existing Alert composition for a direct link to a tier-restricted editor. */
export function SubscriptionCapabilityNotice() {
  return (
    <Alert>
      <AlertTitle>{SUBSCRIPTION_CAPABILITY_BLOCKER.title}</AlertTitle>
      <AlertDescription>
        {SUBSCRIPTION_CAPABILITY_BLOCKER.description}
      </AlertDescription>
    </Alert>
  );
}
