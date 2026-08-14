'use client';

import { useState } from 'react';
import { AtSign, CheckCircle2, KeyRound, Loader2, Mail } from 'lucide-react';

import type { AuthIdentitySummary } from '@/lib/auth/identity-summary';
import { LOGIN_SECURITY_PATH } from '@/lib/auth/recovery-destination';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { PasswordForm } from './password-form';

function AddPasswordAction({ email }: { email: string | null }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendVerifiedLink = async () => {
    if (!email) return;
    setSending(true);
    setError(null);
    try {
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('next', LOGIN_SECURITY_PATH);
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: callback.toString(),
      });
      if (error) throw error;
      setSent(true);
    } catch (error) {
      setError(
        getErrorMessage(error, 'A secure password link could not be sent.')
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        We&apos;ll email a secure link so you can verify this account before
        creating a password.
      </p>
      {sent ? (
        <Alert>
          <Mail />
          <AlertDescription>
            Check {email} for the secure link. It expires shortly.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => void sendVerifiedLink()}
        disabled={sending || !email}
      >
        {sending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Sending…
          </>
        ) : sent ? (
          'Send another link'
        ) : (
          'Add password'
        )}
      </Button>
    </div>
  );
}

export function SignInMethodsCard({
  summary,
  accountEmail,
  onRefresh,
}: {
  summary: AuthIdentitySummary;
  accountEmail: string | null;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in methods</CardTitle>
        <CardDescription>
          Methods currently linked to your UsefulDesk account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary.googleIdentity ? (
          <>
            <div className="flex items-center gap-3">
              <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                <AtSign className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Google</div>
                <div className="text-muted-foreground truncate text-sm">
                  {summary.googleEmail ?? 'Email unavailable'}
                </div>
              </div>
              <Badge variant="success">
                <CheckCircle2 data-icon="inline-start" />
                Connected
              </Badge>
            </div>
            <Separator />
          </>
        ) : null}

        <div className="flex items-center gap-3">
          <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
            <KeyRound className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Password</div>
            <div className="text-muted-foreground text-sm">
              {summary.hasPassword
                ? 'Available for email sign-in'
                : 'No password fallback yet'}
            </div>
          </div>
          <Badge variant={summary.hasPassword ? 'success' : 'neutral'}>
            {summary.hasPassword ? 'Connected' : 'Not set'}
          </Badge>
        </div>

        <Separator />
        {summary.hasPassword ? (
          <PasswordForm onUpdated={onRefresh} />
        ) : (
          <AddPasswordAction email={accountEmail} />
        )}
      </CardContent>
    </Card>
  );
}
