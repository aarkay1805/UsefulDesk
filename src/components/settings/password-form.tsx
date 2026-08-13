'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CircleAlert, KeyRound, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import {
  validatePasswordChange,
  type PasswordChangeError,
} from '@/lib/auth/password-change';
import { useAuth } from '@/hooks/use-auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

const MIN_PASSWORD = 8;

export function PasswordForm() {
  const { profile } = useAuth();
  const supabase = createClient();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<PasswordChangeError | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validatePasswordChange(
      current,
      next,
      confirm,
      MIN_PASSWORD
    );
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (!profile?.email) {
      setFormError({
        message: 'Your sign-in email is unavailable. Refresh and try again.',
        fields: [],
      });
      return;
    }
    setFormError(null);
    setSaving(true);

    try {
      // Supabase doesn't expose a "verify password without issuing a
      // session" API, so we re-authenticate with the provided current
      // password. If it matches, the session refreshes silently; if it
      // doesn't, we abort before calling updateUser.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: current,
      });
      if (signInError) {
        setFormError({
          message: 'Current password is incorrect.',
          fields: ['current'],
        });
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: next,
      });
      if (updateError) {
        setFormError({
          message: getErrorMessage(
            updateError,
            'Password could not be updated. Try again.'
          ),
          fields: [],
        });
        return;
      }

      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password updated');
    } catch (error) {
      setFormError({
        message: getErrorMessage(
          error,
          'Password could not be updated. Try again.'
        ),
        fields: [],
      });
    } finally {
      setSaving(false);
    }
  };

  const clearError = () => setFormError(null);
  const describes = (field: 'current' | 'next' | 'confirm') => {
    const ids =
      field === 'next' || field === 'confirm' ? ['password-help'] : [];
    if (formError?.fields.includes(field)) ids.push('password-error');
    return ids.length ? ids.join(' ') : undefined;
  };

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="password-heading">
      <Card>
        <CardHeader>
          <CardTitle id="password-heading" className="flex items-center gap-2">
            <KeyRound className="text-primary-text size-4" />
            Password
          </CardTitle>
          <CardDescription id="password-help">
            Use {MIN_PASSWORD} or more characters. You&apos;ll stay signed in
            here after the change.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                clearError();
              }}
              autoComplete="current-password"
              aria-invalid={formError?.fields.includes('current') || undefined}
              aria-describedby={describes('current')}
              disabled={saving}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  clearError();
                }}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                aria-invalid={formError?.fields.includes('next') || undefined}
                aria-describedby={describes('next')}
                disabled={saving}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  clearError();
                }}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                aria-invalid={
                  formError?.fields.includes('confirm') || undefined
                }
                aria-describedby={describes('confirm')}
                disabled={saving}
                required
              />
            </div>
          </div>

          {formError ? (
            <Alert id="password-error" variant="destructive">
              <CircleAlert />
              <AlertDescription>{formError.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>

        <CardFooter className="justify-end">
          <Button
            type="submit"
            disabled={
              saving || !profile?.email || !current || !next || !confirm
            }
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Updating…
              </>
            ) : (
              'Update password'
            )}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
