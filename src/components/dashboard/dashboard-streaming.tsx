import { Suspense, type ReactNode } from 'react';

import {
  getDashboardRequestContext,
  requireDashboardAccountContext,
} from '@/lib/auth/dashboard-request-context';
import {
  loadDashboardActionSection,
  type DashboardActionSection,
} from '@/lib/dashboard/action-snapshot';
import { DashboardActionsProvider } from './dashboard-actions';

export async function DashboardActionSectionData({
  section,
  children,
}: {
  section: DashboardActionSection;
  children: ReactNode;
}) {
  const requestContext = await getDashboardRequestContext();
  const account = requireDashboardAccountContext(requestContext);
  const snapshot = await loadDashboardActionSection(
    account.supabase,
    account.accountId,
    account.dateContext,
    section
  );

  return (
    <DashboardActionsProvider initialSnapshot={snapshot}>
      {children}
    </DashboardActionsProvider>
  );
}

export function DashboardActionSectionStream({
  section,
  children,
}: {
  section: DashboardActionSection;
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <DashboardActionsProvider autoLoad={false}>
          {children}
        </DashboardActionsProvider>
      }
    >
      <DashboardActionSectionData section={section}>
        {children}
      </DashboardActionSectionData>
    </Suspense>
  );
}
