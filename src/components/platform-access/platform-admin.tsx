'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useLocale } from '@/hooks/use-locale';
import { timeInTzToUtc } from '@/lib/locale/format';
import type {
  AccessAction,
  AccessStatus,
  OrganizationAccess,
} from '@/lib/platform-access/model';
import { AccessStatusBadge } from './access-status-badge';
import { availableAccessActions, validAccessReason } from './ui-contract';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchInput } from '@/components/ui/search-input';
import { DatePicker } from '@/components/ui/date-picker';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

type Organization = {
  organization_id: string;
  name: string;
  owner_email: string | null;
  access: OrganizationAccess;
  status: AccessStatus;
};
type Audit = {
  id: string;
  action: AccessAction;
  reason: string;
  created_at: string;
  actor_user_id: string;
  before_state: OrganizationAccess;
  after_state: OrganizationAccess;
};
const actions: Record<AccessAction, string> = {
  extend_trial: 'Extend trial',
  activate: 'Activate access',
  suspend: 'Suspend',
  restore: 'Restore',
};
const authenticatorName = 'UsefulDesk platform administration';

export function PlatformAdmin({ mfaRequired }: { mfaRequired: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Platform administration</h1>
        <Button
          variant="ghost"
          loading={pending}
          onClick={async () => {
            setPending(true);
            try {
              const { error } = await createClient().auth.signOut();
              if (error) throw error;
              router.replace('/login');
            } catch (error) {
              toast.error(getErrorMessage(error, 'Could not sign out'));
              setPending(false);
            }
          }}
        >
          Sign out
        </Button>
      </header>
      {mfaRequired ? (
        <AdminMfa onVerified={() => router.refresh()} />
      ) : (
        <OrganizationList />
      )}
    </main>
  );
}
function AdminMfa({ onVerified }: { onVerified: () => void }) {
  const [factor, setFactor] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function begin() {
    setPending(true);
    setError('');
    try {
      const client = createClient();
      const { data: factors, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      const existing = factors.totp.find((f) => f.status === 'verified');
      if (existing) {
        setFactor(existing.id);
        return;
      }
      // Enrollment secrets cannot be retrieved after a reload. Replace only
      // unfinished registrations owned by this screen (including its old name).
      for (const unfinished of factors.all.filter(
        (f) =>
          f.factor_type === 'totp' &&
          f.status === 'unverified' &&
          (!f.friendly_name || f.friendly_name === authenticatorName)
      )) {
        const { error: resetError } = await client.auth.mfa.unenroll({
          factorId: unfinished.id,
        });
        if (resetError) throw resetError;
      }
      const { data, error: enrollError } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: authenticatorName,
      });
      if (enrollError) throw enrollError;
      // auth-js prefixes raw SVG with a data URI but leaves newlines and URL
      // delimiters unescaped. Encode the payload before giving it to Image.
      const svg = data.totp.qr_code.replace(/^data:image\/svg\+xml;utf-8,/, '');
      setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      setFactor(data.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start verification'));
    } finally {
      setPending(false);
    }
  }
  async function verify() {
    setPending(true);
    setError('');
    try {
      const { error } = await createClient().auth.mfa.challengeAndVerify({
        factorId: factor,
        code,
      });
      if (error) throw error;
      setQr('');
      setCode('');
      onVerified();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not verify code'));
      setPending(false);
    }
  }
  return (
    <Card className="max-w-lg">
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Verify your identity</AlertTitle>
          <AlertDescription>
            Platform administration requires an authenticator code. If you have
            no authenticator, the next step sets one up.
          </AlertDescription>
        </Alert>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!factor ? (
          <Button loading={pending} onClick={() => void begin()}>
            Continue with authenticator
          </Button>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            {qr ? (
              <>
                <p className="text-sm">
                  Scan this QR code with your authenticator app, then enter its
                  six-digit code.
                </p>
                <Image
                  src={qr}
                  alt="Authenticator enrollment QR code"
                  width={200}
                  height={200}
                  unoptimized
                />
              </>
            ) : null}
            <Label htmlFor="mfa-code">Authenticator code</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <Button
              type="submit"
              loading={pending}
              disabled={code.length !== 6}
            >
              Verify
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
function OrganizationList() {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{
    items: Organization[];
    total: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Organization | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setResult(null);
        setError('');
        try {
          const { data, error } = await createClient().rpc(
            'platform_admin_organizations',
            { p_search: search, p_limit: 25, p_offset: offset }
          );
          if (error) throw error;
          if (!cancelled) setResult(data);
        } catch (err) {
          if (!cancelled)
            setError(getErrorMessage(err, 'Could not load organizations'));
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, offset, nonce]);
  return (
    <div className="space-y-4">
      <SearchInput
        value={search}
        onValueChange={(value) => {
          setSearch(value);
          setOffset(0);
          setSelected(null);
        }}
        aria-label="Search organizations by name or owner email"
        placeholder="Search organizations"
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!result && !error ? <p role="status">Loading organizations…</p> : null}
      {result?.items.map((org) => (
        <Card key={org.organization_id}>
          <CardContent className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{org.name}</p>
              <p className="text-muted-foreground text-sm">
                {org.owner_email || 'No owner email'}
              </p>
            </div>
            <AccessStatusBadge status={org.status} />
            <Button variant="outline" onClick={() => setSelected(org)}>
              Manage access
            </Button>
          </CardContent>
        </Card>
      ))}
      {result?.items.length === 0 ? <p>No organizations found.</p> : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset === 0}
          onClick={() => {
            setOffset((n) => Math.max(0, n - 25));
            setSelected(null);
          }}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={!result || offset + 25 >= result.total}
          onClick={() => {
            setOffset((n) => n + 25);
            setSelected(null);
          }}
        >
          Next
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setSelected(null);
            setNonce((n) => n + 1);
          }}
        >
          Refresh
        </Button>
      </div>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          side="right"
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          <SheetHeader>
            <div className="min-w-0 pr-8">
              <SheetTitle>{selected?.name || 'Access details'}</SheetTitle>
              <SheetDescription>
                {selected?.owner_email || 'Organization access details'}
              </SheetDescription>
            </div>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-4 pb-4">
              {selected ? (
                <OrganizationEditor
                  key={`${selected.organization_id}:${selected.access?.version}`}
                  organization={selected}
                  onChanged={() => {
                    setSelected(null);
                    setNonce((n) => n + 1);
                  }}
                />
              ) : null}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
function OrganizationEditor({
  organization: org,
  onChanged,
}: {
  organization: Organization;
  onChanged: () => void;
}) {
  const { fmt, locale } = useLocale();
  const availableActions = availableAccessActions(org.access, org.status);
  const [action, setAction] = useState<AccessAction>(() =>
    availableActions.includes('activate') ? 'activate' : availableActions[0]
  );
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<Audit[] | null>(null);
  const [error, setError] = useState('');
  const needsDate = action === 'activate' || action === 'extend_trial';
  const endsAt =
    day && /^\d{2}:\d{2}$/.test(time)
      ? (timeInTzToUtc(day, time, locale.timeZone)?.toISOString() ?? null)
      : null;
  const currentEnd =
    org.access?.mode === 'trial'
      ? org.access.trial_ends_at
      : org.access?.access_ends_at;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await createClient().rpc(
          'platform_admin_access_history',
          { p_organization_id: org.organization_id }
        );
        if (error) throw error;
        if (!cancelled) setHistory(data || []);
      } catch (error) {
        if (!cancelled)
          setError(getErrorMessage(error, 'Could not load access history'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org.organization_id]);
  async function submit() {
    if (
      !validAccessReason(reason) ||
      !availableActions.includes(action) ||
      (needsDate && !endsAt)
    )
      return;
    setPending(true);
    setError('');
    try {
      const { error } = await createClient().rpc(
        'platform_admin_update_access',
        {
          p_organization_id: org.organization_id,
          p_action: action,
          p_ends_at: needsDate ? endsAt : null,
          p_reason: reason.trim(),
          p_expected_version: org.access.version,
        }
      );
      if (error) throw error;
      toast.success('Organization access updated');
      onChanged();
    } catch (err) {
      const message = getErrorMessage(err, 'Could not update access');
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Current access: <AccessStatusBadge status={org.status} />
            {currentEnd ? ` · Ends ${fmt.dateTime(currentEnd)}` : ''}
          </p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="access-action">Action</Label>
              <Select
                value={action}
                onValueChange={(value) =>
                  value && setAction(value as AccessAction)
                }
              >
                <SelectTrigger id="access-action" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(actions)
                    .filter(([key]) =>
                      availableActions.includes(key as AccessAction)
                    )
                    .map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {needsDate ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="access-date">Access ends on</Label>
                  <DatePicker
                    id="access-date"
                    value={day}
                    onChange={setDay}
                    min={fmt.today()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="access-time">Time ({locale.timeZone})</Label>
                  <Input
                    id="access-time"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="access-reason">Reason</Label>
              <Textarea
                id="access-reason"
                required
                minLength={3}
                maxLength={1000}
                aria-describedby="access-reason-help"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p
                id="access-reason-help"
                className="text-muted-foreground text-sm"
              >
                Use 3–1,000 characters, excluding surrounding spaces.
              </p>
            </div>
            <Alert>
              <AlertDescription>
                {needsDate
                  ? endsAt
                    ? `Access will end exactly at ${fmt.dateTime(endsAt)} (${locale.timeZone}).`
                    : 'Choose the exact date and time access should end.'
                  : action === 'restore'
                    ? 'Restore removes suspension. It does not extend an expired trial or access term.'
                    : 'Suspend blocks operational access immediately for every branch and staff member.'}
              </AlertDescription>
            </Alert>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {error} Refresh organizations to reload the latest access
                  before retrying a stale change.
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="submit"
              variant={action === 'suspend' ? 'destructive' : 'default'}
              loading={pending}
              disabled={
                !validAccessReason(reason) ||
                (needsDate && !endsAt) ||
                !org.access
              }
            >
              {actions[action]}
            </Button>
          </form>
        </CardContent>
      </Card>
      <h3 className="font-semibold">Access history</h3>
      {history === null ? (
        <p role="status">Loading history…</p>
      ) : history.length === 0 ? (
        <p>No access changes recorded.</p>
      ) : (
        history.map((event) => (
          <Card key={event.id}>
            <CardContent className="space-y-2">
              <p className="font-medium">
                {actions[event.action] || event.action} ·{' '}
                {fmt.dateTime(event.created_at)}
              </p>
              <p>{event.reason}</p>
              <p className="text-muted-foreground text-sm">
                Administrator: {event.actor_user_id}
              </p>
              {(
                [
                  ['Before', event.before_state],
                  ['After', event.after_state],
                ] as const
              ).map(([label, state]) => {
                const end =
                  state?.mode === 'trial'
                    ? state.trial_ends_at
                    : state?.access_ends_at;
                return (
                  <p className="text-sm" key={label}>
                    {label}: {state?.mode || 'No access'}
                    {state?.suspended_at ? ' · Suspended' : ' · Not suspended'}
                    {end ? ` · Ends ${fmt.dateTime(end)}` : ''}
                  </p>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}
    </section>
  );
}

export function PlatformAdminSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-lg font-semibold">Platform administrator sign in</h1>
      <Card>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError('');
              try {
                const { error } = await createClient().auth.signInWithPassword({
                  email,
                  password,
                });
                if (error) throw error;
                // A fresh request carries newly written auth cookies through the proxy.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign('/platform-admin');
              } catch (err) {
                setError(getErrorMessage(err, 'Could not sign in'));
                setPending(false);
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" loading={pending}>
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
