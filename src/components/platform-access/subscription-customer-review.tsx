'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { SubscriptionLiveReview, isLiveTerm } from './subscription-live-review';

interface PreparedOffer {
  preparation_id: string;
  organization_id: string;
  billing_account_id: string;
  amount_minor: number;
  currency: string;
  customer_tax_note: string;
  customer_terms_note: string;
  branch_name: string;
  owner_reviewed: boolean;
  checkout_open: boolean;
  opening_available: boolean;
}

export function SubscriptionCustomerReview({
  organizationId,
  accountId,
  onChanged,
}: {
  organizationId: string;
  accountId: string;
  onChanged?: () => void;
}) {
  const { fmt } = useLocale();
  const [offer, setOffer] = useState<PreparedOffer | null>(null);
  const [hasPaidTerm, setHasPaidTerm] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [result, termResult] = await Promise.all([
        createClient().rpc('subscription_customer_review_preview', {
          p_organization_id: organizationId,
          p_billing_account_id: accountId,
        }),
        createClient().rpc('subscription_live_owner_term', {
          p_organization_id: organizationId,
        }),
      ]);
      if (cancelled) return;
      const data = result.data as Partial<PreparedOffer> | null;
      const valid =
        data &&
        typeof data.preparation_id === 'string' &&
        data.organization_id === organizationId &&
        data.billing_account_id === accountId &&
        data.amount_minor === 79900 &&
        data.currency === 'INR' &&
        typeof data.customer_tax_note === 'string' &&
        typeof data.customer_terms_note === 'string' &&
        typeof data.branch_name === 'string' &&
        typeof data.owner_reviewed === 'boolean' &&
        typeof data.checkout_open === 'boolean' &&
        typeof data.opening_available === 'boolean';
      setHasPaidTerm(!termResult.error && isLiveTerm(termResult.data));
      setError(!!result.error || !!termResult.error || (!!data && !valid));
      setOffer(valid ? (data as PreparedOffer) : null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, accountId, nonce]);

  async function approve() {
    if (!offer || !accepted || pending) return;
    setPending(true);
    try {
      const response = await fetch('/api/subscriptions/live-customer-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          accountId,
          preparationId: offer.preparation_id,
          seenAmountMinor: offer.amount_minor,
          termsAccepted: true,
        }),
      });
      const body = (await response.json()) as {
        reviewed?: boolean;
        error?: string;
      };
      if (!response.ok || body.reviewed !== true)
        throw new Error(body.error || 'Could not save your review. Try again.');
      setAccepted(false);
      setNonce((n) => n + 1);
      toast.success('Starter offer reviewed');
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Could not save your review. Try again.')
      );
    } finally {
      setPending(false);
    }
  }

  if (!loaded) return null;
  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load your offer</AlertTitle>
        <AlertDescription>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoaded(false);
              setNonce((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  // Paid status/cancellation survives containment of first checkout or offer revocation.
  if (hasPaidTerm)
    return (
      <SubscriptionLiveReview
        starterCustomer
        organizationId={organizationId}
        accountId={accountId}
        onChanged={onChanged}
      />
    );
  // The public flag reveals no payable flow to an organization without durable preparation.
  if (!offer) return null;
  if (offer.checkout_open && offer.owner_reviewed)
    return (
      <SubscriptionLiveReview
        starterCustomer
        organizationId={organizationId}
        accountId={accountId}
        onChanged={onChanged}
      />
    );
  if (!offer.opening_available)
    return (
      <Alert variant="destructive">
        <AlertTitle>Payment is paused</AlertTitle>
        <AlertDescription>
          Contact support to review your Starter payment.
        </AlertDescription>
      </Alert>
    );
  return (
    <Alert>
      <AlertTitle>Review UsefulDesk Starter</AlertTitle>
      <AlertDescription>
        <div className="space-y-3">
          <p>
            {fmt.money(offer.amount_minor / 100, 'INR')} for one calendar month.
            One branch: {offer.branch_name}.
          </p>
          <p>{offer.customer_tax_note}</p>
          <p>{offer.customer_terms_note}</p>
          <p>
            Paid access starts after your payment is verified. We do not debit
            you automatically.
          </p>
          <div className="flex items-start gap-2">
            <Checkbox
              id="customer-offer-review"
              checked={accepted}
              disabled={pending}
              onCheckedChange={(value) => setAccepted(value === true)}
            />
            <Label htmlFor="customer-offer-review">
              I reviewed this Starter offer and its payment and refund terms.
            </Label>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!accepted}
            loading={pending}
            onClick={() => void approve()}
          >
            {offer.owner_reviewed
              ? 'Continue to payment'
              : 'Approve Starter offer'}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
