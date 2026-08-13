'use client';

import Link from 'next/link';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { BranchSetupStatusBadge } from '@/components/branches/branch-setup-status-badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { canCompleteBranchSetup } from '@/lib/auth/roles';
import { hasBranchSetupPrerequisite } from '@/lib/branches/setup';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';

type PrerequisiteState = 'loading' | 'met' | 'missing' | 'error';

export function BranchSetupReviewCard({ className }: { className?: string }) {
  const { account, accountRole, refreshProfile } = useAuth();
  const alreadyReviewed =
    account?.readiness_state === 'ready' && account.setup_reviewed_at !== null;
  const [prerequisite, setPrerequisite] =
    useState<PrerequisiteState>('loading');
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (!account?.id || alreadyReviewed) return;
    let cancelled = false;
    const accountId = account.id;

    void (async () => {
      await Promise.resolve();
      if (!cancelled) setPrerequisite('loading');

      const { data, error } = await createClient()
        .from('membership_plans')
        .select('is_active, pricing_options:plan_pricing_options(is_active)')
        .eq('account_id', accountId)
        .eq('is_active', true);

      if (cancelled) return;
      if (error) {
        console.error('[BranchSetupReviewCard] prerequisite failed:', error);
        setPrerequisite('error');
        return;
      }

      setPrerequisite(
        hasBranchSetupPrerequisite(data ?? []) ? 'met' : 'missing'
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.id, alreadyReviewed]);

  if (!account) return null;
  const accountId = account.id;

  const reviewed = alreadyReviewed;
  const branchActive = account.branch_status === 'active';
  const canComplete = accountRole ? canCompleteBranchSetup(accountRole) : false;

  async function completeSetup() {
    if (completing || !branchActive || prerequisite !== 'met') return;
    setCompleting(true);
    try {
      const response = await fetch(
        `/api/organization/branches/${accountId}/complete-setup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ configurationReviewed: true }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || 'Could not complete branch setup');
      }
      await refreshProfile();
      toast.success('Branch configuration marked as reviewed');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not complete branch setup.'));
    } finally {
      setCompleting(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {reviewed ? (
            <CheckCircle2 className="text-emerald-foreground size-4" />
          ) : (
            <CircleAlert className="text-amber-foreground size-4" />
          )}
          Branch setup review
        </CardTitle>
        <CardDescription>
          {reviewed
            ? 'Core branch configuration has been reviewed.'
            : 'Review this branch’s core configuration before marking setup complete.'}
        </CardDescription>
        <CardAction>
          <BranchSetupStatusBadge
            readinessState={account.readiness_state}
            setupReviewedAt={account.setup_reviewed_at}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {reviewed ? (
          <p className="text-muted-foreground text-sm">
            The core branch configuration review is recorded. Recheck setup
            after material configuration changes.
          </p>
        ) : !branchActive ? (
          <p className="text-muted-foreground text-sm">
            This branch must be active before its setup review can be completed.
          </p>
        ) : prerequisite === 'loading' ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Checking plan setup…
          </p>
        ) : prerequisite === 'error' ? (
          <p className="text-muted-foreground text-sm">
            Plan readiness could not be checked. Refresh before completing the
            review.
          </p>
        ) : prerequisite === 'missing' ? (
          <p className="text-muted-foreground text-sm">
            Add at least one active membership plan with an active pricing
            option before completing this review.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Confirm plans, lead setup, reminder timing, automations, and flows
            are appropriate for this branch.
          </p>
        )}

        <p className="text-muted-foreground text-xs">
          WhatsApp, payments, templates, staff, trainers, credentials, and
          provider connections are separate and may still need setup.
        </p>

        {canComplete && !reviewed ? (
          <div className="flex flex-wrap items-center gap-2">
            {prerequisite === 'missing' ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/settings?tab=plans" />}
              >
                Set up plans
              </Button>
            ) : null}
            <Button
              onClick={() => void completeSetup()}
              disabled={completing || !branchActive || prerequisite !== 'met'}
            >
              {completing ? <Loader2 className="size-4 animate-spin" /> : null}
              Mark configuration reviewed
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
