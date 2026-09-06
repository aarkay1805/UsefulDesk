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
  // The client gate owns the support screen. A blocked server context must
  // not start operational reads or serialize a rejected stream behind it.
  if (!requestContext.account) return null;
  const account = requireDashboardAccountContext(requestContext);
  return loadDashboardActionSnapshot(account.supabase, account.dateContext);
}

export async function DashboardActionSectionData({
  snapshot,
  section,
  children,
}: {
  snapshot: Promise<DashboardActionSnapshot | null>;
  section: DashboardActionSection;
  children: ReactNode;
}) {
  const resolvedSnapshot = await snapshot;
  if (!resolvedSnapshot) return null;
  const sectionSnapshot = selectDashboardActionSection(
    resolvedSnapshot,
    section
  );

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
  snapshot: Promise<DashboardActionSnapshot | null>;
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
