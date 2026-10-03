'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import { openUsefulmadeLiveCheckout } from '@/lib/subscriptions/live-checkout-client';
import { createClient } from '@/lib/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { monthlyIdentityFromRow } from '@/lib/subscriptions/monthly-offer-preview';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/plans';

type LiveTier = 'starter' | 'growth' | 'ultimate';

interface LiveTerm {
  request_id: string;
  tier: LiveTier;
  paid_through_end: string;
  renewal_stopped: boolean;
  refunded: boolean;
  expired: boolean;
  renewal_available?: boolean;
  monthly_offer_id?: string;
  offer_contract_version?: string;
  catalog_version?: string;
  included_branches?: number;
  paid_extra_branch_slots?: number;
  amount_minor?: number;
  currency?: string;
  period_start?: string;
  payment_state?: string;
  hold_reason?: string | null;
  refund_state?: string | null;
  refund_review_reason?: string | null;
}

export function isLiveTerm(value: unknown): value is LiveTerm {
  if (!value || typeof value !== 'object') return false;
  const term = value as Partial<LiveTerm>;
  return (
    typeof term.request_id === 'string' &&
    typeof term.paid_through_end === 'string' &&
    Number.isFinite(Date.parse(term.paid_through_end)) &&
    typeof term.renewal_stopped === 'boolean' &&
    typeof term.refunded === 'boolean' &&
    typeof term.expired === 'boolean' &&
    (term.offer_contract_version == null ||
      term.offer_contract_version === 'starter_v1' ||
      (!!monthlyIdentityFromRow(term) &&
        term.renewal_available === false &&
        typeof term.period_start === 'string' &&
        Number.isFinite(Date.parse(term.period_start))))
  );
}

interface LiveOfferPreview {
  renewal_of_request_id?: string;
  complimentary_conversion?: boolean;
  approval_id: string;
  tier: LiveTier;
  amount_minor: number;
  currency: 'INR';
  customer_tax_note: string;
  customer_terms_note: string;
}

interface LiveQuote {
  monthly_offer_id?: string;
  offer_contract_version?: string;
  catalog_version?: string;
  included_branches?: number;
  paid_extra_branch_slots?: number;
  order_state?: 'claimed' | 'bound' | 'review_required' | null;
  renewal_of_request_id?: string | null;
  payment_state?: 'verified' | 'review_required' | null;
  request_id: string;
  tier: 'starter' | 'growth' | 'ultimate';
  amount_minor: number;
  currency: 'INR';
  expires_at: string;
  starter_reminder_reset_accepted: boolean;
  starter_reminder_policy_version: string | null;
  approved_starter_reminder_policy: {
    version: string;
    days_before: number[];
    hour_local: number;
  } | null;
  customer_tax_note?: string | null;
  customer_terms_note?: string | null;
}

function isPreview(value: unknown): value is LiveOfferPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const preview = value as Partial<LiveOfferPreview>;
  return (
    typeof preview.approval_id === 'string' &&
    ['starter', 'growth', 'ultimate'].includes(String(preview.tier)) &&
    Number.isSafeInteger(preview.amount_minor) &&
    (preview.amount_minor ?? 0) > 0 &&
    preview.currency === 'INR' &&
    (preview.complimentary_conversion === undefined ||
      typeof preview.complimentary_conversion === 'boolean') &&
    typeof preview.customer_tax_note === 'string' &&
    typeof preview.customer_terms_note === 'string'
  );
}

export function isLiveQuote(value: unknown): value is LiveQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const quote = value as Partial<LiveQuote>;
  return (
    typeof quote.request_id === 'string' &&
    ['starter', 'growth', 'ultimate'].includes(String(quote.tier)) &&
    Number.isSafeInteger(quote.amount_minor) &&
    (quote.amount_minor ?? 0) > 0 &&
    quote.currency === 'INR' &&
    typeof quote.expires_at === 'string' &&
    Number.isFinite(Date.parse(quote.expires_at)) &&
    typeof quote.starter_reminder_reset_accepted === 'boolean'
  );
}

/** Shows the approved offer, frozen owner quote, and gated Live Checkout. */
type LiveReviewProps = {
  organizationId: string;
  accountId: string;
  onChanged?: () => void;
  starterCustomer?: boolean;
  monthlyCustomer?: boolean;
};
export function SubscriptionLiveReview(props: LiveReviewProps) {
  return (
    <LiveReview
      key={`${props.organizationId}:${props.accountId}:${props.starterCustomer ? 'starter' : props.monthlyCustomer ? 'monthly' : 'pilot'}`}
      {...props}
    />
  );
}
function LiveReview({
  organizationId,
  accountId,
  onChanged,
  starterCustomer = false,
  monthlyCustomer = false,
}: LiveReviewProps) {
  const { fmt } = useLocale();
  const [term, setTerm] = useState<LiveTerm | null>(null);
  const [cancelAccepted, setCancelAccepted] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [error, setError] = useState('');
  const [verificationPending, setVerificationPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [renderedAt, setRenderedAt] = useState(() => Date.now());
  const [selectedTier, setSelectedTier] = useState<LiveTier>('starter');
  const [preview, setPreview] = useState<LiveOfferPreview | null>(null);
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);
  const [amountAccepted, setAmountAccepted] = useState(false);
  const [conversionAccepted, setConversionAccepted] = useState(false);
  const [action, setAction] = useState<
    'preview' | 'quote' | 'checkout' | 'cancel' | null
  >(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [quoteResult, termResult] = await Promise.all([
          createClient().rpc('subscription_live_owner_quote', {
            p_organization_id: organizationId,
          }),
          createClient().rpc('subscription_live_owner_term', {
            p_organization_id: organizationId,
          }),
        ]);
        const { data, error: readError } = quoteResult;
        if (cancelled) return;
        setRefreshing(false);
        if (
          readError ||
          termResult.error ||
          (!monthlyCustomer &&
            (data?.monthly_offer_id != null ||
              termResult.data?.monthly_offer_id != null ||
              monthlyIdentityFromRow(data) ||
              monthlyIdentityFromRow(termResult.data))) ||
          (monthlyCustomer &&
            (starterCustomer ||
              (data != null &&
                (!isLiveQuote(data) || !monthlyIdentityFromRow(data))) ||
              (termResult.data != null &&
                (!isLiveTerm(termResult.data) ||
                  !monthlyIdentityFromRow(termResult.data))))) ||
          (starterCustomer &&
            data != null &&
            (!isLiveQuote(data) ||
              data.tier !== 'starter' ||
              data.amount_minor !== 79900))
        ) {
          setError('Could not load your plan amount. Try again.');
          return;
        }
        setError('');
        if (isLiveTerm(termResult.data)) setVerificationPending(false);
        setAccepted(false);
        setAmountAccepted(false);
        setCancelAccepted(false);
        setTerm(isLiveTerm(termResult.data) ? termResult.data : null);
        setLoaded(true);
        setQuote(
          isLiveQuote(data) && data.payment_state !== 'verified' ? data : null
        );
      } catch (error) {
        if (!cancelled)
          setError(
            getErrorMessage(
              error,
              'Could not load your plan amount. Try again.'
            )
          );
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, accountId, nonce, starterCustomer, monthlyCustomer]);

  useEffect(() => {
    if (!quote) return;
    const expiresAt = Date.parse(quote.expires_at);
    if (expiresAt <= renderedAt) return;
    const remaining = expiresAt - Date.now();
    const timer = window.setTimeout(
      () => setRenderedAt(Date.now()),
      Math.max(0, Math.min(remaining + 50, 2_147_483_647))
    );
    return () => window.clearTimeout(timer);
  }, [quote, renderedAt]);

  const expired = quote ? Date.parse(quote.expires_at) <= renderedAt : false;
  const policy = quote?.approved_starter_reminder_policy;
  const acknowledged =
    quote?.starter_reminder_reset_accepted &&
    quote.starter_reminder_policy_version === policy?.version;

  const stopped = term?.renewal_stopped || term?.refunded;
  const customerRenewalOpen =
    process.env.NEXT_PUBLIC_USEFULDESK_CUSTOMER_RENEWALS_UI === 'true' &&
    term?.renewal_available === true;
  const orderUnresolved = !!quote?.order_state;
  const canReview =
    loaded &&
    !error &&
    !stopped &&
    !monthlyCustomer &&
    (starterCustomer
      ? !term || (term.expired && customerRenewalOpen)
      : !term || term.expired);

  async function cancelRenewal() {
    if (monthlyCustomer || !term || !cancelAccepted || action) return;
    setAction('cancel');
    try {
      const result = await createClient().rpc(
        'subscription_cancel_live_renewal',
        {
          p_organization_id: organizationId,
          p_seen_request_id: term.request_id,
        }
      );
      if (
        result.error ||
        !isLiveTerm(result.data) ||
        !result.data.renewal_stopped
      )
        throw (
          result.error ??
          new Error('Could not cancel renewal. Refresh and try again.')
        );
      setTerm(result.data);
      setPreview(null);
      setQuote(null);
      setCancelAccepted(false);
      toast.success('Renewal cancelled');
      onChanged?.();
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Could not cancel renewal. Try again.')
      );
    } finally {
      setAction(null);
    }
  }

  async function acknowledge() {
    if (!quote || !policy || !accepted || pending || expired) return;
    setPending(true);
    try {
      const result = await createClient().rpc(
        'subscription_acknowledge_live_starter_reminders',
        { p_request_id: quote.request_id }
      );
      if (!alive.current) return;
      if (result.error) throw result.error;
      toast.success('Reminder choice saved');
      setAccepted(false);
      setNonce((n) => n + 1);
    } catch (error) {
      if (alive.current)
        toast.error(
          getErrorMessage(
            error,
            'Could not save your reminder choice. Try again.'
          )
        );
    } finally {
      if (alive.current) setPending(false);
    }
  }

  async function reviewAmount() {
    if (monthlyCustomer || action) return;
    setAction('preview');
    const result = await createClient().rpc(
      term
        ? 'subscription_live_renewal_preview'
        : 'subscription_live_offer_preview',
      {
        p_organization_id: organizationId,
        p_billing_account_id: accountId,
        p_tier: selectedTier,
      }
    );
    if (!alive.current) return;
    setAction(null);
    if (
      result.error ||
      !isPreview(result.data) ||
      result.data.tier !== selectedTier ||
      (starterCustomer &&
        (result.data.tier !== 'starter' ||
          result.data.amount_minor !== 79900 ||
          result.data.complimentary_conversion ||
          (!!result.data.renewal_of_request_id && !customerRenewalOpen))) ||
      (term && result.data.renewal_of_request_id !== term.request_id)
    ) {
      toast.error(
        getErrorMessage(
          result.error,
          'Could not load the plan amount. Try again.'
        )
      );
      return;
    }
    setPreview(result.data);
    setPreviewRequestId(crypto.randomUUID());
    setAmountAccepted(false);
    setConversionAccepted(false);
  }

  async function confirmAmount() {
    if (
      !preview ||
      !previewRequestId ||
      !amountAccepted ||
      (preview.complimentary_conversion && !conversionAccepted) ||
      action
    )
      return;
    setAction('quote');
    try {
      const response = await fetch('/api/subscriptions/live-quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          accountId,
          ...(preview.renewal_of_request_id
            ? { renewalOfRequestId: preview.renewal_of_request_id }
            : {}),
          requestId: previewRequestId,
          approvalId: preview.approval_id,
          tier: preview.tier,
          seenAmountMinor: preview.amount_minor,
          ...(preview.complimentary_conversion
            ? { complimentaryConversionAccepted: conversionAccepted }
            : {}),
        }),
      });
      const body = (await response.json()) as {
        quote?: {
          request_id?: string;
          amount_minor?: number;
          currency?: string;
        };
      };
      if (
        !response.ok ||
        body.quote?.request_id !== previewRequestId ||
        body.quote?.amount_minor !== preview.amount_minor ||
        body.quote?.currency !== 'INR'
      )
        throw new Error('Live amount changed');
      setPreview(null);
      setAmountAccepted(false);
      setConversionAccepted(false);
      setNonce((n) => n + 1);
      toast.success('Plan amount confirmed');
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Could not confirm the plan amount. Try again.')
      );
    } finally {
      setAction(null);
    }
  }

  async function openCheckout() {
    if (
      !quote ||
      verificationPending ||
      expired ||
      !loaded ||
      !!error ||
      stopped ||
      quote.payment_state === 'review_required' ||
      quote.order_state === 'review_required' ||
      (starterCustomer &&
        !!quote.renewal_of_request_id &&
        !customerRenewalOpen) ||
      action ||
      (quote.tier === 'starter' && !acknowledged) ||
      (monthlyCustomer
        ? process.env.NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI !== 'true'
        : starterCustomer
          ? process.env.NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI !== 'true'
          : process.env.NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI !== 'true')
    )
      return;
    setAction('checkout');
    try {
      const response = await fetch('/api/subscriptions/live-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, requestId: quote.request_id }),
      });
      const body = (await response.json()) as {
        checkout?: {
          requestId?: string;
          organizationId?: string;
          orderId?: string;
          amountMinor?: number;
          currency?: string;
          keyId?: string;
        };
      };
      if (!alive.current) return;
      const checkout = body.checkout;
      const monthlyIdentity = monthlyIdentityFromRow(quote);
      if (
        !response.ok ||
        (monthlyCustomer && !monthlyIdentity) ||
        checkout?.requestId !== quote.request_id ||
        checkout.organizationId !== organizationId ||
        checkout.amountMinor !== quote.amount_minor ||
        checkout.currency !== 'INR' ||
        typeof checkout.orderId !== 'string' ||
        typeof checkout.keyId !== 'string'
      )
        throw new Error('Live Checkout did not match the reviewed amount');
      await openUsefulmadeLiveCheckout({
        ...(starterCustomer ? { starterCustomer: true } : {}),
        ...(monthlyCustomer && monthlyIdentity
          ? { monthlyCustomer: monthlyIdentity, isCurrent: () => alive.current }
          : {}),
        keyId: checkout.keyId,
        orderId: checkout.orderId,
        amountMinor: checkout.amountMinor,
        planLabel: quote.tier[0].toUpperCase() + quote.tier.slice(1),
        onPayment: (payment) => {
          if (!alive.current) return;
          if (
            payment.razorpay_order_id !== checkout.orderId ||
            !/^pay_[A-Za-z0-9]+$/.test(payment.razorpay_payment_id)
          ) {
            toast.error('Could not check the payment. Contact support.');
            return;
          }
          toast.message('Payment is being checked.');
          setVerificationPending(true);
          setNonce((n) => n + 1);
          onChanged?.();
        },
      });
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not open payment. Try again.'));
    } finally {
      setAction(null);
    }
  }

  return (
    <Alert>
      <AlertTitle>
        {monthlyCustomer
          ? `UsefulDesk ${SUBSCRIPTION_PLANS[term?.tier ?? quote?.tier ?? 'starter'].label}`
          : starterCustomer
            ? 'UsefulDesk Starter'
            : 'Usefulmade Live pilot'}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        {error ? <p>{error}</p> : null}
        {verificationPending ? (
          <p role="status">
            Payment verification pending. Refresh billing to check your access.
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={!!action}
          loading={refreshing}
          onClick={() => {
            setAccepted(false);
            setAmountAccepted(false);
            setRefreshing(true);
            setNonce((n) => n + 1);
          }}
        >
          Refresh billing
        </Button>
        {quote?.payment_state === 'review_required' ? (
          <p>
            Your payment needs a review. Contact support before paying again.
          </p>
        ) : null}
        {term ? (
          <div className="space-y-3">
            <p>
              {term.refunded
                ? 'Your payment was refunded.'
                : `Paid access ends ${fmt.dateTime(term.paid_through_end)}.`}
            </p>
            {monthlyCustomer ? (
              <>
                <p>Paid access started {fmt.dateTime(term.period_start!)}.</p>
                <p>
                  <span className="tabular-nums">
                    {fmt.money((term.amount_minor ?? 0) / 100, 'INR')}
                  </span>{' '}
                  paid for one calendar month. {term.included_branches}{' '}
                  {term.included_branches === 1 ? 'branch' : 'branches'}{' '}
                  included.
                </p>
                <p>
                  {term.payment_state === 'review_required' || term.hold_reason
                    ? 'Your payment needs a review. Contact support before paying again.'
                    : term.refunded
                      ? 'Your paid access ended after the refund.'
                      : term.expired
                        ? 'Paid access has expired. Contact support for help.'
                        : 'Your first monthly payment is verified.'}
                </p>
                {term.refund_state ? (
                  <p>
                    {term.refund_state === 'processed'
                      ? 'Full refund confirmed.'
                      : term.refund_state === 'review_required'
                        ? 'Your refund needs a review. Contact support.'
                        : term.refund_state === 'failed'
                          ? 'Your refund could not be completed. Contact support.'
                          : 'Your refund is being checked.'}
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                {stopped
                  ? 'Renewal is cancelled. Contact support to buy again.'
                  : starterCustomer && !customerRenewalOpen
                    ? 'Contact support to renew after expiry.'
                    : 'Renew after expiry. Each payment buys one calendar month from payment confirmation.'}
              </p>
            )}
            <p>We do not debit you automatically.</p>
            {!stopped && !monthlyCustomer ? (
              <>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="live-cancel-renewal"
                    checked={cancelAccepted}
                    disabled={!!action}
                    onCheckedChange={(checked) =>
                      setCancelAccepted(checked === true)
                    }
                  />
                  <Label htmlFor="live-cancel-renewal">
                    Cancel renewal. Keep paid access until expiry. No refund is
                    issued.
                  </Label>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!cancelAccepted || !!action}
                  loading={action === 'cancel'}
                  onClick={() => void cancelRenewal()}
                >
                  Cancel renewal
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {!quote && !preview && canReview ? (
          <div className="space-y-3">
            <p>
              {term
                ? 'Review the Starter renewal amount.'
                : 'Choose a plan to see the exact amount.'}
            </p>
            {!term && !starterCustomer ? (
              <div className="space-y-2">
                <Label htmlFor="live-plan-choice">Plan</Label>
                <Select
                  value={selectedTier}
                  disabled={!!action}
                  onValueChange={(tier) => {
                    if (
                      tier === 'starter' ||
                      tier === 'growth' ||
                      tier === 'ultimate'
                    )
                      setSelectedTier(tier);
                  }}
                >
                  <SelectTrigger id="live-plan-choice" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                    <SelectItem value="ultimate">Ultimate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              loading={action === 'preview'}
              disabled={!!action}
              onClick={() => void reviewAmount()}
            >
              {term ? 'Review renewal amount' : 'Review plan amount'}
            </Button>
          </div>
        ) : null}
        {preview ? (
          <div className="space-y-3">
            <p className="text-foreground text-lg font-semibold tabular-nums">
              {fmt.money(preview.amount_minor / 100, 'INR')} for one month
            </p>
            <p>{preview.customer_tax_note}</p>
            <p>{preview.customer_terms_note}</p>
            <div className="flex items-start gap-2">
              <Checkbox
                id="live-amount-review"
                checked={amountAccepted}
                disabled={!!action}
                onCheckedChange={(checked) =>
                  setAmountAccepted(checked === true)
                }
              />
              <Label htmlFor="live-amount-review">
                {starterCustomer
                  ? 'I reviewed this Starter amount and its terms.'
                  : 'I reviewed this exact Live pilot amount.'}
              </Label>
            </div>
            {preview.complimentary_conversion ? (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="live-complimentary-conversion"
                  checked={conversionAccepted}
                  disabled={!!action}
                  onCheckedChange={(checked) =>
                    setConversionAccepted(checked === true)
                  }
                />
                <Label htmlFor="live-complimentary-conversion">
                  I understand this payment replaces my free access. Paid access
                  ends after one month unless I renew. A confirmed full refund
                  ends it sooner.
                </Label>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                loading={action === 'quote'}
                disabled={
                  !amountAccepted ||
                  (preview.complimentary_conversion && !conversionAccepted) ||
                  !!action
                }
                onClick={() => void confirmAmount()}
              >
                Confirm plan amount
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!action}
                onClick={() => {
                  setPreview(null);
                  setAmountAccepted(false);
                  setConversionAccepted(false);
                }}
              >
                Change plan
              </Button>
            </div>
          </div>
        ) : null}
        {quote && !stopped && (!monthlyCustomer || !term) ? (
          <>
            {orderUnresolved && quote.payment_state !== 'review_required' ? (
              <p>
                Payment setup needs a check. Refresh billing before paying
                again. Contact support if the amount has expired.
              </p>
            ) : null}
            <p className="text-foreground text-lg font-semibold tabular-nums">
              {fmt.money(quote.amount_minor / 100, 'INR')} for one month
            </p>
            <p>
              {quote.tier[0].toUpperCase() + quote.tier.slice(1)} plan. Review
              this exact amount before paying.
            </p>
            {quote.customer_tax_note ? <p>{quote.customer_tax_note}</p> : null}
            {quote.customer_terms_note ? (
              <p>{quote.customer_terms_note}</p>
            ) : null}
            <p>
              {expired
                ? 'This amount has expired. Contact support for a new amount.'
                : `This amount is valid until ${fmt.dateTime(quote.expires_at)}.`}
            </p>
            {quote.tier === 'starter' ? (
              policy ? (
                acknowledged ? (
                  <p>Starter reminder choice saved.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="live-starter-reminders"
                        checked={accepted}
                        disabled={pending || expired}
                        onCheckedChange={(checked) =>
                          setAccepted(checked === true)
                        }
                      />
                      <Label htmlFor="live-starter-reminders">
                        Use reminders {policy.days_before.join(', ')} days
                        before renewal, after {policy.hour_local}:00.
                      </Label>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!accepted || expired}
                      loading={pending}
                      onClick={() => void acknowledge()}
                    >
                      Save reminder choice
                    </Button>
                  </div>
                )
              ) : (
                <p>Starter reminders need a review. Contact support.</p>
              )
            ) : null}
            {quote.payment_state === 'review_required' ||
            quote.order_state === 'review_required' ? null : expired ? (
              orderUnresolved || monthlyCustomer ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuote(null)}
                >
                  Review a new amount
                </Button>
              )
            ) : starterCustomer &&
              quote.renewal_of_request_id &&
              !customerRenewalOpen ? (
              <p>Contact support to review your renewal.</p>
            ) : verificationPending ? null : (monthlyCustomer
                ? process.env.NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI
                : starterCustomer
                  ? process.env.NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI
                  : process.env.NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI) ===
              'true' ? (
              <Button
                loading={action === 'checkout'}
                disabled={
                  !!action || (quote.tier === 'starter' && !acknowledged)
                }
                onClick={() => void openCheckout()}
              >
                Pay for plan
              </Button>
            ) : (
              <p>
                {monthlyCustomer
                  ? 'Payment is paused. Contact support or refresh billing.'
                  : 'Payment for this Live pilot is not available yet.'}
              </p>
            )}
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
