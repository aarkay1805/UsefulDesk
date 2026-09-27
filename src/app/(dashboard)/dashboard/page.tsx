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
// Below the first fold, Home is only people who need action: committed
// follow-ups beside expiring memberships, then enquiries nobody has contacted
// beside the exceptions no queue owns. History does not live here. Recent
// activity, the message chart, and the enquiry score described what already
// happened without naming who needs help; enquiry stages moved to Business →
// Performance, which Today at a glance already links to. See
// docs/dashboard-benchmark-2026-09-27.md.
//
// The work reads as two rows of two rather than a single column, so the whole
// of today's work fits one screen instead of four scroll-lengths. Each pair
// keeps its reading order left to right, and every one of the four carries the
// shared paired-section layout, so a long queue scrolls in its card and the row
// below it stays where the reader left it.
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

      {/* Peer sections sharing a row — each keeps its own heading and card
          rather than being clubbed under a wrapper heading. The stream wrapper
          renders no element of its own, so the grid item is the section itself
          and each one carries its own DASHBOARD_PAIRED_SECTION. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-8 lg:grid-cols-2">
        <DashboardActionSectionStream
          snapshot={actionSnapshot}
          section="followUps"
        >
          <FollowUpQueue />
        </DashboardActionSectionStream>
        <DashboardActionSectionStream
          snapshot={actionSnapshot}
          section="expiringMemberships"
        >
          <ExpiringMemberships />
        </DashboardActionSectionStream>
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-8 lg:grid-cols-2">
        <DashboardActionSectionStream
          snapshot={actionSnapshot}
          section="uncontactedLeads"
        >
          <UncontactedLeads />
        </DashboardActionSectionStream>
        <DashboardActionSectionStream
          snapshot={actionSnapshot}
          section="attention"
        >
          <NeedsAttentionCard />
        </DashboardActionSectionStream>
      </div>
    </div>
  );
}
