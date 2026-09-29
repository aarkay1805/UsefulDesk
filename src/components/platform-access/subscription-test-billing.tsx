'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import {
  isSubscriptionTier,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_TIERS,
  type SubscriptionTier,
} from '@/lib/subscriptions/plans';
import { openUsefulDeskTestCheckout } from '@/lib/subscriptions/test-checkout-client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
    current_term_refunded_at: string | null;
    term_generation: number;
    renewal_stopped_at: string | null;
  } | null;
  change: {
    target_tier: SubscriptionTier | null;
    source_period_end: string;
    archive_account_ids: string[];
  } | null;
  claim: { amount_minor: number } | null;
  refund: {
    provider_status: 'pending' | 'failed' | 'processed' | null;
    confirmed_at: string | null;
    review_required_at?: string | null;
  } | null;
  payments: Array<{
    amount_minor: number;
    verified_at: string;
    provider_payment_id: string;
  }>;
  refunds_enabled: boolean;
  advanced_available: boolean;
  active_branches: Array<{ id: string; name: string; owned: boolean }>;
  paid_slots: Array<{ id: string; paid_through_end: string }>;
  slot_renewal_review: {
    request_id: string;
    cancel_slot_ids: string[];
    archive_account_ids: string[];
  } | null;
  starter_reminder_policy: {
    version: string;
    days_before: number[];
    hour_local: number;
  } | null;
};
type AdvancedQuote = {
  organizationId: string;
  requestId: string;
  kind: 'upgrade' | 'addon_purchase' | 'restart';
  tier: SubscriptionTier;
  amountMinor: number;
  currency: 'INR';
  expiresAt: string;
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
  const [archiveIds, setArchiveIds] = useState<string[]>([]);
  const [cancelSlotIds, setCancelSlotIds] = useState<string[]>([]);
  const [acceptStarterReset, setAcceptStarterReset] = useState(false);
  const [quote, setQuote] = useState<AdvancedQuote | null>(null);
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
          const confirmation = await post('test-confirm', {
            organizationId,
            requestId: checkout.requestId,
            orderId: payment.razorpay_order_id,
            paymentId: payment.razorpay_payment_id,
            signature: payment.razorpay_signature,
          });
          if (confirmation.result?.status === 'review_required') {
            toast.error('Payment needs a check. Contact support.');
            return;
          }
          toast.success('Test payment confirmed');
        }),
    });
  }
  async function reviewAdvanced(
    kind: AdvancedQuote['kind'],
    targetTier: SubscriptionTier
  ) {
    const requestId = crypto.randomUUID();
    await post('advanced-reviews', {
      organizationId,
      accountId,
      requestId,
      kind,
      targetTier,
      requestedSlots: kind === 'addon_purchase' ? 1 : 0,
      archiveAccountIds: kind === 'restart' ? archiveIds : [],
      starterReminderResetAccepted:
        targetTier === 'starter' && acceptStarterReset,
      starterReminderPolicyVersion:
        targetTier === 'starter' && acceptStarterReset
          ? (billing?.starter_reminder_policy?.version ?? null)
          : null,
    });
    const result = await post('advanced-quotes', {
      organizationId,
      accountId,
      requestId,
    });
    const next = result.quote as AdvancedQuote;
    if (
      next.organizationId !== organizationId ||
      next.requestId !== requestId ||
      next.kind !== kind ||
      next.tier !== targetTier ||
      !Number.isSafeInteger(next.amountMinor) ||
      next.amountMinor < 1 ||
      Date.parse(next.expiresAt) <= Date.now()
    )
      throw new Error('Could not check the Test amount. Try again.');
    setQuote(next);
  }
  async function payAdvanced() {
    if (!quote || Date.parse(quote.expiresAt) <= Date.now())
      throw new Error('This Test amount expired. Review it again.');
    const result = await post('advanced-orders', {
      organizationId,
      requestId: quote.requestId,
      kind: quote.kind,
    });
    const checkout = result.checkout;
    await openUsefulDeskTestCheckout({
      ...checkout,
      planLabel: SUBSCRIPTION_PLANS[quote.tier].label,
      onPayment: (payment) =>
        void act('confirm-payment', async () => {
          const confirmation = await post('test-confirm', {
            organizationId,
            requestId: quote.requestId,
            orderId: payment.razorpay_order_id,
            paymentId: payment.razorpay_payment_id,
            signature: payment.razorpay_signature,
          });
          if (confirmation.result?.status === 'review_required') {
            setQuote(null);
            toast.error('Payment needs a check. Contact support.');
            return;
          }
          setQuote(null);
          toast.success('Test payment confirmed');
        }),
    });
  }
  function toggleId(ids: string[], id: string, checked: boolean) {
    return checked ? [...ids, id] : ids.filter((value) => value !== id);
  }
  const data = billing?.organization_id === organizationId ? billing : null;
  const grant = data?.grant;
  const refunded = !!grant?.current_term_refunded_at;
  const endedCancelled =
    !!grant &&
    !refunded &&
    data?.change?.target_tier === null &&
    Date.parse(grant.paid_through_end) <= Date.now();
  const restartNeeded = refunded || endedCancelled;
  const activeCount = data?.active_branches?.length ?? 0;
  const renewalTier = data?.change?.target_tier ?? grant?.tier;
  const renewalArchiveIds = data?.change?.archive_account_ids ?? archiveIds;
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
                  ? `Full refund confirmed on ${fmt.dateTime(grant.current_term_refunded_at!)}. Paid access has ended.`
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
              Date.parse(grant.paid_through_end) <= Date.now() &&
              (data?.paid_slots?.length === 0 || data?.slot_renewal_review) ? (
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
      {grant &&
      !refunded &&
      grant.term_generation === 1 &&
      !grant.refund_confirmed_at ? (
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
                  {data.refund.review_required_at
                    ? 'The Test refund needs a support check. Contact support for the next step.'
                    : data.refund.provider_status === 'failed'
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
      {restartNeeded ? (
        <section className="space-y-3" aria-labelledby="test-recovery-heading">
          <SettingsSectionHead
            id="test-recovery-heading"
            title="Choose a plan to return"
            description="Your gym data is saved. Choose a plan to restart Test access."
          />
          <SubscriptionPlanCards
            formatMoney={fmt.money}
            onSelect={setInterest}
          />
          {interest && !data?.advanced_available ? (
            <p role="status">
              {SUBSCRIPTION_PLANS[interest].label} selected. Contact support to
              restart this Test plan.
            </p>
          ) : null}
        </section>
      ) : null}
      {data?.advanced_available && grant ? (
        <section
          className="space-y-3"
          aria-labelledby="test-plan-changes-heading"
        >
          <SettingsSectionHead
            id="test-plan-changes-heading"
            title="Plan changes"
          />
          <Card>
            <CardContent className="space-y-4">
              {!restartNeeded &&
              Date.parse(grant.paid_through_end) > Date.now() &&
              !data.change ? (
                <>
                  <p className="text-sm">
                    Review the Test amount before opening payment.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUBSCRIPTION_TIERS.filter(
                      (tier) =>
                        SUBSCRIPTION_PLANS[tier].monthlySoftwareInr >
                          SUBSCRIPTION_PLANS[grant.tier].monthlySoftwareInr &&
                        activeCount <= (tier === 'ultimate' ? 5 : 1) &&
                        data.paid_slots.length === 0
                    ).map((tier) => (
                      <Button
                        key={tier}
                        variant="outline"
                        loading={pending === `upgrade-${tier}`}
                        disabled={!!pending}
                        onClick={() =>
                          void act(`upgrade-${tier}`, () =>
                            reviewAdvanced('upgrade', tier)
                          )
                        }
                      >
                        Review {SUBSCRIPTION_PLANS[tier].label}
                      </Button>
                    ))}
                    {grant.tier !== 'starter' &&
                    (grant.tier !== 'growth' ||
                      data.paid_slots.length === 0) ? (
                      <Button
                        variant="outline"
                        loading={pending === 'addon_purchase'}
                        disabled={!!pending}
                        onClick={() =>
                          void act('addon_purchase', () =>
                            reviewAdvanced('addon_purchase', grant.tier)
                          )
                        }
                      >
                        Review extra branch
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
              {restartNeeded && interest ? (
                <>
                  {data.active_branches.map((branch) => (
                    <div key={branch.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`archive-${branch.id}`}
                        checked={archiveIds.includes(branch.id)}
                        disabled={
                          !branch.owned || branch.id === accountId || !!pending
                        }
                        onCheckedChange={(checked) => {
                          setArchiveIds((ids) =>
                            toggleId(ids, branch.id, checked === true)
                          );
                          setQuote(null);
                        }}
                      />
                      <Label htmlFor={`archive-${branch.id}`}>
                        Archive {branch.name}
                      </Label>
                    </div>
                  ))}
                  {interest === 'starter' && data.starter_reminder_policy ? (
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="accept-starter-reminders"
                        checked={acceptStarterReset}
                        disabled={!!pending}
                        onCheckedChange={(checked) => {
                          setAcceptStarterReset(checked === true);
                          setQuote(null);
                        }}
                      />
                      <Label htmlFor="accept-starter-reminders">
                        Use reminders{' '}
                        {data.starter_reminder_policy.days_before.join(', ')}{' '}
                        days before renewal, after{' '}
                        {data.starter_reminder_policy.hour_local}:00.
                      </Label>
                    </div>
                  ) : null}
                  <Button
                    loading={pending === 'restart'}
                    disabled={
                      !!pending ||
                      activeCount - archiveIds.length < 1 ||
                      activeCount - archiveIds.length >
                        (interest === 'ultimate' ? 5 : 1) ||
                      (interest === 'starter' &&
                        !!data.starter_reminder_policy &&
                        !acceptStarterReset)
                    }
                    onClick={() =>
                      void act('restart', () =>
                        reviewAdvanced('restart', interest)
                      )
                    }
                  >
                    Review restart
                  </Button>
                </>
              ) : null}
              {data.paid_slots.length > 0 &&
              !restartNeeded &&
              data.change?.target_tier !== null &&
              renewalTier ? (
                <div className="space-y-3">
                  <p className="text-sm">
                    Choose which extra branches to stop at renewal.
                  </p>
                  {data.paid_slots.map((slot, index) => (
                    <div key={slot.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`cancel-slot-${slot.id}`}
                        checked={cancelSlotIds.includes(slot.id)}
                        disabled={!!data.slot_renewal_review || !!pending}
                        onCheckedChange={(checked) =>
                          setCancelSlotIds((ids) =>
                            toggleId(ids, slot.id, checked === true)
                          )
                        }
                      />
                      <Label htmlFor={`cancel-slot-${slot.id}`}>
                        Stop extra branch {index + 1}
                      </Label>
                    </div>
                  ))}
                  {!data.slot_renewal_review && cancelSlotIds.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm">
                        Choose branches to archive if fewer will fit.
                      </p>
                      {data.active_branches.map((branch) => (
                        <div
                          key={branch.id}
                          className="flex items-center gap-2"
                        >
                          <Checkbox
                            id={`renewal-archive-${branch.id}`}
                            checked={renewalArchiveIds.includes(branch.id)}
                            disabled={
                              !!data.change ||
                              !branch.owned ||
                              branch.id === accountId ||
                              !!pending
                            }
                            onCheckedChange={(checked) =>
                              setArchiveIds((ids) =>
                                toggleId(ids, branch.id, checked === true)
                              )
                            }
                          />
                          <Label htmlFor={`renewal-archive-${branch.id}`}>
                            Archive {branch.name}
                          </Label>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {data.slot_renewal_review ? (
                    <p className="text-sm">
                      Next renewal choice saved.{' '}
                      {data.paid_slots.length -
                        data.slot_renewal_review.cancel_slot_ids.length}{' '}
                      extra branches will renew.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm">
                        Next Test renewal:{' '}
                        <span className="tabular-nums">
                          {fmt.money(
                            SUBSCRIPTION_PLANS[renewalTier].monthlySoftwareInr +
                              (data.paid_slots.length - cancelSlotIds.length) *
                                499,
                            'INR'
                          )}
                        </span>
                        .
                      </p>
                      <Button
                        variant="outline"
                        loading={pending === 'slot-review'}
                        disabled={
                          !!pending ||
                          (renewalTier === 'starter' &&
                            data.paid_slots.length - cancelSlotIds.length >
                              0) ||
                          (renewalTier === 'growth' &&
                            data.paid_slots.length - cancelSlotIds.length >
                              1) ||
                          activeCount - renewalArchiveIds.length < 1 ||
                          activeCount - renewalArchiveIds.length >
                            (renewalTier === 'ultimate' ? 5 : 1) +
                              data.paid_slots.length -
                              cancelSlotIds.length
                        }
                        onClick={() =>
                          void act('slot-review', async () => {
                            await post('paid-slot-renewal-review', {
                              organizationId,
                              requestId: crypto.randomUUID(),
                              cancelSlotIds,
                              archiveAccountIds: renewalArchiveIds,
                            });
                            toast.success('Next renewal choice saved');
                          })
                        }
                      >
                        Save renewal choice
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : null}
      {quote ? (
        <section className="space-y-3" aria-labelledby="test-quote-heading">
          <SettingsSectionHead
            id="test-quote-heading"
            title="Test amount to pay"
          />
          <Card>
            <CardContent className="space-y-3">
              <p className="text-sm">
                <span className="tabular-nums">
                  {fmt.money(quote.amountMinor / 100, 'INR')}
                </span>{' '}
                for{' '}
                {quote.kind === 'addon_purchase'
                  ? 'one extra branch'
                  : `${SUBSCRIPTION_PLANS[quote.tier].label} plan`}
                .
              </p>
              <p className="text-muted-foreground text-sm">
                Pay before {fmt.dateTime(quote.expiresAt)}. Test payment only.
              </p>
              <Button
                loading={pending === 'pay-advanced'}
                disabled={
                  !!pending || Date.parse(quote.expiresAt) <= Date.now()
                }
                onClick={() => void act('pay-advanced', payAdvanced)}
              >
                Pay Test amount
              </Button>
            </CardContent>
          </Card>
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
