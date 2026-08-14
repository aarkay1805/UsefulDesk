'use client';

import { CircleAlert, Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useAuthIdentities } from '@/hooks/use-auth-identities';
import { useConfirmedProfileEmail } from '@/hooks/use-confirmed-profile-email';
import { summarizeAuthIdentities } from '@/lib/auth/identity-summary';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AccountEmailForm } from './account-email-form';
import { PasswordForm } from './password-form';
import { SignInMethodsCard } from './sign-in-methods-card';
import { SessionsCard } from './sessions-card';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * "Login & security" section — groups the former Profile-tab password
 * and active-sessions cards into their own dedicated home.
 */
export function SecurityPanel() {
  const { user, profile, refreshProfile } = useAuth();
  const { identities, loading, error, refresh } = useAuthIdentities();
  const summary = summarizeAuthIdentities(identities);

  useConfirmedProfileEmail({
    userId: user?.id ?? null,
    authEmail: user?.email ?? null,
    profileEmail: profile?.email ?? null,
    onSynced: refreshProfile,
  });

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200 motion-reduce:animate-none">
      <SettingsPanelHead
        title="Login & security"
        description="Manage how you sign in and protect your UsefulDesk account."
      />
      <div className="space-y-4">
        {loading ? (
          <Card role="status" aria-label="Loading sign-in methods">
            <CardContent className="text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 className="size-4 animate-spin" />
              Loading sign-in methods…
            </CardContent>
          </Card>
        ) : error ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Sign-in methods unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={refresh}
              >
                Retry
              </Button>
            </AlertAction>
          </Alert>
        ) : (
          <>
            <SignInMethodsCard
              summary={summary}
              accountEmail={user?.email ?? null}
            />
            <AccountEmailForm
              accountEmail={user?.email ?? null}
              googleEmail={summary.googleEmail}
              hasGoogle={Boolean(summary.googleIdentity)}
              hasPassword={summary.hasPassword}
            />
            {summary.hasPassword ? <PasswordForm onUpdated={refresh} /> : null}
          </>
        )}
        <SessionsCard />
      </div>
    </section>
  );
}
