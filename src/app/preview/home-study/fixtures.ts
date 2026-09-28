import { isCollectiblePeriod } from '@/lib/memberships/periods';
import type { Membership } from '@/types';

export const STUDY_TODAY = '2026-09-28';
export type StudyBucket = 'all' | 'due' | 'upcoming';
export interface StudyOptions {
  followUps: 'all' | 'due';
  preview: 'scroll' | 'short';
  fees: 'hidden' | 'shown';
  order: 'renewals' | 'enquiries';
  actions: 'details' | 'labelled';
}
export const BASELINE: StudyOptions = {
  followUps: 'all',
  preview: 'scroll',
  fees: 'hidden',
  order: 'renewals',
  actions: 'details',
};
export interface StudyPerson {
  id: string;
  name: string;
  kind: 'lead' | 'member';
  due: string;
  note: string;
}
export const FOLLOW_UPS: StudyPerson[] = [
  {
    id: 'rohit',
    name: 'Rohit Shah',
    kind: 'lead',
    due: '2026-09-25',
    note: 'Call after 7 pm about the evening batch.',
  },
  {
    id: 'aarti',
    name: 'Aarti Deshmukh',
    kind: 'member',
    due: '2026-09-27',
    note: 'Discuss the quarterly plan before renewing.',
  },
  {
    id: 'kavita',
    name: 'Kavita Menon',
    kind: 'member',
    due: STUDY_TODAY,
    note: 'Call about the unpaid August fee.',
  },
  {
    id: 'arjun',
    name: 'Arjun Rao',
    kind: 'lead',
    due: STUDY_TODAY,
    note: 'Confirm tomorrow’s trial time.',
  },
  {
    id: 'farah',
    name: 'Farah Ali',
    kind: 'lead',
    due: STUDY_TODAY,
    note: 'Explain the monthly fee and usual time.',
  },
  {
    id: 'dev',
    name: 'Dev Mehta',
    kind: 'member',
    due: STUDY_TODAY,
    note: 'Check when he can return to the gym.',
  },
  {
    id: 'meera',
    name: 'Meera Iyer',
    kind: 'lead',
    due: '2026-09-29',
    note: 'Call after her first trial.',
  },
  {
    id: 'priya',
    name: 'Priya Nair',
    kind: 'member',
    due: '2026-10-02',
    note: 'Call on Friday about the next membership.',
  },
  {
    id: 'aman',
    name: 'Aman Singh',
    kind: 'lead',
    due: '2026-10-03',
    note: 'Discuss morning batch availability.',
  },
  {
    id: 'neha',
    name: 'Neha Patel',
    kind: 'member',
    due: '2026-10-04',
    note: 'Confirm her return date.',
  },
];
export const RENEWALS = FOLLOW_UPS.filter((row) => row.kind === 'member').map(
  (row, index) => ({
    ...row,
    expiry: [
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-04',
    ][index],
  })
);
export const ENQUIRIES = [
  'Sana Khan',
  'Vikram Das',
  'Leela Thomas',
  'Kabir Sen',
  'Anita Roy',
  'Ishaan Kapoor',
  'Nisha Bose',
  'Rehan Ahmed',
].map((name, index) => ({
  id: `enquiry-${index}`,
  name,
  note:
    index === 0
      ? 'Asked about the monthly fee 2 hours ago.'
      : 'Asked about the evening batch yesterday.',
}));

export interface StudyFee {
  id: string;
  name: string;
  invoice: string;
  period: string;
  balance: number;
  state: 'open' | 'void';
  membershipStatus: Membership['status'];
}
// Membership-line balances only, matching membership_dues / Members → Fees.
// No sale-only invoices, cancelled memberships, void invoices, or sub-display
// residues are represented as collectible money.
export const FEES: StudyFee[] = [
  {
    id: 'kavita',
    name: 'Kavita Menon',
    invoice: 'INV-000041',
    period: '2026-08-01',
    balance: 1500,
    state: 'open',
    membershipStatus: 'active',
  },
  {
    id: 'aarti',
    name: 'Aarti Deshmukh',
    invoice: 'INV-000042',
    period: '2026-09-01',
    balance: 2500,
    state: 'open',
    membershipStatus: 'active',
  },
  {
    id: 'cancelled',
    name: 'Cancelled example',
    invoice: 'INV-000043',
    period: '2026-09-01',
    balance: 900,
    state: 'open',
    membershipStatus: 'cancelled',
  },
  {
    id: 'void',
    name: 'Cancelled invoice example',
    invoice: 'INV-000044',
    period: '2026-09-01',
    balance: 800,
    state: 'void',
    membershipStatus: 'active',
  },
  {
    id: 'residue',
    name: 'Rounding example',
    invoice: 'INV-000045',
    period: '2026-09-01',
    balance: 0.2,
    state: 'open',
    membershipStatus: 'active',
  },
];
export function collectibleStudyFees(paid: ReadonlySet<string>) {
  return FEES.filter(
    (row) => !paid.has(row.id) && isCollectiblePeriod(row, row.membershipStatus)
  );
}
export function studyFollowUps(
  bucket: StudyBucket,
  completed: ReadonlySet<string>
) {
  return FOLLOW_UPS.filter(
    (row) =>
      !completed.has(row.id) &&
      (bucket === 'all' ||
        (bucket === 'due' ? row.due <= STUDY_TODAY : row.due > STUDY_TODAY))
  );
}
