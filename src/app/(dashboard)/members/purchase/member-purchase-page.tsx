'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CircleAlert, Loader2, X } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canSellProductsServices } from '@/lib/auth/roles';
import { resolveMemberPurchaseReturn } from '@/lib/members/member-purchase-navigation';
import { createClient } from '@/lib/supabase/client';
import type { Membership } from '@/types';
import { MemberIdentity } from '@/components/members/member-identity';
import { ProductServiceSaleCheckout } from '@/components/members/product-service-sale-checkout';
import { PageHeaderActions } from '@/components/layout/page-header-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface MemberPurchasePageProps {
  membershipId: string | null;
  returnTo: string | null;
}

interface LoadFailure {
  title: string;
  description: string;
}

function PurchasePageFailure({
  failure,
  onBack,
  backLoading,
}: {
  failure: LoadFailure;
  onBack: () => void;
  backLoading: boolean;
}) {
  return (
    <div className="max-w-xl space-y-3">
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>{failure.title}</AlertTitle>
        <AlertDescription>{failure.description}</AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        loading={backLoading}
      >
        <ArrowLeft className="size-4" /> Back to members
      </Button>
    </div>
  );
}

export function MemberPurchasePage({
  membershipId,
  returnTo,
}: MemberPurchasePageProps) {
  const router = useRouter();
  const supabase = createClient();
  const { accountRole, profileLoading } = useAuth();
  const { fmt } = useLocale();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [checkoutSaving, setCheckoutSaving] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const safeReturn = resolveMemberPurchaseReturn(returnTo, membershipId ?? '');
  const canSell = accountRole ? canSellProductsServices(accountRole) : false;

  useEffect(() => {
    if (!membershipId || profileLoading || !canSell) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('*, contact:contacts(*), plan:membership_plans(*)')
        .eq('id', membershipId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setLoadFailure({
          title: 'Unable to load member',
          description:
            'Check that this member still exists and that you have access, then try again.',
        });
      } else if (!data) {
        setLoadFailure({
          title: 'Member not found',
          description:
            'This purchase link does not point to an available member.',
        });
      } else {
        setMembership(data as Membership);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [canSell, membershipId, profileLoading, supabase]);

  const navigateBack = () => {
    setNavigationPending(true);
    router.push(safeReturn);
  };

  if (!membershipId) {
    return (
      <PurchasePageFailure
        failure={{
          title: 'Member not found',
          description:
            'Open Add purchase from a member profile to start a checkout.',
        }}
        onBack={navigateBack}
        backLoading={navigationPending}
      />
    );
  }

  if (!profileLoading && !canSell) {
    return (
      <PurchasePageFailure
        failure={{
          title: 'Purchase access required',
          description:
            'Your account can view this member, but it cannot create purchases.',
        }}
        onBack={navigateBack}
        backLoading={navigationPending}
      />
    );
  }

  if (profileLoading || loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading member…
      </div>
    );
  }

  if (loadFailure || !membership) {
    return (
      <PurchasePageFailure
        failure={
          loadFailure ?? {
            title: 'Member not found',
            description:
              'This purchase link does not point to an available member.',
          }
        }
        onBack={navigateBack}
        backLoading={navigationPending}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0">
      <PageHeaderActions>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close add purchase"
          title="Close add purchase"
          disabled={checkoutSaving}
          loading={navigationPending}
          onClick={navigateBack}
        >
          <X className="size-4" />
        </Button>
      </PageHeaderActions>

      <section aria-label="Member" className="mb-4 min-w-0">
        <MemberIdentity
          name={membership.contact?.name}
          src={membership.contact?.avatar_url}
          size="lg"
          meta={
            <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span>
                Member ID{' '}
                <span className="text-foreground tabular-nums">
                  {membership.member_number}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-foreground">
                {membership.plan?.name || 'No plan'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Expiry{' '}
                <span className="text-foreground tabular-nums">
                  {fmt.date(membership.end_date)}
                </span>
              </span>
            </p>
          }
        />
      </section>

      <ProductServiceSaleCheckout
        membership={membership}
        mode="sale"
        onCancel={navigateBack}
        onSavingChange={setCheckoutSaving}
        onSaved={navigateBack}
        showCancel={false}
        submitFullWidth
      />
    </div>
  );
}
