import { describe, expect, it, vi } from 'vitest';
import { requireProductAccess, ProductAccessError } from './server';
import type { SupabaseClient } from '@supabase/supabase-js';
describe('product access RPC boundary', () => {
  it.each([
    { data: null, error: null },
    { data: { allowed: true }, error: null },
    { data: { allowed: false, status: 'expired' }, error: null },
    { data: { allowed: true }, error: { message: 'offline' } },
  ])('fails closed on unavailable access %j', async (result) => {
    const rpc = vi.fn().mockResolvedValue(result);
    await expect(
      requireProductAccess({ rpc } as unknown as SupabaseClient, 'branch')
    ).rejects.toBeInstanceOf(ProductAccessError);
  });
  it('uses the supplied branch and returns the server decision', async () => {
    const snapshot = {
      allowed: true,
      status: 'complimentary',
      enforcement_enabled: true,
      support_email: null,
      support_whatsapp: null,
      access: {
        organization_id: 'org',
        mode: 'complimentary',
        version: 1,
        trial_started_at: null,
        trial_ends_at: null,
        access_starts_at: null,
        access_ends_at: null,
        suspended_at: null,
      },
    };
    const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
    expect(
      await requireProductAccess({ rpc } as unknown as SupabaseClient, 'branch')
    ).toEqual(snapshot);
    expect(rpc).toHaveBeenCalledWith('product_access_for_account', {
      p_account_id: 'branch',
    });
  });
});

describe('subscription capability boundary', () => {
  const snapshot = {
    allowed: true,
    status: 'active',
    enforcement_enabled: true,
    support_email: null,
    support_whatsapp: null,
    access: {
      organization_id: 'org',
      mode: 'manual',
      version: 1,
      trial_started_at: null,
      trial_ends_at: null,
      access_starts_at: '2026-09-01T00:00:00Z',
      access_ends_at: '2026-10-01T00:00:00Z',
      suspended_at: null,
    },
  };
  it('allows standard reminders but denies a custom capability on Starter', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...snapshot,
        subscription_capabilities: ['standard_renewal_reminders'],
      },
      error: null,
    });
    await expect(
      requireProductAccess({ rpc }, 'branch', 'standard_renewal_reminders')
    ).resolves.toBeTruthy();
    await expect(
      requireProductAccess({ rpc }, 'branch', 'bulk_campaigns')
    ).rejects.toMatchObject({
      status: 403,
      code: 'subscription_capability_required',
      capability: 'bulk_campaigns',
    });
  });
  it.each([null, true, ['unknown'], ['gym_autopay', 'gym_autopay']])(
    'fails closed on malformed capabilities %j',
    async (capabilities) => {
      const rpc = vi
        .fn()
        .mockResolvedValue({
          data: { ...snapshot, subscription_capabilities: capabilities },
          error: null,
        });
      await expect(
        requireProductAccess({ rpc }, 'branch', 'gym_autopay')
      ).rejects.toBeInstanceOf(ProductAccessError);
    }
  );
  it('preserves the existing access contract before the draft database rollout', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
    await expect(
      requireProductAccess({ rpc }, 'branch', 'gym_autopay')
    ).resolves.toEqual(snapshot);
  });
});
