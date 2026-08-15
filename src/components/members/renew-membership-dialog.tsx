'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import {
  createMembershipCheckoutDraft,
  quoteMembershipCheckout,
} from '@/lib/memberships/checkout';
import { daysBetween } from '@/lib/memberships/expiry';
import { createClient } from '@/lib/supabase/client';
import type { Membership, MembershipCheckoutDraft } from '@/types';

import { MembershipCheckoutPanel } from './membership-checkout-panel';
import { useMembershipPlans } from './use-membership-plans';

interface RenewMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: Membership;
  onSaved: () => void;
  /** Existing invoice balances that remain due after this renewal. */
  outstandingBalance?: number;
  /** Trial conversion starts a new paid first cycle today. */
  variant?: 'renew' | 'convert';
}

export function RenewMembershipDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
  outstandingBalance = 0,
  variant = 'renew',
}: RenewMembershipDialogProps) {
  const { fmt } = useLocale();
  const { plans, loading } = useMembershipPlans(true);
  const isConvert = variant === 'convert';
  const today = fmt.today();
  const startDate =
    !isConvert &&
    membership.end_date &&
    daysBetween(today, membership.end_date) > 0
      ? membership.end_date
      : today;

  const [draft, setDraft] = useState<MembershipCheckoutDraft>(() =>
    createMembershipCheckoutDraft({
      planId: membership.plan_id,
      optionId: membership.pricing_option_id,
      startDate,
    })
  );
  const [saving, setSaving] = useState(false);
  const [availableCredit, setAvailableCredit] = useState(0);
  const [creditLoading, setCreditLoading] = useState(true);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setDraft(
        createMembershipCheckoutDraft({
          planId: membership.plan_id,
          optionId: membership.pricing_option_id,
          startDate,
        })
      );
      setSaving(false);
      setIdempotencyKey(crypto.randomUUID());
      setAvailableCredit(0);
      setCreditError(null);
      setCreditLoading(true);

      const supabase = createClient();
      const { data, error } = await supabase
        .from('member_credit_balances')
        .select('balance')
        .eq('account_id', membership.account_id)
        .eq('membership_id', membership.id);
      if (cancelled) return;
      if (error) {
        setCreditError(
          getErrorMessage(error, 'Member credit could not be loaded')
        );
        setCreditLoading(false);
        return;
      }
      setAvailableCredit(
        (data ?? []).reduce((sum, entry) => sum + Number(entry.balance ?? 0), 0)
      );
      setCreditLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    membership.account_id,
    membership.id,
    membership.plan_id,
    membership.pricing_option_id,
    open,
    startDate,
  ]);

  const selectedPlan = plans.find((plan) => plan.id === draft.planId) ?? null;
  const selectedOption =
    selectedPlan?.pricing_options?.find(
      (option) => option.id === draft.optionId && option.is_active
    ) ?? null;
  const displayName = membership.contact?.name || 'Unnamed member';
  const currentPlan =
    membership.plan ?? plans.find((plan) => plan.id === membership.plan_id);
  const mode = isConvert ? 'convert' : 'membership_renewal';

  async function handleCheckout() {
    if (creditLoading || creditError) {
      return toast.error(
        creditError || 'Wait for member credit to finish loading'
      );
    }
    if (!selectedPlan || !selectedOption) {
      return toast.error('Pick a plan and billing option');
    }

    let quote;
    try {
      quote = quoteMembershipCheckout({
        mode,
        option: selectedOption,
        startDate,
        discountKind: draft.discountKind,
        discountValue: draft.discountValue,
        bonusMonthsEnabled: draft.bonusMonthsEnabled,
        bonusMonths: draft.bonusMonths,
        selections: draft.includeProductsServices ? draft.selections : [],
        availableCredit,
      });
    } catch (error) {
      return toast.error(getErrorMessage(error, 'Invalid checkout details'));
    }

    setSaving(true);
    try {
      const response = await fetch('/api/member-checkouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          contact_id: membership.contact_id,
          membership_id: membership.id,
          membership: {
            plan_id: draft.planId,
            pricing_option_id: draft.optionId,
            period_start: startDate,
            discount_type: draft.discountKind,
            discount_value: draft.discountKind
              ? Number(draft.discountValue)
              : null,
            bonus_months: draft.bonusMonthsEnabled
              ? Number(draft.bonusMonths)
              : 0,
          },
          selections: draft.includeProductsServices ? draft.selections : [],
          collection: {
            collect_now: quote.cashDue > 0 && draft.collectNow,
            timing: quote.installmentsAvailable
              ? draft.collectionTiming
              : 'full',
            method: draft.paymentMethod,
            paid_at: new Date().toISOString(),
          },
          idempotency_key: idempotencyKey,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Checkout failed');

      toast.success(
        isConvert ? 'Trial converted to member' : 'Membership renewed'
      );
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to renew'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(96vh,900px)] max-h-[96vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(960px,calc(100vw-2rem))]">
        <DialogHeader className="border-border shrink-0 border-b p-5">
          <DialogTitle size="lg">
            {isConvert ? 'Convert trial to member' : 'Renew membership'}
          </DialogTitle>
          <DialogDescription>
            {isConvert
              ? 'Start this trial on a paid plan and record the first payment.'
              : "Extend this member's plan and record the renewal."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleCheckout();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <aside className="border-border border-b p-5 md:border-r md:border-b-0">
              <div className="flex items-center gap-4">
                <UserAvatar
                  size="lg"
                  name={displayName}
                  src={membership.contact?.avatar_url}
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-foreground truncate font-medium">
                    {displayName}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">
                    {membership.contact?.phone || 'No phone number'}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Member ID{' '}
                    <span className="font-mono tabular-nums">
                      {membership.member_number}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-7">
                <p className="text-foreground mb-3 text-sm font-semibold">
                  Current membership
                </p>
                <dl className="border-border divide-border divide-y overflow-hidden rounded-lg border">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-3 py-2.5 text-sm">
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="text-foreground max-w-40 truncate text-right font-medium">
                      {currentPlan?.name || 'Not available'}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-3 py-2.5 text-sm">
                    <dt className="text-muted-foreground">
                      {isConvert ? 'Trial ends' : 'Current expiry'}
                    </dt>
                    <dd className="text-foreground text-right font-medium">
                      {fmt.date(membership.end_date)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-3 py-2.5 text-sm">
                    <dt className="text-muted-foreground">Current fee</dt>
                    <dd className="text-foreground text-right font-medium tabular-nums">
                      {isConvert
                        ? 'No charge'
                        : fmt.money(membership.fee_amount)}
                    </dd>
                  </div>
                </dl>
              </div>

              {!isConvert && outstandingBalance > 0 ? (
                <div className="text-amber-foreground mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
                  <p className="font-medium tabular-nums">
                    {fmt.money(outstandingBalance)} still due
                  </p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Existing invoices stay due. This renewal creates a separate
                    invoice for the next term.
                  </p>
                </div>
              ) : null}
            </aside>

            <div className="min-w-0 space-y-6 p-5">
              {creditLoading ? (
                <div className="text-muted-foreground flex min-h-40 items-center justify-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Loading member credit…
                </div>
              ) : creditError ? (
                <div
                  role="alert"
                  className="text-destructive rounded-lg border p-4 text-sm"
                >
                  Member credit could not be loaded. Close and try again.
                </div>
              ) : (
                <MembershipCheckoutPanel
                  idPrefix="rn"
                  mode={mode}
                  plans={plans}
                  plansLoading={loading}
                  value={draft}
                  onChange={(next) => setDraft({ ...next, startDate })}
                  availableCredit={availableCredit}
                  startDateEditable={false}
                  renewalStartExplanation={
                    isConvert
                      ? 'Paid membership starts today.'
                      : 'Renewal starts after the current term, or today if expired.'
                  }
                />
              )}
            </div>
          </div>

          <DialogFooter className="border-border m-0 shrink-0">
            <p className="text-muted-foreground mr-auto hidden self-center text-xs sm:block">
              {isConvert ? 'Paid membership' : 'New term'} starts{' '}
              {fmt.date(startDate)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                loading ||
                creditLoading ||
                !!creditError ||
                !selectedPlan ||
                !selectedOption
              }
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {isConvert ? 'Convert trial to member' : 'Renew membership'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
