import { DeferredDashboardInsights } from '@/components/dashboard/deferred-dashboard-insights';
import { DashboardSection } from '@/components/dashboard/dashboard-section';
import { ExpiringMemberships } from '@/components/dashboard/expiring-memberships';
import { FollowUpQueue } from '@/components/dashboard/follow-up-queue';
import { GymMetrics } from '@/components/dashboard/gym-metrics';
import { NeedsAttentionCard } from '@/components/dashboard/needs-attention-card';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { UncontactedLeads } from '@/components/dashboard/uncontacted-leads';
import {
  DashboardActionSectionStream,
  loadDashboardActionSnapshotForRequest,
} from '@/components/dashboard/dashboard-streaming';

// One heading level for the page. Each block owns its own section and heading,
// so the page reads as a flat list of work rather than through grouping
// wrappers — "Work to do" and "The full picture" only restated the sections
// they contained, and pushed every real queue label down two levels.
//
// The work sections are ordered by what the action IS, not who it is about:
// committed follow-ups first (leads and members in one queue, filtered by
// chip), then the two queues that have no follow-up yet, then the exceptions
// no queue owns.
export default function DashboardPage() {
  const actionSnapshot = loadDashboardActionSnapshotForRequest();

  return (
    <div className="space-y-8">
      <DashboardActionSectionStream
        snapshot={actionSnapshot}
        section="gymMetrics"
      >
        <GymMetrics />
      </DashboardActionSectionStream>

      <DashboardSection id="quick-actions" title="Quick actions">
        <QuickActions />
      </DashboardSection>

      <DashboardActionSectionStream
        snapshot={actionSnapshot}
        section="followUps"
      >
        <FollowUpQueue />
      </DashboardActionSectionStream>

      {/* Two peer sections sharing a row — each keeps its own heading and card
          rather than being clubbed under a wrapper heading. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-8 lg:grid-cols-2">
        <DashboardActionSectionStream
          snapshot={actionSnapshot}
          section="expiringMemberships"
        >
          <ExpiringMemberships />
        </DashboardActionSectionStream>
        <DashboardActionSectionStream
          snapshot={actionSnapshot}
          section="uncontactedLeads"
        >
          <UncontactedLeads />
        </DashboardActionSectionStream>
      </div>

      <DashboardActionSectionStream
        snapshot={actionSnapshot}
        section="attention"
      >
        <NeedsAttentionCard />
      </DashboardActionSectionStream>

      <DeferredDashboardInsights />
    </div>
  );
}
