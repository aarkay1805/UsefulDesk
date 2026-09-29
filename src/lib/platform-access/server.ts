import type { SupabaseClient } from '@supabase/supabase-js';
import { isProductAccessSnapshot, type ProductAccessSnapshot } from './model';
import { canUseSubscriptionCapability } from '@/lib/auth/roles';
import type { SubscriptionCapability } from '@/lib/subscriptions/plans';

export class ProductAccessError extends Error {
  readonly status = 403;
  readonly code: string = 'product_access_required';
  constructor(readonly snapshot: ProductAccessSnapshot | null = null) {
    super(
      snapshot?.status === 'suspended'
        ? 'UsefulDesk access is suspended. Contact support.'
        : 'UsefulDesk access is unavailable. Contact support.'
    );
    this.name = 'ProductAccessError';
  }
}

export class SubscriptionCapabilityError extends ProductAccessError {
  readonly code = 'subscription_capability_required';
  constructor(
    readonly capability: SubscriptionCapability,
    snapshot: ProductAccessSnapshot
  ) {
    super(snapshot);
    this.name = 'SubscriptionCapabilityError';
    this.message =
      'Your plan does not include this action. Contact your gym owner.';
  }
}

export async function requireProductAccess(
  db: Pick<SupabaseClient, 'rpc'>,
  accountId: string,
  capability?: SubscriptionCapability
): Promise<ProductAccessSnapshot> {
  const { data, error } = await db.rpc('product_access_for_account', {
    p_account_id: accountId,
  });
  if (error || !isProductAccessSnapshot(data)) throw new ProductAccessError();
  if (!data.allowed) throw new ProductAccessError(data);
  if (capability && !canUseSubscriptionCapability(data, capability)) {
    throw new SubscriptionCapabilityError(capability, data);
  }
  return data;
}
