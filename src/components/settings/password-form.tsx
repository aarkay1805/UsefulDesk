'use client';

import { useState, type ComponentProps } from 'react';
import { toast } from 'sonner';
import { CircleAlert, Eye, EyeOff, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/hooks/use-auth';
import {
  validatePasswordChange,
  type PasswordChangeError,
} from '@/lib/auth/password-change';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

const MIN_PASSWORD = 8;

function PasswordInput({
  id,
  label,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Input>, 'id' | 'type'> & {
  id: string;
  label: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          className="pr-10"
          disabled={disabled}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    </div>
  );
}

export function PasswordForm({ onUpdated }: { onUpdated?: () => void }) {
  const { user } = useAuth();
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
    setFormError(null);
    setSaving(true);

    try {
      if (!user?.email) {
        setFormError({
          message: 'Your account email is unavailable. Refresh and try again.',
          fields: [],
        });
        return;
      }

      // Keep the existing explicit password proof even when the project's
      // optional server-side "require current password" switch is off.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current,
      });
      if (signInError) {
        setFormError({
          message: 'Current password is incorrect.',
          fields: ['current'],
        });
        return;
      }

      // Also send current_password in the mutation itself. Supabase validates
      // it server-side when that project protection is enabled.
      const { error: updateError } = await supabase.auth.updateUser({
        password: next,
        current_password: current,
      });
      if (updateError) {
        const currentPasswordFailed =
          updateError.code === 'invalid_credentials' ||
          updateError.code === 'reauthentication_not_valid';
        setFormError({
          message: currentPasswordFailed
            ? 'Current password is incorrect.'
            : getErrorMessage(
                updateError,
                'Password could not be updated. Try again.'
              ),
          fields: currentPasswordFailed ? ['current'] : [],
        });
        return;
      }

      setCurrent('');
      setNext('');
      setConfirm('');
      onUpdated?.();
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
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="change-password-heading"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 id="change-password-heading">Change password</h3>
          </CardTitle>
          <CardDescription id="password-help">
            Use {MIN_PASSWORD} or more characters. You&apos;ll stay signed in
            here after the change.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasswordInput
            id="current-password"
            label="Current password"
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PasswordInput
              id="new-password"
              label="New password"
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
            <PasswordInput
              id="confirm-password"
              label="Confirm new password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                clearError();
              }}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              aria-invalid={formError?.fields.includes('confirm') || undefined}
              aria-describedby={describes('confirm')}
              disabled={saving}
              required
            />
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
            disabled={saving || !user?.email || !current || !next || !confirm}
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
