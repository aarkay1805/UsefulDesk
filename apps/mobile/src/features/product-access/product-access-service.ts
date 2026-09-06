import {
  resolveProductAccess,
  isProductAccessSnapshot,
  type ProductAccessSnapshot,
} from '../../../../../src/lib/platform-access/model';
import { mobileSupabase } from '../../data/supabase';

export type { ProductAccessSnapshot };

export function parseProductAccess(
  value: unknown,
  organizationId: string
): ProductAccessSnapshot {
  if (!isProductAccessSnapshot(value, organizationId))
    throw new Error('Access unavailable');
  return value;
}

export function canMountProduct(
  snapshot: ProductAccessSnapshot | null,
  now: number
): boolean {
  if (!snapshot) return false;
  return (
    snapshot.allowed &&
    (!snapshot.enforcement_enabled ||
      resolveProductAccess(snapshot.access, now).allowed)
  );
}

export function accessDeadline(
  snapshot: ProductAccessSnapshot | null
): number | null {
  if (!snapshot || !snapshot.enforcement_enabled) return null;
  const end =
    snapshot.access.mode === 'trial'
      ? snapshot.access.trial_ends_at
      : snapshot.access.mode === 'manual'
        ? snapshot.access.access_ends_at
        : null;
  return end ? Date.parse(end) : null;
}

export async function loadProductAccess(
  accountId: string,
  organizationId: string
) {
  const { data, error } = await mobileSupabase.rpc(
    'product_access_for_account',
    { p_account_id: accountId }
  );
  if (error) throw error;
  return parseProductAccess(data, organizationId);
}

export async function requestProductSupport(accountId: string) {
  const { data, error } = await mobileSupabase.rpc(
    'product_access_request_support',
    {
      p_account_id: accountId,
      p_message: 'Please help restore our organization’s UsefulDesk access.',
    }
  );
  if (error || typeof data !== 'string' || !data)
    throw new Error('Could not send your support request. Please try again.');
  return data;
}
