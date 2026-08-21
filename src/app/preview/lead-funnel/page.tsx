import { notFound } from 'next/navigation';
import { LeadFunnel } from '@/components/dashboard/lead-funnel';
import type { LeadFunnelData } from '@/lib/dashboard/types';

// Dev-only visual harness for the dashboard's Leads by stage card. The real
// card lives behind auth on /dashboard, so this renders it against fixed data
// — including the states real accounts hit rarely (long custom status labels,
// three-digit stage ages, loading, empty). Never reachable in production.
export const dynamic = 'force-static';

const screenshotCase: LeadFunnelData = {
  stages: [
    { key: 'new', label: 'New', color: '#3b82f6', count: 1, avgDays: 1 },
    {
      key: 'contacted',
      label: 'Contacted',
      color: '#eab308',
      count: 0,
      avgDays: null,
    },
    {
      key: 'interested',
      label: 'Interested',
      color: '#f97316',
      count: 0,
      avgDays: null,
    },
    {
      key: 'trial',
      label: 'Trial Booked',
      color: '#22c55e',
      count: 0,
      avgDays: null,
    },
    { key: 'lost', label: 'Lost', color: '#ec4899', count: 0, avgDays: null },
  ],
  totalLeads: 1,
  convertedThisMonth: 2,
  conversionRate: 2 / 3,
  convertedTotal: 2,
  topSources: [
    { key: 'unknown', label: 'Unknown', leads: 0, members: 1, rate: 1 },
    { key: 'walkin', label: 'Walk-in', leads: 0, members: 1, rate: 1 },
    { key: 'instagram', label: 'Instagram', leads: 1, members: 0, rate: 0 },
  ],
};

const busyAccount: LeadFunnelData = {
  stages: [
    { key: 'new', label: 'New', color: '#3b82f6', count: 42, avgDays: 0.4 },
    {
      key: 'contacted',
      label: 'Contacted',
      color: '#eab308',
      count: 18,
      avgDays: 1,
    },
    {
      key: 'interested',
      label: 'Interested',
      color: '#f97316',
      count: 7,
      avgDays: 12.6,
    },
    {
      key: 'trial',
      label: 'Trial Booked',
      color: '#22c55e',
      count: 3,
      avgDays: 4.2,
    },
    { key: 'lost', label: 'Lost', color: '#ec4899', count: 0, avgDays: null },
    {
      key: 'legacy',
      label: 'Waiting on payment link',
      color: '#94a3b8',
      count: 1,
      avgDays: 133,
    },
  ],
  totalLeads: 71,
  convertedThisMonth: 12,
  conversionRate: 0.34,
  convertedTotal: 37,
  topSources: [
    { key: 'walkin', label: 'Walk-in', leads: 10, members: 22, rate: 22 / 32 },
    {
      key: 'instagram',
      label: 'Instagram',
      leads: 31,
      members: 9,
      rate: 9 / 40,
    },
    { key: 'unknown', label: 'Unknown', leads: 4, members: 3, rate: 3 / 7 },
    {
      key: 'referral',
      label: 'Referral from existing member',
      leads: 6,
      members: 3,
      rate: 3 / 9,
    },
  ],
};

const emptyAccount: LeadFunnelData = {
  stages: [],
  totalLeads: 0,
  convertedThisMonth: 0,
  conversionRate: null,
  convertedTotal: 0,
  topSources: [],
};

const CASES: { label: string; data: LeadFunnelData | null }[] = [
  { label: 'One lead (your screenshot)', data: screenshotCase },
  { label: 'Busy account', data: busyAccount },
  { label: 'Loading', data: null },
  { label: 'No leads yet', data: emptyAccount },
];

export default function LeadFunnelPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="bg-background min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {CASES.map((c) => (
          <section key={c.label} className="space-y-2">
            <h2 className="text-muted-foreground text-xs font-medium">
              {c.label}
            </h2>
            <LeadFunnel data={c.data} loading={c.data === null} />
          </section>
        ))}
      </div>
    </div>
  );
}
