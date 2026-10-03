'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useLocale } from '@/hooks/use-locale';
import { monthlyCatalogOffer } from '@/lib/subscriptions/monthly-contract';
import {
  SUBSCRIPTION_PLANS,
  type SubscriptionTier,
} from '@/lib/subscriptions/plans';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

const evidenceFields = {
  authorization_reference: 'Operator authorization',
  buyer_geography_reference: 'Buyer and billing geography review',
  issuer_financial_year_reference: 'Supplier and financial year review',
  tax_receipt_review_reference: 'Tax and document review',
  refund_policy_reference: 'Refund and support review',
  merchant_approval_reference: 'Payment account review',
  provider_acceptance_reference: 'Payment acceptance evidence',
  backup_recovery_reference: 'Backup and recovery evidence',
  capability_readiness_reference: 'Plan features and branch limit review',
  release_sha: 'Reviewed release SHA',
  migration_manifest_sha256: 'Reviewed migration manifest SHA-256',
} as const;
const missingLabels: Record<string, string> = {
  verified_owner: 'Confirm one actual verified owner.',
  normal_trial: 'Review the trial and any access exception.',
  active_branch: 'Add an active branch.',
  billing_branch: 'Choose an active billing branch.',
  inr_branch: 'Confirm INR billing for every active branch.',
  buyer_details: 'Complete buyer details for every active branch.',
  gym_setup: 'Review gym setup and active plan prices for every branch.',
  payment_readiness: 'Review payment intake and settlement readiness.',
  standard_reminders: 'Review the approved standard reminder schedule.',
  existing_obligation: 'Resolve the existing payment or subscription first.',
  internal_organization: 'This gym business uses its existing payment review.',
};
const tiers: SubscriptionTier[] = ['starter', 'growth', 'ultimate'];
type Draft = {
  included: boolean;
  totalReviewed: boolean;
  documentReviewed: boolean;
  offer_reference: string;
  customer_tax_note: string;
  customer_terms_note: string;
  customer_refund_note: string;
};
const emptyDraft = (): Draft => ({
  included: false,
  totalReviewed: false,
  documentReviewed: false,
  offer_reference: '',
  customer_tax_note: '',
  customer_terms_note: '',
  customer_refund_note: '',
});
type Context = {
  snapshot_token: string;
  branches: { account_id: string; name: string; currency: string }[];
  missing_facts: string[];
  offer_set_id: string | null;
  stale: boolean;
};

export function MonthlyOfferPreparation({
  organizationId,
}: {
  organizationId: string;
}) {
  const { fmt } = useLocale();
  const [billingBranch, setBillingBranch] = useState('');
  const [context, setContext] = useState<Context | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<SubscriptionTier, Draft>>(() => ({
    starter: emptyDraft(),
    growth: emptyDraft(),
    ultimate: emptyDraft(),
  }));
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setContext(null);
      setReviewed(false);
      setError('');
      try {
        const { data, error } = await createClient().rpc(
          'platform_admin_monthly_offer_context',
          {
            p_organization_id: organizationId,
            p_billing_account_id: billingBranch || null,
          }
        );
        if (error) throw error;
        if (!cancelled) setContext(data);
      } catch (err) {
        if (!cancelled)
          setError(
            getErrorMessage(
              err,
              'Could not load the review. Refresh and try again.'
            )
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, billingBranch, nonce]);
  function updateDraft(tier: SubscriptionTier, change: Partial<Draft>) {
    setReviewed(false);
    setDrafts((old) => ({ ...old, [tier]: { ...old[tier], ...change } }));
  }
  const included = tiers.filter((tier) => drafts[tier].included);
  const complete =
    !!billingBranch &&
    !!context &&
    context.missing_facts.length === 0 &&
    included.length > 0 &&
    Object.keys(evidenceFields).every((key) => evidence[key]?.trim()) &&
    included.every((tier) => {
      const d = drafts[tier];
      return (
        d.totalReviewed &&
        d.documentReviewed &&
        d.offer_reference.trim() &&
        d.customer_tax_note.trim() &&
        d.customer_terms_note.trim() &&
        d.customer_refund_note.trim()
      );
    });
  async function prepare() {
    if (!complete || !reviewed || !context || pending) return;
    setPending(true);
    setError('');
    try {
      const { error } = await createClient().rpc(
        'platform_admin_prepare_monthly_offers',
        {
          p_organization_id: organizationId,
          p_billing_account_id: billingBranch,
          p_expected_snapshot: context.snapshot_token,
          p_facts_reviewed: true,
          p_evidence: evidence,
          p_offers: included.map((tier) => ({
            tier,
            amount_minor: monthlyCatalogOffer(tier).amountMinor,
            offer_reference: drafts[tier].offer_reference,
            customer_tax_note: drafts[tier].customer_tax_note,
            customer_terms_note: drafts[tier].customer_terms_note,
            customer_refund_note: drafts[tier].customer_refund_note,
            document_treatment: 'usefulmade_unregistered_invoice_receipt_v1',
          })),
        }
      );
      if (error) throw error;
      toast.success('Offers prepared. Payment stays closed.');
      setNonce((n) => n + 1);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          'Could not prepare offers. Refresh and review the details.'
        )
      );
    } finally {
      setReviewed(false);
      setPending(false);
    }
  }
  const prefix = `monthly-${organizationId}`;
  return (
    <section className="mt-6 space-y-4" aria-labelledby={`${prefix}-title`}>
      <h3 id={`${prefix}-title`} className="font-semibold">
        Prepare monthly offers
      </h3>
      <p className="text-muted-foreground text-sm">
        Review the exact payable total and customer notes for each included
        plan. The trial keeps its full deadline. Payment stays closed.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        variant="outline"
        loading={!context && !error}
        onClick={() => {
          setReviewed(false);
          setNonce((n) => n + 1);
        }}
        disabled={pending}
      >
        Refresh facts
      </Button>
      {!context && !error ? <p role="status">Loading review…</p> : null}
      {context ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-branch`}>Billing branch</Label>
            <Select
              value={billingBranch || null}
              onValueChange={(value) => {
                setReviewed(false);
                setBillingBranch(value || '');
              }}
              disabled={pending}
            >
              <SelectTrigger id={`${prefix}-branch`} className="w-full">
                <SelectValue placeholder="Choose billing branch" />
              </SelectTrigger>
              <SelectContent>
                {context.branches.map((branch) => (
                  <SelectItem key={branch.account_id} value={branch.account_id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-muted-foreground text-sm">
            {context.branches.length} active branches. Offers can be reviewed
            before extra branches are archived.
          </p>
          {context.missing_facts.length ? (
            <Alert>
              <AlertDescription>
                <ul>
                  {context.missing_facts.map((fact) => (
                    <li key={fact}>
                      {missingLabels[fact] ||
                        'Review the missing facts with support.'}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {context.offer_set_id ? (
            <Alert>
              <AlertDescription>
                {context.stale
                  ? 'Details changed. Preparing fresh offers replaces the old review.'
                  : 'Offers are already prepared. A changed review needs separate resolution.'}
              </AlertDescription>
            </Alert>
          ) : null}
          {tiers.map((tier) => {
            const draft = drafts[tier];
            const plan = SUBSCRIPTION_PLANS[tier];
            const identity = monthlyCatalogOffer(tier);
            return (
              <Card key={tier}>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${prefix}-${tier}`}
                      checked={draft.included}
                      onCheckedChange={(checked) =>
                        updateDraft(tier, { included: checked === true })
                      }
                      disabled={pending}
                    />
                    <Label htmlFor={`${prefix}-${tier}`}>
                      Include {plan.label}
                    </Label>
                  </div>
                  <p className="text-sm">
                    <span className="tabular-nums">
                      {fmt.money(identity.amountMinor / 100, identity.currency)}
                    </span>{' '}
                    per calendar month · {identity.includedBranches}{' '}
                    {identity.includedBranches === 1 ? 'branch' : 'branches'}
                  </p>
                  {draft.included ? (
                    <>
                      {(
                        [
                          'offer_reference',
                          'customer_tax_note',
                          'customer_terms_note',
                          'customer_refund_note',
                        ] as const
                      ).map((key) => {
                        const labels = {
                          offer_reference: 'offer reference',
                          customer_tax_note: 'tax note',
                          customer_terms_note: 'terms',
                          customer_refund_note: 'refund note',
                        };
                        return (
                          <div key={key} className="space-y-2">
                            <Label htmlFor={`${prefix}-${tier}-${key}`}>
                              {plan.label} {labels[key]}
                            </Label>
                            <Textarea
                              id={`${prefix}-${tier}-${key}`}
                              value={draft[key]}
                              maxLength={2000}
                              disabled={pending}
                              onChange={(e) =>
                                updateDraft(tier, { [key]: e.target.value })
                              }
                            />
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`${prefix}-${tier}-total`}
                          checked={draft.totalReviewed}
                          disabled={pending}
                          onCheckedChange={(checked) =>
                            updateDraft(tier, {
                              totalReviewed: checked === true,
                            })
                          }
                        />
                        <Label htmlFor={`${prefix}-${tier}-total`}>
                          {plan.label} exact total reviewed
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`${prefix}-${tier}-document`}
                          checked={draft.documentReviewed}
                          disabled={pending}
                          onCheckedChange={(checked) =>
                            updateDraft(tier, {
                              documentReviewed: checked === true,
                            })
                          }
                        />
                        <Label htmlFor={`${prefix}-${tier}-document`}>
                          {plan.label} unregistered-supplier invoice and receipt
                          treatment reviewed
                        </Label>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
          <p className="text-muted-foreground text-sm">
            Enter references to actual reviews. A filled field alone is not
            proof of approval.
          </p>
          {Object.entries(evidenceFields).map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`${prefix}-${key}`}>{label}</Label>
              <Input
                id={`${prefix}-${key}`}
                value={evidence[key] || ''}
                maxLength={2000}
                disabled={pending}
                onChange={(e) => {
                  setReviewed(false);
                  setEvidence((old) => ({ ...old, [key]: e.target.value }));
                }}
              />
            </div>
          ))}
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${prefix}-reviewed`}
              checked={reviewed}
              disabled={pending}
              onCheckedChange={(checked) => setReviewed(checked === true)}
            />
            <Label htmlFor={`${prefix}-reviewed`}>
              I checked the buyer, setup, exact totals and every review
              reference.
            </Label>
          </div>
          {!complete ? (
            <p className="text-muted-foreground text-sm">
              Choose a branch and plan. Complete every review field and check
              each total.
            </p>
          ) : null}
          {!context.offer_set_id || context.stale ? (
            <Button
              loading={pending}
              disabled={!complete || !reviewed}
              onClick={() => void prepare()}
            >
              Prepare offers
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
