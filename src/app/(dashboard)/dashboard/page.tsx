import { DashboardInsights } from '@/components/dashboard/dashboard-insights';
import { GymMetrics } from '@/components/dashboard/gym-metrics';
import { LeadActionLists } from '@/components/dashboard/lead-action-lists';
import { MembershipActionLists } from '@/components/dashboard/membership-action-lists';
import { QuickActions } from '@/components/dashboard/quick-actions';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <GymMetrics />

      <section aria-labelledby="quick-actions-heading" className="space-y-3">
        <div>
          <h2
            id="quick-actions-heading"
            className="text-foreground text-sm font-semibold"
          >
            Quick actions
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Start the jobs you do most.
          </p>
        </div>
        <QuickActions />
      </section>

      <section aria-labelledby="work-to-do-heading" className="space-y-4">
        <div>
          <h2
            id="work-to-do-heading"
            className="text-foreground text-sm font-semibold"
          >
            Work to do
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Clear these lists first.
          </p>
        </div>
        <LeadActionLists />
        <MembershipActionLists />
      </section>

      <DashboardInsights />
    </div>
  );
}
