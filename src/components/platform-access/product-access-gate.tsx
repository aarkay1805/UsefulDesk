'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import {
  resolveProductAccess,
  isProductAccessSnapshot,
  type ProductAccessSnapshot,
} from '@/lib/platform-access/model';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { accessSupportMessage, accessSupportWhatsApp } from './ui-contract';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

export function ProductAccessGate({ children }: { children: ReactNode }) {
  const { accountId, accountStatus, branchAccessError } = useAuth();
  // Hydration and branch errors retain their existing recovery surface.
  if (accountStatus !== 'ready' || !accountId || branchAccessError)
    return children;
  return (
    <AccountProductAccess key={accountId} accountId={accountId}>
      {children}
    </AccountProductAccess>
  );
}
function AccountProductAccess({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const { branches, switchBranch, signOut, account, organizationId } =
    useAuth();
  const { fmt } = useLocale();
  const router = useRouter();
  const wasBlocked = useRef(false);
  const [snapshot, setSnapshot] = useState<ProductAccessSnapshot | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [checking, setChecking] = useState(true);
  const [now, setNow] = useState(0);
  const [pending, setPending] = useState('');
  const [requested, setRequested] = useState(false);
  const organizationName =
    branches.find((branch) => branch.account_id === accountId)
      ?.organization_name ||
    account?.name ||
    'your organization';
  const supportReference = snapshot?.access.organization_id || accountId;
  const supportMessage = accessSupportMessage(
    organizationName,
    supportReference
  );
  const whatsappHref = snapshot?.support_whatsapp
    ? accessSupportWhatsApp(snapshot.support_whatsapp, supportMessage)
    : null;
  const emailHref = snapshot?.support_email
    ? `mailto:${snapshot.support_email}?subject=${encodeURIComponent('UsefulDesk access support')}&body=${encodeURIComponent(supportMessage)}`
    : null;
  const requestSupport = () =>
    act('support', async () => {
      const { error } = await createClient().rpc(
        'product_access_request_support',
        { p_account_id: accountId, p_message: supportMessage }
      );
      if (error) throw error;
      setRequested(true);
      toast.success('Support request received');
    });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setChecking(true);
      try {
        const { data, error } = await createClient().rpc(
          'product_access_for_account',
          { p_account_id: accountId }
        );
        if (error) throw error;
        if (!organizationId || !isProductAccessSnapshot(data, organizationId))
          throw new Error('Could not confirm product access');
        if (!cancelled) {
          setSnapshot(data);
          setError('');
          setNow(Date.now());
          const nextAllowed =
            data.allowed === true &&
            (data.enforcement_enabled === false ||
              resolveProductAccess(data.access, Date.now()).allowed);
          if (nextAllowed && wasBlocked.current) {
            wasBlocked.current = false;
            router.refresh();
          }
        }
      } catch (err) {
        if (!cancelled) {
          setSnapshot(null);
          setError(getErrorMessage(err, 'Could not confirm product access'));
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, organizationId, nonce, router]);
  useEffect(() => {
    const refresh = () => {
      setNow(Date.now());
      setNonce((n) => n + 1);
    };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, []);
  const deadline =
    snapshot?.access?.mode === 'trial'
      ? snapshot.access.trial_ends_at
      : snapshot?.access?.access_ends_at;
  useEffect(() => {
    if (!deadline) return;
    const delay = Date.parse(deadline) - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(
      () => {
        setNow(Date.now());
        setNonce((n) => n + 1);
      },
      Math.min(delay, 2_147_483_647)
    );
    return () => window.clearTimeout(timer);
  }, [deadline]);
  const resolved = snapshot?.access
    ? resolveProductAccess(snapshot.access, now)
    : null;
  const allowed =
    snapshot &&
    snapshot.access.organization_id === organizationId &&
    snapshot.allowed === true &&
    (snapshot.enforcement_enabled === false ||
      (snapshot.enforcement_enabled === true && resolved?.allowed === true));
  useEffect(() => {
    if (!allowed && (!checking || snapshot !== null)) wasBlocked.current = true;
  }, [allowed, checking, snapshot]);
  async function act(name: string, fn: () => Promise<unknown>) {
    setPending(name);
    try {
      await fn();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not complete the request'));
    } finally {
      setPending('');
    }
  }
  if (allowed)
    return (
      <div className="flex h-screen flex-col">
        {resolved?.status === 'trial' && deadline ? (
          <Alert>
            <AlertDescription>
              Trial:{' '}
              {Math.max(
                1,
                Math.ceil((Date.parse(deadline) - now) / 86_400_000)
              )}{' '}
              days remaining · Ends {fmt.dateTime(deadline)}
              <div className="mt-2">
                {whatsappHref || emailHref ? (
                  <a
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                    })}
                    href={whatsappHref || emailHref!}
                    target={whatsappHref ? '_blank' : undefined}
                    rel={whatsappHref ? 'noreferrer' : undefined}
                  >
                    Contact support
                  </a>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={pending === 'support'}
                    disabled={requested}
                    onClick={() => void requestSupport()}
                  >
                    {requested ? 'Support request received' : 'Contact support'}
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    );
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>
              {checking && !snapshot && !error
                ? 'Checking access…'
                : 'Contact support'}
            </AlertTitle>
            <AlertDescription>
              {error ||
                (resolved?.status === 'suspended'
                  ? 'Your organization’s access is suspended. Contact support to restore access.'
                  : resolved?.status === 'expired'
                    ? 'Your organization’s access has ended. Contact support to continue using UsefulDesk.'
                    : 'We are confirming your organization’s access.')}
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            {snapshot?.support_email ? (
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={emailHref!}
              >
                Email support
              </a>
            ) : null}
            {snapshot?.support_whatsapp ? (
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={whatsappHref!}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp support
              </a>
            ) : null}
            {!snapshot?.support_email && !snapshot?.support_whatsapp ? (
              <Button
                loading={pending === 'support'}
                disabled={requested}
                onClick={() => void requestSupport()}
              >
                {requested ? 'Support request received' : 'Request support'}
              </Button>
            ) : null}
            <Button
              variant="outline"
              loading={checking}
              onClick={() => setNonce((n) => n + 1)}
            >
              Check again
            </Button>
            <Button
              variant="ghost"
              loading={pending === 'signout'}
              onClick={() => void act('signout', signOut)}
            >
              Sign out
            </Button>
          </div>
          {branches.length > 1 ? (
            <div className="space-y-2">
              <Label htmlFor="access-branch">
                Switch organization or branch
              </Label>
              <Select
                value={accountId}
                disabled={pending === 'branch'}
                onValueChange={(id) => {
                  if (id && id !== accountId)
                    void act('branch', () => switchBranch(id));
                }}
              >
                <SelectTrigger id="access-branch" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branches
                    .filter((b) => b.branch_status !== 'archived')
                    .map((b) => (
                      <SelectItem key={b.account_id} value={b.account_id}>
                        {b.organization_name} · {b.account_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
