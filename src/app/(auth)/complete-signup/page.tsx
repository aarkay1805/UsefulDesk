import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';

import { CompleteSignupAccessError } from '@/components/auth/complete-signup-access-error';
import { CompleteSignupForm } from '@/components/auth/complete-signup-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { UnauthorizedError } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { getDashboardAuthRequestContext } from '@/lib/auth/dashboard-request-context';
import { canCompleteOrganizationNameSetup } from '@/lib/auth/roles';

export const metadata: Metadata = {
  title: 'Name your gym',
};

type CompleteSignupSearchParams = Promise<{
  branch?: string | string[];
}>;

export default async function CompleteSignupPage({
  searchParams,
}: {
  searchParams: CompleteSignupSearchParams;
}) {
  const query = await searchParams;
  const hasExplicitBranch = Object.prototype.hasOwnProperty.call(
    query,
    'branch'
  );
  const explicitBranch =
    typeof query.branch === 'string' && isBranchAccountId(query.branch)
      ? query.branch
      : null;

  let context;
  try {
    context = await getDashboardAuthRequestContext();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect('/login');
    throw error;
  }

  if (hasExplicitBranch && !explicitBranch) {
    return <CompleteSignupAccessError message="This branch link is invalid." />;
  }

  const account = context.bootstrap.account;
  if (hasExplicitBranch && account?.id !== explicitBranch) {
    const lookupFailed = context.bootstrap.branchAccessStatus === 'unavailable';
    return (
      <CompleteSignupAccessError
        message={
          lookupFailed
            ? "We couldn't verify access to this branch right now. Please retry."
            : 'You do not have access to this branch.'
        }
        retryHref={
          lookupFailed && explicitBranch
            ? `/complete-signup?branch=${encodeURIComponent(explicitBranch)}`
            : undefined
        }
      />
    );
  }

  if (!hasExplicitBranch) {
    if (!account) {
      return (
        <CompleteSignupAccessError
          message="Could not load your default branch. Please retry."
          retryHref="/complete-signup"
        />
      );
    }
    redirect(`/complete-signup?branch=${encodeURIComponent(account.id)}`);
  }

  if (!account || !explicitBranch) {
    return <CompleteSignupAccessError message="Could not load this branch." />;
  }

  const retryHref = `/complete-signup?branch=${encodeURIComponent(account.id)}`;
  if (
    context.bootstrap.branchAccessError ||
    context.bootstrap.organizationNameSetupState === 'unavailable'
  ) {
    return (
      <CompleteSignupAccessError
        message="We couldn't verify your gym setup right now. Please retry."
        retryHref={retryHref}
      />
    );
  }

  if (context.bootstrap.organizationNameSetupState === 'complete') {
    redirect(`/dashboard?branch=${encodeURIComponent(account.id)}`);
  }

  const selectedBranch = context.bootstrap.branches.find(
    (branch) => branch.account_id === account.id
  );
  if (
    !selectedBranch ||
    !canCompleteOrganizationNameSetup(
      selectedBranch.is_organization_owner ? 'owner' : null,
      selectedBranch.role
    )
  ) {
    return (
      <CompleteSignupAccessError message="Only this organization's owner can name the gym." />
    );
  }

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex size-12 items-center justify-center rounded-xl">
            <Building2 className="text-primary-text size-6" />
          </div>
          <CardTitle>Name your gym</CardTitle>
          <CardDescription>
            This brand is shown to your team and suggested as your first branch
            name. Add your legal business name later in Business details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompleteSignupForm accountId={account.id} />
        </CardContent>
      </Card>
    </main>
  );
}
