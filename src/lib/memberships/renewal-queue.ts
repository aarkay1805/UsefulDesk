import type { SupabaseClient } from '@supabase/supabase-js';

import type { Membership } from '@/types';
import { istAddDays } from './expiry';

export const RENEWAL_PAGE_SIZE = 50;

export type RenewalBucket = 'expiring' | 'expired';

export const RENEWAL_QUEUE_SELECT = `
  id,
  account_id,
  contact_id,
  member_number,
  user_id,
  plan_id,
  pricing_option_id,
  start_date,
  end_date,
  status,
  fee_amount,
  fee_status,
  is_trial,
  collection_mode,
  created_at,
  updated_at,
  contact:contacts(id, account_id, user_id, phone, name, avatar_url, created_at, updated_at),
  plan:membership_plans!inner(id, account_id, name, price, duration_days, plan_type, is_active, created_at, updated_at)
`;

export interface RenewalQueueRequest {
  accountId: string;
  bucket: RenewalBucket;
  days: number | null;
  today: string;
  page: number;
}

export interface RenewalQueuePage {
  rows: Membership[];
  total: number;
}

export type RenewalQueueCountRequest = Omit<RenewalQueueRequest, 'page'>;

export async function loadRenewalQueueCount(
  db: SupabaseClient,
  request: RenewalQueueCountRequest
): Promise<number> {
  let query = db
    .from('memberships')
    .select('id, plan:membership_plans!inner(id)', {
      count: 'exact',
      head: true,
    })
    .eq('account_id', request.accountId)
    .eq('is_trial', false)
    .eq('status', 'active')
    .eq('membership_plans.plan_type', 'recurring');

  if (request.bucket === 'expiring') {
    query = query
      .gte('end_date', request.today)
      .lte('end_date', istAddDays(request.today, request.days ?? 7));
  } else {
    query = query.lt('end_date', request.today);
    if (request.days !== null) {
      query = query.gte('end_date', istAddDays(request.today, -request.days));
    }
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function loadRenewalQueuePage(
  db: SupabaseClient,
  request: RenewalQueueRequest
): Promise<RenewalQueuePage> {
  const firstRow = request.page * RENEWAL_PAGE_SIZE;
  let query = db
    .from('memberships')
    .select(RENEWAL_QUEUE_SELECT, { count: 'exact' })
    .eq('account_id', request.accountId)
    .eq('is_trial', false)
    .eq('status', 'active')
    .eq('membership_plans.plan_type', 'recurring');

  if (request.bucket === 'expiring') {
    query = query
      .gte('end_date', request.today)
      .lte('end_date', istAddDays(request.today, request.days ?? 7))
      .order('end_date', { ascending: true });
  } else {
    query = query.lt('end_date', request.today);
    if (request.days !== null) {
      query = query.gte('end_date', istAddDays(request.today, -request.days));
    }
    query = query.order('end_date', { ascending: false });
  }

  const { data, count, error } = await query.range(
    firstRow,
    firstRow + RENEWAL_PAGE_SIZE - 1
  );
  if (error) throw error;

  return {
    rows: (data ?? []) as unknown as Membership[],
    total: count ?? 0,
  };
}
