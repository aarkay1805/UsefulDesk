import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { UnauthorizedError } from '@/lib/auth/account';
import { getDashboardRequestContext } from '@/lib/auth/dashboard-request-context';
import { CompleteSignupAccessError } from '@/components/auth/complete-signup-access-error';
import { DashboardShell } from './dashboard-shell';

// Server layout for the authenticated app. The proxy provides the fast redirect,
// but this boundary independently verifies the user before any dashboard shell
// or page renders. Metadata remains a crawler-level belt-and-suspenders guard.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let context;
  try {
    context = await getDashboardRequestContext();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect('/login');
    throw error;
  }

  if (
    context.bootstrap.organizationNameSetupState === 'pending' &&
    context.bootstrap.account
  ) {
    redirect(
      `/complete-signup?branch=${encodeURIComponent(context.bootstrap.account.id)}`
    );
  }

  if (context.bootstrap.organizationNameSetupState === 'unavailable') {
    const fallbackBranch = context.bootstrap.branches.find(
      (branch) => branch.branch_status !== 'archived'
    );
    const selectionFailed = ['invalid', 'forbidden', 'archived'].includes(
      context.bootstrap.branchAccessStatus
    );
    const fallbackHref =
      selectionFailed && fallbackBranch
        ? `/dashboard?branch=${encodeURIComponent(fallbackBranch.account_id)}`
        : undefined;
    const fallbackLabel = fallbackBranch
      ? `Open ${fallbackBranch.account_name}`
      : 'Retry';
    return (
      <CompleteSignupAccessError
        message={
          context.bootstrap.branchAccessError ??
          "We couldn't verify your gym setup right now. Please retry."
        }
        retryHref={fallbackHref}
        retryCurrent={!fallbackHref}
        actionLabel={fallbackHref ? fallbackLabel : 'Retry'}
      />
    );
  }

  return (
    <DashboardShell
      initialUser={context.user}
      initialBootstrap={context.bootstrap}
      initialProductAccess={
        context.account
          ? {
              accountId: context.account.accountId,
              organizationId: context.account.account.organizationId,
              snapshot: context.account.productAccess,
            }
          : null
      }
    >
      {children}
    </DashboardShell>
  );
}
