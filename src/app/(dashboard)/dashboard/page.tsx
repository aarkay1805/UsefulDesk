import { DashboardInsights } from '@/components/dashboard/dashboard-insights';
import { GymMetrics } from '@/components/dashboard/gym-metrics';
import { LeadActionLists } from '@/components/dashboard/lead-action-lists';
import { QuickActions } from '@/components/dashboard/quick-actions';

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <GymMetrics />

      {/* Operational work follows the owner's decisions immediately. */}
      <LeadActionLists />

      <QuickActions />

      {/* Historical analysis stays visible after the daily action areas. */}
      <DashboardInsights />
    </div>
  );
}
