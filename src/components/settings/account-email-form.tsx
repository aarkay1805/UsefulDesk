'use client';

import { useState } from 'react';
import { CircleAlert, Loader2, Mail } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { LOGIN_SECURITY_PATH } from '@/lib/auth/recovery-destination';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountEmailForm({
  accountEmail,
  googleEmail,
  hasGoogle,
  hasPassword,
}: {
  accountEmail: string | null;
  googleEmail: string | null;
  hasGoogle: boolean;
  hasPassword: boolean;
}) {
  const [syncedAccountEmail, setSyncedAccountEmail] = useState(accountEmail);
  const [email, setEmail] = useState(accountEmail ?? '');
  const [saving, setSaving] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auth can hydrate after this card mounts. Re-seed only when the confirmed
  // account email prop itself changes, never from an effect that can race an
  // in-progress edit.
  if (accountEmail !== syncedAccountEmail) {
    setSyncedAccountEmail(accountEmail);
    setEmail(accountEmail ?? '');
    setPendingEmail(null);
    setError(null);
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!EMAIL_RE.test(nextEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!accountEmail || nextEmail.toLowerCase() === accountEmail.toLowerCase())
      return;

    setSaving(true);
    setError(null);
    try {
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('next', LOGIN_SECURITY_PATH);
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser(
        { email: nextEmail },
        { emailRedirectTo: callback.toString() }
      );
      if (error) throw error;
      setPendingEmail(nextEmail);
    } catch (error) {
      setError(
        getErrorMessage(error, 'Your account email could not be changed.')
      );
    } finally {
      setSaving(false);
    }
  };

  const googleOnly = hasGoogle && !hasPassword;
  const displayedEmail = googleEmail ?? accountEmail ?? '';
  const emailHelpId = googleOnly || hasGoogle ? 'account-email-help' : null;
  const emailDescribedBy = [
    emailHelpId,
    pendingEmail ? 'account-email-pending' : null,
    error ? 'account-email-error' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="account-email-heading"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 id="account-email-heading">Account email</h3>
          </CardTitle>
          <CardDescription>
            The email UsefulDesk uses for account and security messages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="account-email">Email</Label>
            <Input
              id="account-email"
              type="email"
              value={googleOnly ? displayedEmail : email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
              readOnly={googleOnly}
              disabled={saving}
              required={!googleOnly}
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={emailDescribedBy || undefined}
            />
          </div>

          {googleOnly ? (
            <p
              id="account-email-help"
              className="text-muted-foreground text-sm"
            >
              This email comes from Google. Add a password fallback before
              changing it.
            </p>
          ) : hasGoogle ? (
            <p
              id="account-email-help"
              className="text-muted-foreground text-sm"
            >
              Changing your account email does not disconnect Google. Google
              sign-in will remain linked to {googleEmail ?? 'its current email'}
              .
            </p>
          ) : null}

          {pendingEmail ? (
            <Alert id="account-email-pending">
              <Mail />
              <AlertTitle>Email change requested</AlertTitle>
              <AlertDescription>
                Check your inboxes and complete every confirmation email you
                receive for the change to {pendingEmail}.
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert id="account-email-error" variant="destructive">
              <CircleAlert />
              <AlertTitle>Email change unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        {!googleOnly ? (
          <CardFooter className="justify-end">
            <Button
              type="submit"
              disabled={
                saving ||
                !accountEmail ||
                email.trim().toLowerCase() === accountEmail.toLowerCase()
              }
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Sending…
                </>
              ) : (
                'Change email'
              )}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  );
}
