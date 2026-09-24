// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'admin',
  isOrganizationOwner: true,
  rpc: vi.fn(),
  refreshProfile: vi.fn(),
  fetch: vi.fn(),
  legalName: 'Old Legal Ltd',
  brandName: 'Old Gym Brand',
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    account: { id: 'branch-id', name: 'Old Gym' },
    branches: [{ account_id: 'branch-id', organization_name: state.brandName }],
    accountRole: state.role,
    isOrganizationOwner: state.isOrganizationOwner,
    profileLoading: false,
    refreshProfile: state.refreshProfile,
  }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      if (table !== 'accounts') throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                legal_entity: {
                  legal_name: null,
                  name: null,
                },
              },
              error: null,
            }),
          }),
        }),
      };
    },
  }),
}));
vi.mock('./invoice-details-card', () => ({
  InvoiceDetailsCard: () => <div>Invoice details card</div>,
}));

const { BusinessDetailsSettings } = await import('./business-details-settings');

beforeEach(() => {
  state.role = 'owner';
  state.isOrganizationOwner = true;
  state.legalName = 'Old Legal Ltd';
  state.brandName = 'Old Gym Brand';
  state.rpc.mockReset();
  state.refreshProfile.mockReset();
  state.refreshProfile.mockResolvedValue(undefined);
  state.rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === 'my_branch_accounts'
        ? {
            data: [
              {
                account_id: 'branch-id',
                legal_entity_legal_name: state.legalName,
              },
            ],
            error: null,
          }
        : { data: 'New Legal Ltd', error: null }
    )
  );
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BusinessDetailsSettings', () => {
  it('edits the gym brand independently through the organization endpoint', async () => {
    state.fetch.mockResolvedValue(
      new Response(JSON.stringify({ name: 'Iron House' }), { status: 200 })
    );
    render(<BusinessDetailsSettings />);

    const brand = screen.getByRole('textbox', { name: 'Gym brand' });
    expect(brand).toHaveProperty('value', 'Old Gym Brand');
    expect(screen.getByRole('textbox', { name: 'Branch name' })).toHaveProperty(
      'value',
      'Old Gym'
    );
    fireEvent.change(brand, { target: { value: 'Iron House' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save gym brand' }));

    await waitFor(() =>
      expect(state.fetch).toHaveBeenCalledWith('/api/organization/brand', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Iron House' }),
      })
    );
    expect(state.rpc).not.toHaveBeenCalledWith(
      'save_legal_business_name',
      expect.anything()
    );
    await waitFor(() => expect(state.refreshProfile).toHaveBeenCalledOnce());
  });

  it('allows a gym group owner to edit the brand without branch ownership', () => {
    state.role = 'admin';
    render(<BusinessDetailsSettings />);

    expect(screen.getByRole('textbox', { name: 'Gym brand' })).toHaveProperty(
      'disabled',
      false
    );
    expect(screen.getByRole('textbox', { name: 'Branch name' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('prompts for a missing legal name without using the gym brand as a fallback', async () => {
    state.legalName = '';
    render(<BusinessDetailsSettings />);

    expect(
      await screen.findByText(/Registered business name is not set/)
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Legal business name' })
    ).toHaveProperty('value', '');
  });

  it('keeps legal editing disabled when identity lookup fails, then retries', async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: new Error('Unavailable'),
    });
    render(<BusinessDetailsSettings />);

    expect(
      await screen.findByText('Registered business name could not be loaded.')
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Legal business name' })
    ).toHaveProperty('disabled', true);
    state.rpc.mockResolvedValue({
      data: [
        { account_id: 'branch-id', legal_entity_legal_name: 'Old Legal Ltd' },
      ],
      error: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Legal business name' })
      ).toHaveProperty('value', 'Old Legal Ltd')
    );
  });

  it('saves the canonical legal name through its owner-only RPC', async () => {
    render(<BusinessDetailsSettings />);
    const input = await screen.findByRole('textbox', {
      name: 'Legal business name',
    });
    await waitFor(() => expect(input).toHaveProperty('value', 'Old Legal Ltd'));
    expect(state.rpc).not.toHaveBeenCalledWith(
      'get_invoice_profile_prefill',
      expect.anything()
    );
    fireEvent.change(input, { target: { value: 'New Legal Ltd' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save legal business name' })
    );

    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith('save_legal_business_name', {
        p_account_id: 'branch-id',
        p_legal_name: 'New Legal Ltd',
      })
    );
    expect(toast.success).toHaveBeenCalledWith('Legal business name updated');
    await waitFor(() => expect(state.refreshProfile).toHaveBeenCalledOnce());
  });

  it('keeps the legal name read-only for branch admins', async () => {
    state.role = 'admin';
    render(<BusinessDetailsSettings />);
    const input = await screen.findByRole('textbox', {
      name: 'Legal business name',
    });
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Save legal business name' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(state.rpc).not.toHaveBeenCalledWith(
      'save_legal_business_name',
      expect.anything()
    );
  });
});
