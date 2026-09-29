'use client';

import { useEffect, useState } from 'react';
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

type LiveTier = 'starter' | 'growth' | 'ultimate';

interface LiveOfferPreview {
  approval_id: string;
  tier: LiveTier;
  amount_minor: number;
  currency: 'INR';
  customer_tax_note: string;
  customer_terms_note: string;
}

interface LiveQuote {
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
    typeof preview.customer_tax_note === 'string' &&
    typeof preview.customer_terms_note === 'string'
  );
}

function isQuote(value: unknown): value is LiveQuote {
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
export function SubscriptionLiveReview({
  organizationId,
  accountId,
  onChanged,
}: {
  organizationId: string;
  accountId: string;
  onChanged?: () => void;
}) {
  const { fmt } = useLocale();
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [renderedAt, setRenderedAt] = useState(() => Date.now());
  const [selectedTier, setSelectedTier] = useState<LiveTier>('starter');
  const [preview, setPreview] = useState<LiveOfferPreview | null>(null);
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);
  const [amountAccepted, setAmountAccepted] = useState(false);
  const [action, setAction] = useState<'preview' | 'quote' | 'checkout' | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: readError } = await createClient().rpc(
        'subscription_live_owner_quote',
        { p_organization_id: organizationId }
      );
      if (cancelled) return;
      if (readError) {
        setError('Could not load your plan amount. Try again.');
        return;
      }
      setError('');
      setQuote(isQuote(data) ? data : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, nonce]);

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

  async function acknowledge() {
    if (!quote || !policy || !accepted || pending || expired) return;
    setPending(true);
    const result = await createClient().rpc(
      'subscription_acknowledge_live_starter_reminders',
      { p_request_id: quote.request_id }
    );
    setPending(false);
    if (result.error) {
      toast.error(
        getErrorMessage(
          result.error,
          'Could not save your reminder choice. Try again.'
        )
      );
      return;
    }
    toast.success('Reminder choice saved');
    setNonce((n) => n + 1);
  }

  async function reviewAmount() {
    if (action) return;
    setAction('preview');
    const result = await createClient().rpc('subscription_live_offer_preview', {
      p_organization_id: organizationId,
      p_billing_account_id: accountId,
      p_tier: selectedTier,
    });
    setAction(null);
    if (
      result.error ||
      !isPreview(result.data) ||
      result.data.tier !== selectedTier
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
  }

  async function confirmAmount() {
    if (!preview || !previewRequestId || !amountAccepted || action) return;
    setAction('quote');
    try {
      const response = await fetch('/api/subscriptions/live-quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          accountId,
          requestId: previewRequestId,
          approvalId: preview.approval_id,
          tier: preview.tier,
          seenAmountMinor: preview.amount_minor,
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
      expired ||
      action ||
      (quote.tier === 'starter' && !acknowledged) ||
      process.env.NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI !== 'true'
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
      const checkout = body.checkout;
      if (
        !response.ok ||
        checkout?.requestId !== quote.request_id ||
        checkout.organizationId !== organizationId ||
        checkout.amountMinor !== quote.amount_minor ||
        checkout.currency !== 'INR' ||
        typeof checkout.orderId !== 'string' ||
        typeof checkout.keyId !== 'string'
      )
        throw new Error('Live Checkout did not match the reviewed amount');
      await openUsefulmadeLiveCheckout({
        keyId: checkout.keyId,
        orderId: checkout.orderId,
        amountMinor: quote.amount_minor,
        planLabel: quote.tier[0].toUpperCase() + quote.tier.slice(1),
        onPayment: (payment) => {
          if (
            payment.razorpay_order_id !== checkout.orderId ||
            !/^pay_[A-Za-z0-9]+$/.test(payment.razorpay_payment_id)
          ) {
            toast.error('Could not check the payment. Contact support.');
            return;
          }
          toast.message('Payment is being checked.');
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
      <AlertTitle>Usefulmade Live pilot</AlertTitle>
      <AlertDescription className="space-y-3">
        {error ? <p>{error}</p> : null}
        {!quote && !preview ? (
          <div className="space-y-3">
            <p>Choose a plan to see the exact amount.</p>
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
            <Button
              variant="outline"
              size="sm"
              loading={action === 'preview'}
              disabled={!!action}
              onClick={() => void reviewAmount()}
            >
              Review plan amount
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
                I reviewed this exact Live pilot amount.
              </Label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                loading={action === 'quote'}
                disabled={!amountAccepted || !!action}
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
                }}
              >
                Change plan
              </Button>
            </div>
          </div>
        ) : null}
        {quote ? (
          <>
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
            {expired ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuote(null)}
              >
                Review a new amount
              </Button>
            ) : process.env.NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI ===
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
              <p>Payment for this Live pilot is not available yet.</p>
            )}
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
