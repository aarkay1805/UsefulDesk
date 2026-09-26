'use client';

import { useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

/** Explain and recover a signed-in session whose account context did not resolve. */
export function AccountAccessAlert() {
  const { accountStatus, accountStatusDetail, refreshProfile } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (accountStatus === 'loading' || accountStatus === 'ready') return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await refreshProfile();
    } finally {
      setRetrying(false);
    }
  };

  const unlinked = accountStatus === 'unlinked';

  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>
        {unlinked
          ? 'Your login is not linked to a gym'
          : 'Could not load your gym'}
      </AlertTitle>
      <AlertDescription>
        {unlinked
          ? 'You cannot save changes right now. Ask your gym owner or admin to invite you again.'
          : 'Your gym details did not load. Check your internet and try again.'}
        {accountStatusDetail ? (
          <span className="mt-1 block font-mono text-xs opacity-70">
            For support: {accountStatusDetail}
          </span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void retry()}
          disabled={retrying}
        >
          {retrying ? <Loader2 className="animate-spin" /> : null}
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}
