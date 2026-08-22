import { DashboardInsights } from '@/components/dashboard/dashboard-insights';
import { GymMetrics } from '@/components/dashboard/gym-metrics';
import { LeadActionLists } from '@/components/dashboard/lead-action-lists';
import { MembershipActionLists } from '@/components/dashboard/membership-action-lists';
import { NeedsAttentionCard } from '@/components/dashboard/needs-attention-card';
import { QuickActions } from '@/components/dashboard/quick-actions';

// Section subtitles were removed: every card below a heading already names
// its own work, so the second line only restated the first.
export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <GymMetrics />

      <section aria-labelledby="quick-actions-heading" className="space-y-3">
        <h2
          id="quick-actions-heading"
          className="text-foreground text-sm font-semibold"
        >
          Quick actions
        </h2>
        <QuickActions />
      </section>

      {/* Every queue that needs an owner today lives here — including the
          exception queue, which used to sit alone under Insights. */}
      <section aria-labelledby="work-to-do-heading" className="space-y-4">
        <h2
          id="work-to-do-heading"
          className="text-foreground text-sm font-semibold"
        >
          Work to do
        </h2>
        <LeadActionLists />
        <MembershipActionLists />
        <NeedsAttentionCard />
      </section>

      <DashboardInsights />
    </div>
  );
}
