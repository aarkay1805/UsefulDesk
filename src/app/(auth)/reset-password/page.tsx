'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { KeyRound, CheckCircle, ArrowLeft } from 'lucide-react';

// Landing page for the password-recovery flow. The user arrives
// here from /auth/callback?next=/reset-password after clicking
// the reset link in their email — at that point the callback has
// already exchanged the link for a recovery session and issued a
// short-lived, signed recovery grant. The server route below verifies
// that grant again before changing the password; a normal signed-in
// session is not sufficient.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [recoveryAllowed, setRecoveryAllowed] = useState<boolean | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/reset-password/update', {
          cache: 'no-store',
        });
        const body = (await response.json().catch(() => null)) as {
          allowed?: boolean;
        } | null;
        if (!cancelled) {
          setRecoveryAllowed(response.ok && body?.allowed === true);
        }
      } catch {
        if (!cancelled) setRecoveryAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    const response = await fetch('/reset-password/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? 'Password could not be updated. Try again.');
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
    // Recovery session is a full session — continue into the app.
    setTimeout(() => router.push('/dashboard'), 1500);
  };

  // ----- No recovery session: link expired or opened cold -----
  if (recoveryAllowed === false) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4">
        <Card className="border-border bg-card w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
              <KeyRound className="text-red-foreground h-6 w-6" />
            </div>
            <CardTitle className="text-foreground text-xl">
              Reset link expired
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              This password reset link is invalid or has expired. Request a new
              one to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/forgot-password">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 w-full">
                Request new link
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4">
        <Card className="border-border bg-card w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
              <CheckCircle className="text-primary-text h-6 w-6" />
            </div>
            <CardTitle className="text-foreground text-xl">
              Password updated
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Your password has been changed. Taking you to your dashboard…
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            <KeyRound className="text-primary-text h-6 w-6" />
          </div>
          <CardTitle className="text-foreground text-xl">
            Set new password
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Choose a new password for your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            {error && (
              <div className="text-red-foreground rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">
                New password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                className="border-border text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="confirmPassword"
                className="text-muted-foreground"
              >
                Confirm new password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                className="border-border text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading || recoveryAllowed === undefined}
              className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-10 w-full disabled:opacity-50"
            >
              {loading ? 'Updating...' : 'Update password'}
            </Button>
          </form>

          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground mt-6 flex items-center justify-center gap-2 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
