import { describe, expect, it } from 'vitest';

import type { Contact, MembershipPlan } from '@/types';
import {
  asMembership,
  customerExpiry,
  isMembershipCustomer,
  normalizeCustomerDirectoryRow,
  type MemberCustomerDirectoryRow,
} from './customer-directory';

const contact = {
  id: 'contact-1',
  account_id: 'account-1',
  name: 'Asha',
  phone: '+919876543210',
} as Contact;

const plan = {
  id: 'plan-1',
  account_id: 'account-1',
  name: 'Gold',
  plan_type: 'recurring',
} as MembershipPlan;

function row(
  patch: Partial<MemberCustomerDirectoryRow> = {}
): MemberCustomerDirectoryRow {
  return {
    account_id: 'account-1',
    contact_id: contact.id,
    customer_kind: 'membership',
    membership_id: 'membership-1',
    member_number: 1001,
    membership_user_id: 'user-1',
    plan_id: plan.id,
    pricing_option_id: null,
    membership_start_date: '2026-08-01',
    membership_end_date: '2026-09-01',
    membership_status: 'active',
    membership_fee_amount: 1200,
    membership_fee_status: 'due',
    membership_is_trial: false,
    membership_frozen_at: null,
    membership_collection_mode: 'manual',
    membership_created_at: '2026-08-01T00:00:00Z',
    membership_updated_at: '2026-08-01T00:00:00Z',
    service_expiry: null,
    service_count: 0,
    generic_balance: 1200,
    open_follow_up_count: 0,
    contact_name: contact.name ?? '',
    contact_phone: contact.phone,
    contact_email: null,
    contact_avatar_url: null,
    contact_assigned_to: null,
    contact_churn_risk: false,
    contact,
    plan,
    ...patch,
  };
}

describe('customer directory', () => {
  it('keeps a membership customer compatible with existing membership actions', () => {
    const membership = asMembership(row());

    expect(membership).toMatchObject({
      id: 'membership-1',
      contact_id: 'contact-1',
      member_number: 1001,
      plan_id: 'plan-1',
      fee_status: 'due',
      contact,
      plan,
    });
    expect(isMembershipCustomer(row())).toBe(true);
    expect(customerExpiry(row())).toBe('2026-09-01');
  });

  it('normalizes a service-only contact without fabricating membership fields', () => {
    const serviceOnly = normalizeCustomerDirectoryRow(
      row({
        customer_kind: 'service',
        membership_id: null,
        member_number: null,
        membership_user_id: null,
        plan_id: null,
        membership_start_date: null,
        membership_end_date: null,
        membership_status: null,
        membership_fee_amount: null,
        membership_fee_status: null,
        service_expiry: '2026-10-01',
        service_count: 3,
        generic_balance: 900,
        plan: null,
      })
    );

    expect(serviceOnly.customer_kind).toBe('service');
    expect(serviceOnly.membership_id).toBeNull();
    expect(serviceOnly.member_number).toBeNull();
    expect(serviceOnly.display_expiry).toBe('2026-10-01');
    expect(serviceOnly.generic_balance).toBe(900);
    expect(isMembershipCustomer(serviceOnly)).toBe(false);
    expect(asMembership(serviceOnly)).toBeNull();
  });

  it('prefers membership expiry for real memberships and service expiry otherwise', () => {
    expect(
      customerExpiry(
        row({
          membership_end_date: '2026-09-01',
          service_expiry: '2026-08-20',
        })
      )
    ).toBe('2026-09-01');
    expect(
      customerExpiry(
        row({
          customer_kind: 'service',
          membership_id: null,
          membership_end_date: null,
          service_expiry: '2026-08-20',
        })
      )
    ).toBe('2026-08-20');
  });
});
