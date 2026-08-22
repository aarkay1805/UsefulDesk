import { DashboardInsights } from '@/components/dashboard/dashboard-insights';
import { DashboardSection } from '@/components/dashboard/dashboard-section';
import { GymMetrics } from '@/components/dashboard/gym-metrics';
import { LeadActionLists } from '@/components/dashboard/lead-action-lists';
import { MembershipActionLists } from '@/components/dashboard/membership-action-lists';
import { NeedsAttentionCard } from '@/components/dashboard/needs-attention-card';
import { QuickActions } from '@/components/dashboard/quick-actions';

// One heading level for the page. Each block owns its own section and heading,
// so the page reads as a flat list of work rather than through grouping
// wrappers — "Work to do" and "The full picture" only restated the sections
// they contained, and pushed every real queue label down two levels.
export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <GymMetrics />

      <DashboardSection id="quick-actions" title="Quick actions">
        <QuickActions />
      </DashboardSection>

      <LeadActionLists />
      <MembershipActionLists />
      <NeedsAttentionCard />

      <DashboardInsights />
    </div>
  );
}
