import type { SupabaseClient } from '@supabase/supabase-js';
import { isProductAccessSnapshot, type ProductAccessSnapshot } from './model';

export class ProductAccessError extends Error {
  readonly status = 403;
  readonly code = 'product_access_required';
  constructor(readonly snapshot: ProductAccessSnapshot | null = null) {
    super(
      snapshot?.status === 'suspended'
        ? 'UsefulDesk access is suspended. Contact support.'
        : 'UsefulDesk access is unavailable. Contact support.'
    );
    this.name = 'ProductAccessError';
  }
}

export async function requireProductAccess(
  db: Pick<SupabaseClient, 'rpc'>,
  accountId: string
): Promise<ProductAccessSnapshot> {
  const { data, error } = await db.rpc('product_access_for_account', {
    p_account_id: accountId,
  });
  if (error || !isProductAccessSnapshot(data)) throw new ProductAccessError();
  if (!data.allowed) throw new ProductAccessError(data);
  return data;
}
