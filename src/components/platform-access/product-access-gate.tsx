'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
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
import { SubscriptionPlanCards } from './subscription-plan-cards';
import {
  SubscriptionConversionReviewDialog,
  type ConversionReviewBranch,
} from './subscription-conversion-review-dialog';
import {
  countActiveBranches,
  SUBSCRIPTION_PLANS,
  type SubscriptionTier,
} from '@/lib/subscriptions/plans';
import { openUsefulDeskTestCheckout } from '@/lib/subscriptions/test-checkout-client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

export interface InitialProductAccess {
  accountId: string;
  organizationId: string;
  snapshot: ProductAccessSnapshot;
}

export function ProductAccessGate({
  children,
  initialAccess = null,
}: {
  children: ReactNode;
  initialAccess?: InitialProductAccess | null;
}) {
  const { accountId, accountStatus, branchAccessError } = useAuth();
  // Hydration and branch errors retain their existing recovery surface.
  if (accountStatus !== 'ready' || !accountId || branchAccessError)
    return children;
  return (
    <AccountProductAccess
      key={accountId}
      accountId={accountId}
      initialAccess={initialAccess}
    >
      {children}
    </AccountProductAccess>
  );
}
function AccountProductAccess({
  accountId,
  children,
  initialAccess,
}: {
  accountId: string;
  children: ReactNode;
  initialAccess: InitialProductAccess | null;
}) {
  const {
    branches,
    switchBranch,
    signOut,
    account,
    organizationId,
    isOrganizationOwner,
  } = useAuth();
  const { fmt } = useLocale();
  const router = useRouter();
  const wasBlocked = useRef(false);
  const initialSnapshot =
    initialAccess?.accountId === accountId &&
    initialAccess.organizationId === organizationId &&
    isProductAccessSnapshot(initialAccess.snapshot, organizationId)
      ? initialAccess.snapshot
      : null;
  const skipInitialRevalidation = useRef(initialSnapshot !== null);
  const [snapshot, setSnapshot] = useState<ProductAccessSnapshot | null>(
    initialSnapshot
  );
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [checking, setChecking] = useState(initialSnapshot === null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState('');
  const [requested, setRequested] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [reviewTier, setReviewTier] = useState<SubscriptionTier | null>(null);
  const [conversionBranches, setConversionBranches] = useState<
    ConversionReviewBranch[] | null
  >(null);
  const [pendingTier, setPendingTier] = useState<SubscriptionTier | null>(null);
  const lastIntent = useRef<{
    tier: SubscriptionTier;
    requestId: string;
  } | null>(null);
  const testUi =
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_USEFULDESK_TEST_BILLING_UI === 'true';
  const organizationName =
    branches.find((branch) => branch.account_id === accountId)
      ?.organization_name ||
    account?.name ||
    'your gym';
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
    if (skipInitialRevalidation.current) {
      skipInitialRevalidation.current = false;
      return;
    }
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
          throw new Error(
            'Could not check your access. Check your internet and try again.'
          );
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
          setError(
            getErrorMessage(
              err,
              'Could not check your access. Check your internet and try again.'
            )
          );
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
  const expiredTrial =
    resolved?.status === 'expired' && snapshot?.access.mode === 'trial';
  useEffect(() => {
    if (!expiredTrial || !testUi || !isOrganizationOwner || !organizationId)
      return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await createClient().rpc(
        'subscription_conversion_branches',
        { p_organization_id: organizationId }
      );
      if (cancelled) return;
      if (error || !Array.isArray(data)) {
        setConversionBranches(null);
        return;
      }
      const valid = data.every(
        (row): row is ConversionReviewBranch =>
          row !== null &&
          typeof row === 'object' &&
          typeof row.account_id === 'string' &&
          typeof row.account_name === 'string' &&
          row.organization_id === organizationId &&
          (row.branch_status === 'active' || row.branch_status === 'archived')
      );
      setConversionBranches(valid ? data : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [expiredTrial, testUi, isOrganizationOwner, organizationId]);
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
      toast.error(
        getErrorMessage(err, 'Could not complete the request. Try again.')
      );
    } finally {
      setPending('');
    }
  }
  async function postTest(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(
        typeof result.error === 'string'
          ? result.error
          : 'Could not continue. Try again.'
      );
    return result;
  }
  function chooseTestPlan(tier: SubscriptionTier) {
    if (!organizationId || !isOrganizationOwner || !testUi) return;
    if (!conversionBranches) {
      toast.error('Could not check your branches. Try again.');
      return;
    }
    if (
      countActiveBranches(conversionBranches, organizationId) >
      SUBSCRIPTION_PLANS[tier].includedBranches
    ) {
      setReviewTier(tier);
      return;
    }
    setPendingTier(tier);
    void (async () => {
      try {
        const requestId =
          lastIntent.current?.tier === tier
            ? lastIntent.current.requestId
            : crypto.randomUUID();
        lastIntent.current = { tier, requestId };
        await postTest('/api/subscriptions/monthly-intents', {
          organizationId,
          accountId,
          requestId,
          tier,
        });
        const result = await postTest('/api/subscriptions/test-orders', {
          organizationId,
          requestId,
        });
        const checkout = result.checkout as {
          keyId: string;
          orderId: string;
          amountMinor: number;
        };
        await openUsefulDeskTestCheckout({
          keyId: checkout.keyId,
          orderId: checkout.orderId,
          amountMinor: checkout.amountMinor,
          planLabel: SUBSCRIPTION_PLANS[tier].label,
          onPayment: (payment) => {
            void (async () => {
              try {
                await postTest('/api/subscriptions/test-confirm', {
                  organizationId,
                  requestId,
                  orderId: payment.razorpay_order_id,
                  paymentId: payment.razorpay_payment_id,
                  signature: payment.razorpay_signature,
                });
                toast.success('Test payment confirmed');
                setNonce((n) => n + 1);
                router.refresh();
              } catch (error) {
                toast.error(
                  getErrorMessage(
                    error,
                    'Payment is not confirmed yet. Check again.'
                  )
                );
              }
            })();
          },
        });
      } catch (error) {
        toast.error(
          getErrorMessage(error, 'Could not open Test payment. Try again.')
        );
      } finally {
        setPendingTier(null);
      }
    })();
  }
  async function archiveSelectedBranches(accountIds: readonly string[]) {
    if (!organizationId) return;
    try {
      await postTest('/api/subscriptions/archive-for-plan', {
        organizationId,
        accountIds,
      });
      toast.success('Branches archived');
      window.location.reload();
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Could not archive branches. Try again.')
      );
    }
  }
  if (checking && !snapshot && !error)
    return (
      <main
        className="flex min-h-screen items-center justify-center"
        role="status"
        aria-label="Loading UsefulDesk"
      >
        <Loader2
          className="text-muted-foreground size-6 animate-spin"
          aria-hidden="true"
        />
      </main>
    );
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
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPlansOpen(true)}
                >
                  Compare plans
                </Button>
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
        <Dialog open={plansOpen} onOpenChange={setPlansOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Compare plans</DialogTitle>
              <DialogDescription>
                Your trial includes features from every plan. Choose a plan
                after the trial.
              </DialogDescription>
            </DialogHeader>
            <SubscriptionPlanCards formatMoney={fmt.money} />
            <p className="text-muted-foreground text-sm">
              Plan prices and payment are not available yet. Contact support for
              help.
            </p>
          </DialogContent>
        </Dialog>
      </div>
    );
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className={expiredTrial ? 'w-full max-w-5xl' : 'w-full max-w-xl'}>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>Contact support</AlertTitle>
            <AlertDescription>
              {error ||
                (resolved?.status === 'suspended'
                  ? 'Your organization’s access is suspended. Contact support to restore access.'
                  : resolved?.status === 'expired'
                    ? 'Your trial or access term has ended. Compare plans and contact support to continue.'
                    : 'We are confirming your organization’s access.')}
            </AlertDescription>
          </Alert>
          {expiredTrial ? (
            <>
              <SubscriptionPlanCards
                formatMoney={fmt.money}
                showProvisionalPrices={testUi}
                onSelect={
                  testUi && isOrganizationOwner ? chooseTestPlan : undefined
                }
                pendingTier={pendingTier}
              />
              {!testUi ? (
                <p className="text-muted-foreground text-sm">
                  Plan prices and payment are not available yet. Contact support
                  for help.
                </p>
              ) : null}
              {reviewTier && organizationId ? (
                <SubscriptionConversionReviewDialog
                  open
                  onOpenChange={(open) => {
                    if (!open) setReviewTier(null);
                  }}
                  organizationId={organizationId}
                  organizationRole={isOrganizationOwner ? 'owner' : null}
                  tier={reviewTier}
                  branches={conversionBranches ?? []}
                  purchases={[]}
                  keepAccountId={accountId}
                  onArchive={archiveSelectedBranches}
                />
              ) : null}
            </>
          ) : null}
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
              <Label htmlFor="access-branch">Switch gym brand or branch</Label>
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
