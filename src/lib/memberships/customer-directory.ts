import type {
  Contact,
  Membership,
  MembershipCollectionMode,
  MembershipFeeStatus,
  MembershipPlan,
  MembershipStatus,
} from '@/types';

export type MemberCustomerKind = 'membership' | 'service';

/** Flat, one-row-per-contact projection returned by member_customer_directory. */
export interface MemberCustomerDirectoryRow {
  account_id: string;
  contact_id: string;
  customer_kind: MemberCustomerKind;
  membership_id: string | null;
  member_number: number | null;
  membership_user_id: string | null;
  plan_id: string | null;
  pricing_option_id: string | null;
  membership_start_date: string | null;
  membership_end_date: string | null;
  membership_status: MembershipStatus | null;
  membership_fee_amount: number | null;
  membership_fee_status: MembershipFeeStatus | null;
  membership_is_trial: boolean;
  membership_frozen_at: string | null;
  membership_collection_mode: MembershipCollectionMode | null;
  membership_created_at: string | null;
  membership_updated_at: string | null;
  service_expiry: string | null;
  service_count: number;
  generic_balance: number;
  open_follow_up_count: number;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  contact_avatar_url: string | null;
  contact_assigned_to: string | null;
  contact_churn_risk: boolean;
  contact: Contact;
  plan: MembershipPlan | null;
}

export type NormalizedMemberCustomerDirectoryRow =
  MemberCustomerDirectoryRow & {
    display_expiry: string | null;
  };

export function isMembershipCustomer(
  row: Pick<MemberCustomerDirectoryRow, 'membership_id' | 'customer_kind'>
): boolean {
  return row.customer_kind === 'membership' && row.membership_id !== null;
}

export function customerRowCapabilities(
  row: Pick<MemberCustomerDirectoryRow, 'membership_id' | 'customer_kind'>
) {
  const membershipActions = isMembershipCustomer(row);
  return {
    details: true,
    followUp: true,
    addPurchase: true,
    assignment: true,
    notes: true,
    membershipActions,
    selectableForMembershipBulkActions: membershipActions,
  } as const;
}

export function customerExpiry(
  row: Pick<
    MemberCustomerDirectoryRow,
    'membership_id' | 'membership_end_date' | 'service_expiry'
  >
): string | null {
  return row.membership_id ? row.membership_end_date : row.service_expiry;
}

export function normalizeCustomerDirectoryRow(
  row: MemberCustomerDirectoryRow
): NormalizedMemberCustomerDirectoryRow {
  return {
    ...row,
    service_count: Number(row.service_count),
    generic_balance: Number(row.generic_balance),
    open_follow_up_count: Number(row.open_follow_up_count),
    display_expiry: customerExpiry(row),
  };
}

/**
 * Preserve every established membership action behind a real membership.
 * Service-only customers return null instead of a synthetic partial row.
 */
export function asMembership(
  row: MemberCustomerDirectoryRow
): Membership | null {
  if (
    !isMembershipCustomer(row) ||
    !row.membership_id ||
    !row.membership_user_id ||
    row.member_number === null ||
    !row.membership_start_date ||
    !row.membership_end_date ||
    !row.membership_status ||
    row.membership_fee_amount === null ||
    !row.membership_fee_status ||
    !row.membership_created_at ||
    !row.membership_updated_at
  ) {
    return null;
  }

  return {
    id: row.membership_id,
    account_id: row.account_id,
    contact_id: row.contact_id,
    member_number: row.member_number,
    user_id: row.membership_user_id,
    plan_id: row.plan_id,
    pricing_option_id: row.pricing_option_id,
    start_date: row.membership_start_date,
    end_date: row.membership_end_date,
    status: row.membership_status,
    fee_amount: Number(row.membership_fee_amount),
    fee_status: row.membership_fee_status,
    frozen_at: row.membership_frozen_at,
    is_trial: row.membership_is_trial,
    collection_mode: row.membership_collection_mode ?? 'manual',
    created_at: row.membership_created_at,
    updated_at: row.membership_updated_at,
    contact: row.contact,
    plan: row.plan ?? undefined,
  };
}
