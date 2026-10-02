// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

const h = vi.hoisted(() => ({
  identity: { ok: true, name: 'Gym Legal Name' } as Record<string, unknown>,
  templates: [] as Record<string, unknown>[],
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'branch-1' }),
}));
vi.mock('@/lib/whatsapp/legal-business-name', () => ({
  loadLegalBusinessName: () => Promise.resolve(h.identity),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const result = () => ({
        data:
          table === 'whatsapp_config' ? { status: 'connected' } : h.templates,
        error: null,
      });
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));
import { useReminderReadiness } from './send-reminder-button';
afterEach(cleanup);
beforeEach(() => {
  h.identity = { ok: true, name: 'Gym Legal Name' };
  h.templates = [
    {
      ...TEMPLATE_CONTRACTS.membership_renewal.payload,
      status: 'APPROVED',
      parameter_format: 'POSITIONAL',
    },
  ];
});
describe('manual renewal reminder legal identity readiness', () => {
  it.each([
    'legal_business_identity_missing',
    'legal_business_identity_lookup_unavailable',
  ])('explains %s before offering a send', async (code) => {
    h.identity = { ok: false, code };
    const { result } = renderHook(useReminderReadiness);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({
      ready: false,
      reason: expect.stringMatching(/business name/i),
      resolution: { href: '/settings?tab=business-details' },
    });
  });
  it('allows the exact ready template with a readable legal identity', async () => {
    const { result } = renderHook(useReminderReadiness);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(true);
  });
});
