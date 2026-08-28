import { Suspense, type ReactNode } from 'react';

import {
  getDashboardRequestContext,
  requireDashboardAccountContext,
} from '@/lib/auth/dashboard-request-context';
import {
  loadDashboardActionSnapshot,
  selectDashboardActionSection,
  type DashboardActionSection,
  type DashboardActionSnapshot,
} from '@/lib/dashboard/action-snapshot';
import { DashboardActionsProvider } from './dashboard-actions';

/** Start the selected-branch action read once per dashboard request. */
export async function loadDashboardActionSnapshotForRequest() {
  const requestContext = await getDashboardRequestContext();
  const account = requireDashboardAccountContext(requestContext);
  return loadDashboardActionSnapshot(account.supabase, account.dateContext);
}

export async function DashboardActionSectionData({
  snapshot,
  section,
  children,
}: {
  snapshot: Promise<DashboardActionSnapshot>;
  section: DashboardActionSection;
  children: ReactNode;
}) {
  const sectionSnapshot = selectDashboardActionSection(await snapshot, section);

  return (
    <DashboardActionsProvider initialSnapshot={sectionSnapshot}>
      {children}
    </DashboardActionsProvider>
  );
}

export function DashboardActionSectionStream({
  snapshot,
  section,
  children,
}: {
  snapshot: Promise<DashboardActionSnapshot>;
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
      <DashboardActionSectionData snapshot={snapshot} section={section}>
        {children}
      </DashboardActionSectionData>
    </Suspense>
  );
}
