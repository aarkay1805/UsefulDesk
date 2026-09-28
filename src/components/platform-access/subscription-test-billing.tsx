'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import {
  isSubscriptionTier,
  SUBSCRIPTION_PLANS,
  type SubscriptionTier,
} from '@/lib/subscriptions/plans';
import { openUsefulDeskTestCheckout } from '@/lib/subscriptions/test-checkout-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SettingsSectionHead } from '@/components/settings/settings-panel-head';
import { SubscriptionPlanCards } from './subscription-plan-cards';

type Billing = {
  organization_id: string;
  grant: {
    tier: SubscriptionTier;
    paid_through_end: string;
    refund_confirmed_at: string | null;
    renewal_stopped_at: string | null;
  } | null;
  change: {
    target_tier: SubscriptionTier | null;
    source_period_end: string;
  } | null;
  claim: { amount_minor: number } | null;
  refund: {
    provider_status: 'pending' | 'failed' | 'processed' | null;
    confirmed_at: string | null;
  } | null;
  payments: Array<{
    amount_minor: number;
    verified_at: string;
    provider_payment_id: string;
  }>;
  refunds_enabled: boolean;
};
async function post(path: string, body: object) {
  const response = await fetch(`/api/subscriptions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || 'Could not save. Try again.');
  return result;
}
/** Mounted only behind the non-Production UI flag and organization-owner gate. */
export function SubscriptionTestBilling({
  organizationId,
  accountId,
  onChanged,
}: {
  organizationId: string;
  accountId: string;
  onChanged: () => void;
}) {
  const { fmt } = useLocale();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [pending, setPending] = useState('');
  const [confirm, setConfirm] = useState<'refund' | 'cancel' | null>(null);
  const [interest, setInterest] = useState<SubscriptionTier | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/subscriptions/test-billing?organizationId=${encodeURIComponent(organizationId)}`,
          { cache: 'no-store' }
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || 'Could not load billing. Try again.');
        const row = data.billing as Billing;
        if (
          row?.organization_id !== organizationId ||
          !Array.isArray(row.payments) ||
          (row.grant &&
            (!isSubscriptionTier(row.grant.tier) ||
              !Number.isFinite(Date.parse(row.grant.paid_through_end))))
        )
          throw new Error('Could not check your billing. Try again.');
        if (!cancelled) {
          setBilling(row);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setBilling(null);
          setError(getErrorMessage(err, 'Could not load billing. Try again.'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, nonce]);
  async function act(action: string, work: () => Promise<void>) {
    setPending(action);
    try {
      await work();
      setNonce((n) => n + 1);
      onChanged();
    } catch (err) {
      toast.error(
        getErrorMessage(err, 'Could not complete the request. Try again.')
      );
      setNonce((n) => n + 1);
    } finally {
      setPending('');
      setConfirm(null);
    }
  }
  async function renew() {
    const result = await post('test-renewals', {
      organizationId,
      accountId,
      requestId: crypto.randomUUID(),
    });
    const checkout = result.checkout;
    await openUsefulDeskTestCheckout({
      ...checkout,
      planLabel: SUBSCRIPTION_PLANS[checkout.tier as SubscriptionTier].label,
      onPayment: (payment) =>
        void act('confirm-payment', async () => {
          await post('test-confirm', {
            organizationId,
            requestId: checkout.requestId,
            orderId: payment.razorpay_order_id,
            paymentId: payment.razorpay_payment_id,
            signature: payment.razorpay_signature,
          });
          toast.success('Test payment confirmed');
        }),
    });
  }
  const data = billing?.organization_id === organizationId ? billing : null;
  const grant = data?.grant;
  const refunded = !!grant?.refund_confirmed_at;
  return (
    <div className="space-y-4" aria-label="Test subscription billing">
      <Alert>
        <AlertTitle>Test billing</AlertTitle>
        <AlertDescription>
          Test payments only. No live charges or refunds.
        </AlertDescription>
      </Alert>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : !data ? (
        <p role="status">Loading billing…</p>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        loading={pending === 'refresh'}
        disabled={!!pending}
        onClick={() => void act('refresh', async () => {})}
      >
        Check billing
      </Button>
      {grant ? (
        <section className="space-y-3" aria-labelledby="test-plan-heading">
          <SettingsSectionHead
            id="test-plan-heading"
            title={`${SUBSCRIPTION_PLANS[grant.tier].label} plan`}
          />
          <Card>
            <CardContent className="space-y-3">
              <p className="text-sm">
                {refunded
                  ? `Full refund confirmed on ${fmt.dateTime(grant.refund_confirmed_at!)}. Paid access has ended.`
                  : `Paid through ${fmt.dateTime(grant.paid_through_end)}.`}
              </p>
              {data?.change && !refunded ? (
                <p className="text-muted-foreground text-sm">
                  {data.change.target_tier === null
                    ? 'Renewal is cancelled. Your paid term stays available until its end.'
                    : `${SUBSCRIPTION_PLANS[data.change.target_tier].label} is scheduled for renewal.`}
                </p>
              ) : null}
              {!refunded &&
              !data?.change &&
              Date.parse(grant.paid_through_end) > Date.now() ? (
                <Button
                  variant="outline"
                  disabled={!!pending}
                  onClick={() => setConfirm('cancel')}
                >
                  Cancel renewal
                </Button>
              ) : null}
              {!refunded &&
              !grant.renewal_stopped_at &&
              data?.change?.target_tier !== null &&
              Date.parse(grant.paid_through_end) <= Date.now() ? (
                <Button
                  loading={pending === 'renew'}
                  disabled={!!pending}
                  onClick={() => void act('renew', renew)}
                >
                  Renew Test plan
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : data ? (
        <p>No Test plan is active for this gym.</p>
      ) : null}
      {grant && !refunded ? (
        <section className="space-y-3" aria-labelledby="test-refund-heading">
          <SettingsSectionHead
            id="test-refund-heading"
            title="First-payment refund"
            description="A full refund can be requested through day seven, once per gym."
          />
          <Card>
            <CardContent className="space-y-3">
              {data?.refund ? (
                <p className="text-sm">
                  {data.refund.provider_status === 'failed'
                    ? 'The Test refund failed. Contact support; another refund will not be issued automatically.'
                    : 'The Test refund is being checked. Access ends only after the full refund is confirmed.'}
                </p>
              ) : data?.claim ? (
                <p className="text-sm">
                  Full Test refund:{' '}
                  <span className="tabular-nums">
                    {fmt.money(data.claim.amount_minor / 100, 'INR')}
                  </span>
                  .
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  We will check your first payment and save the time of your
                  request.
                </p>
              )}
              {!data?.claim ? (
                <Button
                  variant="outline"
                  loading={pending === 'eligibility'}
                  disabled={!!pending}
                  onClick={() =>
                    void act('eligibility', async () => {
                      await post('test-refund-claims', {
                        organizationId,
                        requestId: crypto.randomUUID(),
                      });
                    })
                  }
                >
                  Check refund eligibility
                </Button>
              ) : data.refunds_enabled ? (
                <Button
                  variant="outline"
                  loading={pending === 'refund'}
                  disabled={!!pending}
                  onClick={() =>
                    data.refund
                      ? void act('refund', async () => {
                          await post('test-refunds', { organizationId });
                        })
                      : setConfirm('refund')
                  }
                >
                  {data.refund ? 'Check refund status' : 'Refund Test payment'}
                </Button>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Test refund execution is not enabled. Contact support.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}
      {refunded ? (
        <section className="space-y-3" aria-labelledby="test-recovery-heading">
          <SettingsSectionHead
            id="test-recovery-heading"
            title="Choose a plan to return"
            description="Your gym data is saved. Contact support to restart paid access."
          />
          <SubscriptionPlanCards
            formatMoney={fmt.money}
            onSelect={setInterest}
          />
          {interest ? (
            <p role="status">
              {SUBSCRIPTION_PLANS[interest].label} selected. Ask support to
              restart with this plan. Selecting it does not start a payment or
              trial.
            </p>
          ) : null}
        </section>
      ) : null}
      {data?.payments.length ? (
        <section className="space-y-3" aria-labelledby="test-history-heading">
          <SettingsSectionHead
            id="test-history-heading"
            title="Recent Test payments"
          />
          <Table>
            <TableHeader>
              <TableRow interactive={false}>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payments.map((payment) => (
                <TableRow key={payment.provider_payment_id} interactive={false}>
                  <TableCell>{fmt.dateTime(payment.verified_at)}</TableCell>
                  <TableCell>
                    <span className="tabular-nums">
                      {fmt.money(payment.amount_minor / 100, 'INR')}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'refund'
                ? 'Refund the full Test payment?'
                : 'Cancel the next renewal?'}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'refund' ? (
                <>
                  Refund{' '}
                  <span className="tabular-nums">
                    {fmt.money((data?.claim?.amount_minor ?? 0) / 100, 'INR')}
                  </span>
                  . Paid access ends after confirmation and renewal stops. Your
                  gym data and sign-in are kept.
                </>
              ) : (
                'Keep access through the paid-through date. No next renewal or payment grace will start.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!pending}
              onClick={() => setConfirm(null)}
            >
              Keep plan
            </Button>
            <Button
              loading={pending === confirm}
              disabled={!!pending}
              onClick={() =>
                void act(confirm!, async () => {
                  if (confirm === 'refund')
                    await post('test-refunds', { organizationId });
                  else
                    await post('renewal-change', {
                      organizationId,
                      requestId: crypto.randomUUID(),
                      targetTier: null,
                      archiveAccountIds: [],
                    });
                })
              }
            >
              {confirm === 'refund' ? 'Refund Test payment' : 'Cancel renewal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
