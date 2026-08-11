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
    <Alert variant="destructive" className="mb-4">
      <TriangleAlert />
      <AlertTitle>
        {unlinked
          ? 'Your login is not linked to an account'
          : 'Could not load your permissions'}
      </AlertTitle>
      <AlertDescription>
        {unlinked
          ? 'Changes cannot be saved until access is restored. Ask your UsefulDesk owner or admin to re-invite you or restore your branch access.'
          : 'Your account role did not load, so actions are treated as read-only. Check your connection and try again.'}
        {accountStatusDetail ? (
          <span className="mt-1 block font-mono text-xs opacity-70">
            Support detail: {accountStatusDetail}
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
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}
