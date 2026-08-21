// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onboardingState = vi.hoisted(() => ({
  templates: [] as Array<{
    name: string;
    status: string;
    category: string;
  }>,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/get-started',
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: '00000000-0000-4000-8000-000000000001',
    account: { onboarding_dismissed_at: null },
    profileLoading: false,
    canEditSettings: true,
    refreshProfile: vi.fn(),
  }),
}));

function createQuery(table: string) {
  const filters: Array<{
    column: string;
    values: unknown[];
  }> = [];
  let head = false;

  const result = () => {
    if (table === 'message_templates') {
      const data = onboardingState.templates.filter((row) =>
        filters.every(({ column, values }) =>
          values.includes(row[column as keyof typeof row])
        )
      );
      return head
        ? { data: null, count: data.length, error: null }
        : { data, count: null, error: null };
    }
    if (table === 'membership_plans') {
      return {
        data: [{ is_active: true, pricing_options: [{ is_active: true }] }],
        error: null,
      };
    }
    if (table === 'memberships' || table === 'payments') {
      return { data: null, count: 1, error: null };
    }
    return { data: null, count: 0, error: null };
  };

  const query = {
    select(_columns: string, options?: { head?: boolean }) {
      head = options?.head === true;
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, values: [value] });
      return query;
    },
    in(column: string, values: unknown[]) {
      filters.push({ column, values });
      return query;
    },
    maybeSingle() {
      if (table === 'whatsapp_config') {
        return Promise.resolve({ data: { status: 'connected' }, error: null });
      }
      return Promise.resolve(result());
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: ReturnType<typeof result>) => TResult1) | null,
      onrejected?: ((reason: unknown) => TResult2) | null
    ) {
      return Promise.resolve(result()).then(onfulfilled, onrejected);
    },
  };

  return query;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => createQuery(table),
  }),
}));

const { OnboardingProvider, useOnboardingStatus } =
  await import('./use-onboarding-status');

function TemplateStepProbe() {
  const { loading, steps } = useOnboardingStatus();
  const template = steps.find((step) => step.id === 'template');
  return (
    <output data-testid="template-step">
      {loading ? 'loading' : String(template?.done)}
    </output>
  );
}

describe('OnboardingProvider renewal template readiness', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/payments/razorpay/connection') {
          return new Response(
            JSON.stringify({ connection: { configured: true } }),
            { status: 200 }
          );
        }
        if (url === '/api/account/members') {
          return new Response(JSON.stringify({ members: [{ id: 'owner' }] }), {
            status: 200,
          });
        }
        if (url === '/api/account/invitations') {
          return new Response(JSON.stringify({ invitations: [] }), {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps an approved Marketing canonical template incomplete', async () => {
    onboardingState.templates = [
      {
        name: 'gym_membership_expiry_notice',
        status: 'APPROVED',
        category: 'Marketing',
      },
    ];

    render(
      <OnboardingProvider>
        <TemplateStepProbe />
      </OnboardingProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('template-step').textContent).toBe('false');
    });
  });

  it('completes from an approved Utility legacy template', async () => {
    onboardingState.templates = [
      {
        name: 'gym_renewal_reminder',
        status: 'APPROVED',
        category: 'Utility',
      },
    ];

    render(
      <OnboardingProvider>
        <TemplateStepProbe />
      </OnboardingProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('template-step').textContent).toBe('true');
    });
  });
});
