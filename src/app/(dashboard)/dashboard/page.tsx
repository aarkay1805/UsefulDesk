import { DashboardInsights } from '@/components/dashboard/dashboard-insights';
import { GymMetrics } from '@/components/dashboard/gym-metrics';
import { LeadActionLists } from '@/components/dashboard/lead-action-lists';
import { QuickActions } from '@/components/dashboard/quick-actions';

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <GymMetrics />
        <QuickActions />
      </div>

      <LeadActionLists />
      <DashboardInsights />
    </div>
  );
}
