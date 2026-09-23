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
  fetch: vi.fn(),
  legalName: 'Old Legal Ltd',
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    account: { id: 'branch-id', name: 'Old Gym' },
    accountRole: state.role,
    isOrganizationOwner: state.isOrganizationOwner,
    profileLoading: false,
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
  state.rpc.mockReset();
  state.rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === 'my_branch_accounts'
        ? {
            data: [
              {
                account_id: 'branch-id',
                legal_entity_name: state.legalName,
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
