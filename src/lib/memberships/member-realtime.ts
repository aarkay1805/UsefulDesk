export const MEMBER_VIEWS = [
  'renewals',
  'followups',
  'trials',
  'payments',
  'retention',
  'all',
  'attendance',
] as const;

export type MemberView = (typeof MEMBER_VIEWS)[number];

// Display-data dependencies for every published table consumed by a Members
// listing. Indirect billing sources are included because membership_dues and
// member_customer_directory derive balances through invoice line allocations.
export const MEMBER_REALTIME_DEPENDENCIES = {
  memberships: MEMBER_VIEWS,
  contacts: MEMBER_VIEWS,
  membership_plans: MEMBER_VIEWS,
  member_services: ['renewals', 'all'],
  payments: ['payments', 'all'],
  payment_allocations: ['payments', 'all'],
  payment_refunds: ['payments', 'all'],
  payment_refund_allocations: ['payments', 'all'],
  invoice_lines: ['payments', 'all'],
  invoice_credit_allocations: ['payments', 'all'],
  invoice_adjustment_allocations: ['payments', 'all'],
  membership_periods: ['payments'],
  invoices: ['all'],
  attendance: ['retention', 'attendance'],
  follow_ups: ['followups', 'all'],
} as const satisfies Record<string, readonly MemberView[]>;

export type MemberRealtimeTable = keyof typeof MEMBER_REALTIME_DEPENDENCIES;

export const MEMBER_REALTIME_TABLES = Object.keys(
  MEMBER_REALTIME_DEPENDENCIES
) as MemberRealtimeTable[];

export function memberViewsAffectedByRealtime(
  table: MemberRealtimeTable
): readonly MemberView[] {
  return MEMBER_REALTIME_DEPENDENCIES[table];
}
