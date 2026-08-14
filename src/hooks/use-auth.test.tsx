// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountAccessAlert } from '@/components/layout/account-access-alert';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

const supabaseState = vi.hoisted(() => ({
  accountResult: {
    data: null as Record<string, unknown> | null,
    error: null as {
      message: string;
      details: string | null;
      hint: string | null;
      code: string;
    } | null,
  },
}));

function createMockClient() {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn().mockImplementation((name: string) => {
      if (name !== 'my_branch_accounts') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({
        data: [
          {
            account_id: ACCOUNT_ID,
            account_name: 'Dubai Gym',
            organization_id: 'org-1',
            organization_name: 'Dubai Fitness',
            legal_entity_id: 'legal-1',
            legal_entity_name: 'Dubai Fitness LLC',
            role: 'owner',
            branch_status: 'active',
            readiness_state: 'ready',
            default_currency: 'AED',
            timezone: 'Asia/Dubai',
            is_organization_owner: true,
            setup_reviewed_at: null,
            setup_reviewed_by: null,
          },
        ],
        error: null,
      });
    }),
    from: vi.fn().mockImplementation((table: string) => {
      let columns = '';
      const builder = {
        select(nextColumns: string) {
          columns = nextColumns;
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle() {
          if (table === 'profiles' && columns.includes('appearance_theme')) {
            return Promise.resolve({ data: null, error: null });
          }
          if (table === 'profiles') {
            return Promise.resolve({
              data: {
                id: 'profile-1',
                full_name: 'Gym Owner',
                email: 'owner@example.com',
                avatar_url: null,
                role: null,
                beta_features: [],
                account_id: ACCOUNT_ID,
                account_role: 'owner',
              },
              error: null,
            });
          }
          if (table === 'accounts') {
            return Promise.resolve(supabaseState.accountResult);
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    }),
  };
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => createMockClient(),
}));

const { AuthProvider, useAuth } = await import('./use-auth');

function AuthProbe() {
  const auth = useAuth();
  return (
    <>
      <output data-testid="status">{auth.accountStatus}</output>
      <output data-testid="profile-role">
        {auth.profile?.account_role ?? 'none'}
      </output>
      <output data-testid="account-id">{auth.accountId ?? 'none'}</output>
      <output data-testid="account-role">{auth.accountRole ?? 'none'}</output>
      <output data-testid="can-edit">{String(auth.canEditSettings)}</output>
      <output data-testid="organization-owner">
        {String(auth.isOrganizationOwner)}
      </output>
      <output data-testid="currency">{auth.defaultCurrency}</output>
      <output data-testid="timezone">{auth.locale.timeZone}</output>
      <AccountAccessAlert />
    </>
  );
}

describe('AuthProvider account hydration', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/dashboard');
    supabaseState.accountResult = {
      data: null,
      error: {
        message: 'network unavailable',
        details: null,
        hint: null,
        code: 'PGRST000',
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('fails closed on an account query error and recovers with authoritative settings', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    expect(screen.getByTestId('profile-role').textContent).toBe('none');
    expect(screen.getByTestId('account-id').textContent).toBe('none');
    expect(screen.getByTestId('account-role').textContent).toBe('none');
    expect(screen.getByTestId('can-edit').textContent).toBe('false');
    expect(screen.getByTestId('organization-owner').textContent).toBe('false');
    expect(screen.getByText('Could not load your account access')).toBeTruthy();
    expect(
      screen.getByText(/account lookup failed: network unavailable/)
    ).toBeTruthy();

    supabaseState.accountResult = {
      data: {
        id: ACCOUNT_ID,
        name: 'Dubai Gym',
        created_at: '2026-01-01T00:00:00.000Z',
        default_currency: 'AED',
        country_code: 'AE',
        locale: 'en-AE',
        timezone: 'Asia/Dubai',
        date_order: 'DMY',
        time_format: '12h',
        week_start: 1,
        phone_country_code: '+971',
        measurement_system: 'metric',
        onboarding_dismissed_at: null,
        organization_id: 'org-1',
        legal_entity_id: 'legal-1',
        branch_status: 'active',
        readiness_state: 'ready',
        setup_reviewed_at: null,
        setup_reviewed_by: null,
      },
      error: null,
    };

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });
    expect(screen.getByTestId('account-id').textContent).toBe(ACCOUNT_ID);
    expect(screen.getByTestId('account-role').textContent).toBe('owner');
    expect(screen.getByTestId('can-edit').textContent).toBe('true');
    expect(screen.getByTestId('organization-owner').textContent).toBe('true');
    expect(screen.getByTestId('currency').textContent).toBe('AED');
    expect(screen.getByTestId('timezone').textContent).toBe('Asia/Dubai');
    expect(screen.queryByText('Could not load your account access')).toBeNull();
  });

  it('reports an unreadable or missing account row distinctly', async () => {
    supabaseState.accountResult = { data: null, error: null };

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    expect(
      screen.getByText(/selected account row is missing or unreadable/)
    ).toBeTruthy();
  });
});
