'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { normalizeSignupFullName } from '@/lib/auth/signup';
import {
  invitationJoinPath,
  normalizeInvitationToken,
  withInvitation,
} from '@/lib/auth/invitation-continuation';
import { createClient } from '@/lib/supabase/client';
import {
  COUNTRY_OPTIONS,
  presetFor,
  toAccountColumns,
} from '@/lib/locale/config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MessageSquare, CheckCircle, UsersRound } from 'lucide-react';
import { GoogleAuthButton } from '@/components/auth/google-auth-button';

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points at /auth/callback with next=/join/<token> so the user
  // lands on the redeem step after verifying instead of /dashboard.
  const inviteToken = normalizeInvitationToken(searchParams.get('invite'));

  const [fullName, setFullName] = useState('');
  const [country, setCountry] = useState('IN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedFullName = normalizeSignupFullName(fullName);
    if (!trimmedFullName) {
      setError('Enter your full name');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    // Always send the verification email through /auth/callback —
    // it exchanges the ?code / token_hash for a session and then
    // forwards to `next`. Without an explicit emailRedirectTo,
    // Supabase falls back to the project Site URL, and the root
    // page's redirect('/dashboard') strips the ?code param before
    // the client can exchange it, so the user lands on /login with
    // no session despite being verified.
    const next = invitationJoinPath(inviteToken) ?? '/dashboard';
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    // The country picker resolves to a full localization preset
    // client-side; handle_new_user (migration 055) reads these keys
    // (regex-guarded) into the new account's localization columns.
    // Invitees who end up joining another account simply leave their
    // auto-created personal account carrying these defaults.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: trimmedFullName,
          ...toAccountColumns(presetFor(country)),
        },
        emailRedirectTo,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4">
        <Card className="border-border bg-card w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
              <CheckCircle className="text-primary-text h-6 w-6" />
            </div>
            <CardTitle className="text-foreground text-xl">
              Check your email
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              We&apos;ve sent a confirmation link to{' '}
              <span className="text-foreground">{email}</span>. Please check
              your inbox and click the link to verify your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={withInvitation('/login', inviteToken)}>
              <Button
                variant="outline"
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground w-full"
              >
                Back to sign in
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            {inviteToken ? (
              <UsersRound className="text-primary-text h-6 w-6" />
            ) : (
              <MessageSquare className="text-primary-text h-6 w-6" />
            )}
          </div>
          <CardTitle className="text-foreground text-xl">
            {inviteToken ? 'Create account & join' : 'Create account'}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {inviteToken
              ? 'Verify your email, then accept the invitation to join your team.'
              : 'Get started with UsefulDesk'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GoogleAuthButton
            inviteToken={inviteToken}
            onErrorChange={setError}
          />

          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && (
              <div className="text-red-foreground rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-muted-foreground">
                Full name
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="border-border text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="country" className="text-muted-foreground">
                Where is your business?
              </Label>
              <Select value={country} onValueChange={(v) => v && setCountry(v)}>
                <SelectTrigger id="country" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Sets your currency, time zone, and date formats — you can change
                any of it later in Settings.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-border text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="confirmPassword"
                className="text-muted-foreground"
              >
                Confirm password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="border-border text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              loading={loading}
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-10 w-full disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </Button>
          </form>

          <p className="text-muted-foreground mt-6 text-center text-sm">
            Already have an account?{' '}
            <Link
              href={withInvitation('/login', inviteToken)}
              className="text-primary-text hover:text-primary-text/80"
            >
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
