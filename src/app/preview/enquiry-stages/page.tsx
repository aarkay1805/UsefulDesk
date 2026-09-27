import { notFound } from 'next/navigation';

import { EnquiryStagesCardView } from '@/components/reports/enquiry-stages-card';
import type { EnquiryStage } from '@/lib/reports/enquiry-stages';

// Dev-only visual harness for Business → Performance's Enquiries by stage
// card. The real card lives behind auth, so this renders it against fixed
// data — including the states real accounts hit rarely (a long custom stage,
// three-digit stage ages, loading, a failed read, no enquiries). Never
// reachable in production.
export const dynamic = 'force-static';

const oneEnquiry: EnquiryStage[] = [
  { key: 'new', label: 'New', color: '#3b82f6', count: 1, avgDays: 0.4 },
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
    key: 'trial_booked',
    label: 'Trial booked',
    color: '#22c55e',
    count: 0,
    avgDays: null,
  },
  {
    key: 'lost',
    label: 'Not joining',
    color: '#64748b',
    count: 0,
    avgDays: null,
  },
];

const busyAccount: EnquiryStage[] = [
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
    key: 'trial_booked',
    label: 'Trial booked',
    color: '#22c55e',
    count: 3,
    avgDays: 4.2,
  },
  {
    key: 'lost',
    label: 'Not joining',
    color: '#64748b',
    count: 0,
    avgDays: null,
  },
  {
    key: 'legacy',
    label: 'Waiting on payment link',
    color: '#94a3b8',
    count: 1,
    avgDays: 133,
  },
];

const CASES: { label: string; stages: EnquiryStage[] | null | undefined }[] = [
  { label: 'One enquiry', stages: oneEnquiry },
  { label: 'Busy account', stages: busyAccount },
  { label: 'Loading', stages: undefined },
  { label: 'Could not load', stages: null },
  {
    label: 'No enquiries yet',
    stages: oneEnquiry.map((s) => ({ ...s, count: 0, avgDays: null })),
  },
];

export default function EnquiryStagesPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="bg-background min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {CASES.map((c) => (
          <section key={c.label} className="space-y-2">
            <h2 className="text-muted-foreground text-xs font-medium">
              {c.label}
            </h2>
            <EnquiryStagesCardView stages={c.stages} />
          </section>
        ))}
      </div>
    </div>
  );
}
