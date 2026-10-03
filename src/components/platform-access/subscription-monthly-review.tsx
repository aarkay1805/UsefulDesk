'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canManageSubscriptionBilling } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import {
  isMonthlyOfferSetPreview,
  monthlyIdentityFromRow,
  type MonthlyOfferSetPreview,
} from '@/lib/subscriptions/monthly-offer-preview';
import {
  SUBSCRIPTION_PLANS,
  type SubscriptionTier,
} from '@/lib/subscriptions/plans';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ResolvableAction } from '@/components/ui/resolvable-action';
import { SubscriptionPlanCards } from './subscription-plan-cards';
import { SubscriptionConversionReviewDialog } from './subscription-conversion-review-dialog';
import {
  SubscriptionLiveReview,
  isLiveTerm,
  isLiveQuote,
} from './subscription-live-review';

import {
  SubscriptionCustomerReview,
  isPreparedStarterOffer,
} from './subscription-customer-review';

const ARCHIVE_CONSEQUENCE =
  'These branches will be archived now, even if you do not finish payment. Their history stays saved.';
type Props = {
  organizationId: string;
  accountId: string;
  onChanged?: () => void;
};

export function SubscriptionMonthlyReview(props: Props) {
  return (
    <MonthlyReviewLoader
      key={`${props.organizationId}:${props.accountId}`}
      {...props}
    />
  );
}

function MonthlyReviewLoader({ organizationId, accountId, onChanged }: Props) {
  const { isOrganizationOwner } = useAuth();
  const owner = canManageSubscriptionBilling(
    isOrganizationOwner ? 'owner' : null
  );
  const [preview, setPreview] = useState<MonthlyOfferSetPreview | null>(null);
  const [original, setOriginal] = useState<
    'quote' | 'customer' | 'paused' | null
  >(null);
  const [paid, setPaid] = useState(false);
  const [quoted, setQuoted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [archivedSource, setArchivedSource] = useState<string | null>(null);
  // An uncertain write cannot be disproved by a preview read before it commits.
  // Keep its mounted selection (including request/review IDs) across refresh.
  const frozen = useRef<{
    preview: MonthlyOfferSetPreview;
    nonce: number;
  } | null>(null);
  const [frozenSelection, setFrozenSelection] =
    useState<typeof frozen.current>(null);
  const actionPending = useRef(false);
  const [actionInFlight, setActionInFlight] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!owner) {
        setLoading(false);
        return;
      }
      try {
        const [offer, term, quote, starter] = await Promise.all([
          createClient().rpc('subscription_monthly_offer_preview', {
            p_organization_id: organizationId,
            p_billing_account_id: accountId,
          }),
          createClient().rpc('subscription_live_owner_term', {
            p_organization_id: organizationId,
          }),
          createClient().rpc('subscription_live_owner_quote', {
            p_organization_id: organizationId,
          }),
          createClient().rpc('subscription_customer_review_preview', {
            p_organization_id: organizationId,
            p_billing_account_id: accountId,
          }),
        ]);
        if (cancelled) return;
        if (term.error || quote.error)
          throw new Error('Could not load billing. Try again.');
        if (isLiveTerm(term.data) && !monthlyIdentityFromRow(term.data)) {
          setOriginal('customer');
          setError('');
          return;
        }
        if (
          isLiveQuote(quote.data) &&
          quote.data.monthly_offer_id == null &&
          quote.data.offer_contract_version == null &&
          quote.data.tier === 'starter' &&
          quote.data.amount_minor === 79900
        ) {
          setOriginal('quote');
          setError('');
          return;
        }
        if (isLiveQuote(quote.data) && monthlyIdentityFromRow(quote.data)) {
          if (
            frozen.current &&
            quote.data.monthly_offer_id !==
              frozen.current.preview.selectedOfferId
          )
            throw new Error(
              'Your payment needs a review. Contact support before paying again.'
            );
          setOriginal(null);
          setQuoted(true);
          setError('');
          return;
        }
        if (
          !frozen.current &&
          !monthlyIdentityFromRow(term.data) &&
          !monthlyIdentityFromRow(quote.data) &&
          !offer.error &&
          isMonthlyOfferSetPreview(offer.data, organizationId, accountId) &&
          offer.data.selectedOfferId === null &&
          !starter.error &&
          isPreparedStarterOffer(starter.data, organizationId, accountId)
        ) {
          setOriginal(
            process.env.NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI === 'true'
              ? 'customer'
              : 'paused'
          );
          setError('');
          return;
        }
        setOriginal(null);
        const paidMonthly =
          isLiveTerm(term.data) && !!monthlyIdentityFromRow(term.data);
        // Durable status is independent of initiation and current preparation.
        setPaid(paidMonthly);
        if (paidMonthly) {
          setError('');
          setPreview(null);
          return;
        }
        if (
          offer.error ||
          !isMonthlyOfferSetPreview(offer.data, organizationId, accountId)
        )
          throw new Error(
            'Could not load your offer. Contact support or try again.'
          );
        if (
          quote.data &&
          (!monthlyIdentityFromRow(quote.data) ||
            quote.data.monthly_offer_id !== offer.data.selectedOfferId)
        )
          throw new Error(
            'Your payment needs a review. Contact support before paying again.'
          );
        setPreview(offer.data);
        setQuoted(!!quote.data);
        setError('');
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          setError(
            getErrorMessage(error, 'Could not load your offer. Try again.')
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, accountId, nonce, owner]);
  function refresh() {
    if (actionPending.current || loading) return;
    setLoading(true);
    setNonce((n) => n + 1);
  }
  if (!owner) return null;
  if (original === 'customer')
    return (
      <SubscriptionCustomerReview
        organizationId={organizationId}
        accountId={accountId}
        onChanged={onChanged}
      />
    );
  if (original === 'quote')
    return (
      <SubscriptionLiveReview
        starterCustomer
        organizationId={organizationId}
        accountId={accountId}
        onChanged={onChanged}
      />
    );
  if (original === 'paused')
    return (
      <Alert>
        <AlertTitle>Starter payment needs a review</AlertTitle>
        <AlertDescription>
          Your saved Starter offer stays unchanged. Contact support to continue
          payment.
        </AlertDescription>
      </Alert>
    );
  if (paid || quoted)
    return (
      <SubscriptionLiveReview
        monthlyCustomer
        organizationId={organizationId}
        accountId={accountId}
        onChanged={onChanged}
      />
    );
  const selectionPreview = frozenSelection?.preview ?? preview;
  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        loading={loading}
        disabled={actionInFlight}
        onClick={refresh}
      >
        Refresh offers
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load your offer</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {(!loading || frozenSelection) && selectionPreview ? (
        archivedSource === selectionPreview.sourceSnapshot ? (
          <Alert>
            <AlertTitle>Branches archived</AlertTitle>
            <AlertDescription>
              Contact support to prepare a fresh offer. Refresh offers before
              approving payment.
            </AlertDescription>
          </Alert>
        ) : (
          <MonthlySelection
            key={`${selectionPreview.sourceSnapshot}:${frozenSelection?.nonce ?? nonce}`}
            preview={selectionPreview}
            refreshNonce={nonce}
            preparationCurrent={
              !frozenSelection ||
              (preview?.offerSetId === selectionPreview.offerSetId &&
                preview?.sourceSnapshot === selectionPreview.sourceSnapshot &&
                (preview.selectedOfferId === null ||
                  preview.selectedOfferId === selectionPreview.selectedOfferId))
            }
            refreshing={loading}
            organizationId={organizationId}
            accountId={accountId}
            onChanged={onChanged}
            onQuoted={() => setQuoted(true)}
            onFrozen={(offerId) => {
              if (!frozen.current) {
                frozen.current = {
                  preview: { ...selectionPreview, selectedOfferId: offerId },
                  nonce,
                };
                setFrozenSelection(frozen.current);
              }
            }}
            onPending={(pending) => {
              actionPending.current = pending;
              setActionInFlight(pending);
            }}
            onArchived={() => {
              actionPending.current = false;
              setActionInFlight(false);
              setArchivedSource(selectionPreview.sourceSnapshot);
              setPreview(null);
              setLoading(true);
              setNonce((n) => n + 1);
            }}
          />
        )
      ) : null}
    </div>
  );
}

function MonthlySelection({
  preview,
  organizationId,
  accountId,
  onQuoted,
  onArchived,
  onFrozen,
  onPending,
  refreshNonce,
  preparationCurrent,
  refreshing,
}: Props & {
  preview: MonthlyOfferSetPreview;
  onQuoted: () => void;
  onArchived: () => void;
  onFrozen: (offerId: string) => void;
  onPending: (pending: boolean) => void;
  refreshNonce: number;
  preparationCurrent: boolean;
  refreshing: boolean;
}) {
  const { fmt } = useLocale();
  const initialChoice =
    preview.choices.find(
      (c) => c.available && c.offerId === preview.selectedOfferId
    ) ?? preview.choices.find((c) => c.available);
  const [tier, setTier] = useState<SubscriptionTier>(
    initialChoice?.available ? initialChoice.identity.tier : 'starter'
  );
  const [accepted, setAccepted] = useState(false);
  const [locked, setLocked] = useState(!!preview.selectedOfferId);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const busy = useRef(false);
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
      await Promise.resolve();
      if (!cancelled) setAccepted(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);
  const choice = preview.choices.find(
    (c) => c.available && c.identity.tier === tier
  );
  const offer = choice?.available ? choice : null;
  const overCap =
    !!offer && preview.activeBranches.length > offer.identity.includedBranches;
  const initiation =
    process.env.NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI === 'true';
  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/subscriptions/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === 'string'
          ? data.error
          : 'Could not continue. Refresh offers and try again.'
      );
    return data;
  }
  async function approve() {
    if (
      !offer ||
      !preview.offerSetId ||
      !accepted ||
      overCap ||
      !initiation ||
      !preview.capabilitiesEnabled ||
      !preparationCurrent ||
      refreshing ||
      busy.current
    )
      return;
    busy.current = true;
    onPending(true);
    onFrozen(offer.offerId);
    setPending(true);
    setLocked(true);
    try {
      let id = reviewId;
      if (!id) {
        const result = await post('monthly-review', {
          organizationId,
          accountId,
          offerSetId: preview.offerSetId,
          offerId: offer.offerId,
          seenAmountMinor: offer.identity.amountMinor,
          termsAccepted: true,
        });
        if (!alive.current) return;
        if (
          result.reviewed !== true ||
          result.offerId !== offer.offerId ||
          typeof result.reviewId !== 'string'
        )
          throw new Error(
            'Could not check your saved review. Contact support.'
          );
        id = result.reviewId;
        setReviewId(id);
      }
      const result = await post('monthly-quotes', {
        organizationId,
        accountId,
        requestId,
        reviewId: id,
        offerId: offer.offerId,
        seenAmountMinor: offer.identity.amountMinor,
      });
      if (!alive.current) return;
      const quote = result.quote;
      const identity = monthlyIdentityFromRow(quote);
      if (
        !identity ||
        quote.request_id !== requestId ||
        quote.organization_id !== organizationId ||
        quote.monthly_offer_id !== offer.offerId ||
        identity.tier !== tier ||
        !Number.isFinite(Date.parse(quote.expires_at)) ||
        Date.parse(quote.expires_at) <= Date.now()
      )
        throw new Error(
          'Could not check the reviewed amount. Refresh billing or contact support.'
        );
      setAccepted(false);
      onQuoted();
    } catch (error) {
      if (alive.current) {
        setAccepted(false);
        setMessage(
          getErrorMessage(
            error,
            'Could not save your review. Refresh offers and try again.'
          )
        );
      }
    } finally {
      busy.current = false;
      if (alive.current) {
        setPending(false);
        onPending(false);
      }
    }
  }
  async function archive(ids: readonly string[]) {
    if (!offer || !preview.offerSetId || busy.current || !initiation) return;
    busy.current = true;
    onPending(true);
    try {
      const result = await post('monthly-archive', {
        organizationId,
        accountId,
        offerSetId: preview.offerSetId,
        accountIds: ids,
      });
      if (!alive.current) return;
      if (
        result.result?.archived_count !== ids.length ||
        result.result.preparation_stale !== true
      )
        throw new Error(
          'Could not check archived branches. Refresh offers before continuing.'
        );
      toast.success('Branches archived');
      onArchived();
    } catch (error) {
      if (alive.current)
        toast.error(
          getErrorMessage(error, 'Could not archive branches. Try again.')
        );
    } finally {
      busy.current = false;
      if (alive.current) onPending(false);
    }
  }
  const label = SUBSCRIPTION_PLANS[tier].label;
  return (
    <div className="space-y-4">
      <SubscriptionPlanCards
        purchaseMode="monthly"
        offers={preview.choices}
        formatMoney={fmt.money}
        selectedTier={tier}
        onSelect={
          locked
            ? undefined
            : (next) => {
                setTier(next);
                setAccepted(false);
                setMessage('');
              }
        }
      />
      {offer ? (
        <Alert>
          <AlertTitle>Review UsefulDesk {label}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              <span className="tabular-nums">
                {fmt.money(offer.identity.amountMinor / 100, 'INR')}
              </span>{' '}
              for one calendar month. {offer.identity.includedBranches}{' '}
              {offer.identity.includedBranches === 1 ? 'branch' : 'branches'}{' '}
              included.
            </p>
            <p>
              Billing branch:{' '}
              {
                preview.activeBranches.find((b) => b.accountId === accountId)
                  ?.name
              }
              .
            </p>
            <p>{offer.taxNote}</p>
            <p>{offer.termsNote}</p>
            <p>{offer.refundNote}</p>
            <p>
              Paid access starts after your payment is verified. We do not debit
              you automatically.
            </p>
            {locked ? (
              <p>
                Your selected offer is saved for payment. Contact support to
                change it.
              </p>
            ) : null}
            {message ? <p role="status">{message}</p> : null}
            <div className="flex items-start gap-2">
              <Checkbox
                id="monthly-offer-consent"
                checked={accepted}
                disabled={pending}
                onCheckedChange={(v) => setAccepted(v === true)}
              />
              <Label htmlFor="monthly-offer-consent">
                I reviewed this {label} offer and its payment and refund terms.
              </Label>
            </div>
            {overCap && !locked ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setArchiveOpen(true)}
              >
                Review branches
              </Button>
            ) : null}
            <ResolvableAction
              blocker={
                overCap
                  ? {
                      title: 'Review branches first',
                      description: `Keep ${offer.identity.includedBranches} active ${offer.identity.includedBranches === 1 ? 'branch' : 'branches'}. Your billing branch stays active.`,
                      resolution: {
                        label: 'Review branches',
                        onResolve: () => setArchiveOpen(true),
                      },
                    }
                  : !preparationCurrent
                    ? {
                        title: 'Your saved offer needs a review',
                        description:
                          'Your preparation changed. Contact support before continuing payment.',
                      }
                    : !initiation || !preview.capabilitiesEnabled
                      ? {
                          title: 'Payment is paused',
                          description:
                            'Contact support to review your payment.',
                        }
                      : null
              }
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!accepted || refreshing}
                  loading={pending}
                >
                  {reviewId ? 'Continue to payment' : `Approve ${label} offer`}
                </Button>
              }
              onAction={() => void approve()}
            />
          </AlertDescription>
        </Alert>
      ) : null}
      {offer && archiveOpen ? (
        <SubscriptionConversionReviewDialog
          open
          onOpenChange={setArchiveOpen}
          organizationId={organizationId}
          organizationRole="owner"
          tier={tier}
          branches={preview.activeBranches.map((b) => ({
            account_id: b.accountId,
            account_name: b.name,
            organization_id: organizationId,
            branch_status: 'active',
          }))}
          purchases={[]}
          keepAccountId={accountId}
          archiveConsequence={ARCHIVE_CONSEQUENCE}
          onArchive={archive}
        />
      ) : null}
    </div>
  );
}
