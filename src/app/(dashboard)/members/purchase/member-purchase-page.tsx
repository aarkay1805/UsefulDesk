'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CircleAlert, Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canSellProductsServices } from '@/lib/auth/roles';
import { resolveMemberPurchaseReturn } from '@/lib/members/member-purchase-navigation';
import { createClient } from '@/lib/supabase/client';
import type { Membership } from '@/types';
import { MemberIdentity } from '@/components/members/member-identity';
import { ProductServiceSaleCheckout } from '@/components/members/product-service-sale-checkout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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
}: {
  failure: LoadFailure;
  onBack: () => void;
}) {
  return (
    <div className="max-w-xl space-y-3">
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>{failure.title}</AlertTitle>
        <AlertDescription>{failure.description}</AlertDescription>
      </Alert>
      <Button type="button" variant="outline" onClick={onBack}>
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

  const navigateBack = () => router.push(safeReturn);

  if (!membershipId) {
    return (
      <PurchasePageFailure
        failure={{
          title: 'Member not found',
          description:
            'Open Add purchase from a member profile to start a checkout.',
        }}
        onBack={navigateBack}
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
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-4">
      <Card size="sm" className="min-w-0">
        <CardContent className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <MemberIdentity
            name={membership.contact?.name}
            secondary={membership.contact?.phone}
            src={membership.contact?.avatar_url}
            size="lg"
          />
          <dl className="grid w-full min-w-0 grid-cols-2 gap-x-6 gap-y-2 sm:max-w-md md:grid-cols-3">
            <div className="col-span-2 md:col-span-1">
              <dt className="text-muted-foreground text-xs">Member ID</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">
                {membership.member_number}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">Plan</dt>
              <dd className="mt-0.5 truncate text-sm font-medium">
                {membership.plan?.name || 'No plan'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Expiry</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">
                {fmt.date(membership.end_date)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <ProductServiceSaleCheckout
        membership={membership}
        mode="sale"
        onCancel={navigateBack}
        onSaved={navigateBack}
      />
    </div>
  );
}
