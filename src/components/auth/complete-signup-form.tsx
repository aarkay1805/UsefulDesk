'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  clearGymNameDraft,
  completeSignup,
  navigateToCompletedBranch,
  readGymNameDraft,
  saveGymNameDraft,
} from '@/lib/auth/complete-signup-client';
import { GYM_NAME_ERROR, normalizeGymName } from '@/lib/auth/gym-name';
import { getErrorMessage } from '@/lib/errors';

export function CompleteSignupForm({ accountId }: { accountId: string }) {
  const [gymName, setGymName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.resolve().then(() => {
      if (!cancelled) setGymName(readGymNameDraft());
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setRequestError(null);

    const normalizedGymName = normalizeGymName(gymName);
    if (!normalizedGymName) {
      setFieldError(GYM_NAME_ERROR);
      return;
    }

    setFieldError(null);
    saveGymNameDraft(normalizedGymName);
    setLoading(true);

    try {
      await completeSignup(accountId, normalizedGymName);
      clearGymNameDraft();
      navigateToCompletedBranch(accountId);
    } catch (error) {
      setRequestError(
        getErrorMessage(
          error,
          'Could not finish setting up your gym. Try again.'
        )
      );
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {requestError ? (
        <Alert variant="destructive">
          <AlertDescription>{requestError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="gymName">Gym name</Label>
        <Input
          id="gymName"
          name="gymName"
          autoComplete="organization"
          value={gymName}
          onChange={(event) => {
            setGymName(event.target.value);
            if (fieldError) setFieldError(null);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby="gym-name-help gym-name-error"
          onInvalid={(event) => {
            event.preventDefault();
            setFieldError(GYM_NAME_ERROR);
          }}
          required
          disabled={loading}
        />
        <p id="gym-name-help" className="text-muted-foreground text-xs">
          Used as your legal entity and first branch.
        </p>
        {fieldError ? (
          <p id="gym-name-error" className="text-red-foreground text-xs">
            {fieldError}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" loading={loading} className="w-full">
        Continue to UsefulDesk
      </Button>
    </form>
  );
}
