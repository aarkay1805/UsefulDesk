// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  accountId: 'account-id',
  accountRole: 'owner' as 'owner' | 'admin' | 'agent' | 'viewer',
  profileLoading: false,
  account: {
    id: 'account-id',
    name: 'Iron Fitness Andheri',
    legal_entity_id: 'entity-id',
  },
}));

const database = vi.hoisted(() => ({
  profile: null as Record<string, string> | null,
  legalEntity: { legal_name: 'Iron Fitness Private Limited' } as {
    legal_name: string | null;
  } | null,
  profileError: null as Error | null,
  legalEntityError: null as Error | null,
  rpcData: { account_id: 'account-id' } as Record<string, string> | null,
  rpc: vi.fn(),
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('sonner', () => ({ toast }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => auth,
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ locale: { countryCode: 'IN' } }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const result =
        table === 'invoice_profiles'
          ? { data: database.profile, error: database.profileError }
          : { data: database.legalEntity, error: database.legalEntityError };
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve(result),
      };
      return builder;
    },
    rpc: database.rpc,
  }),
}));

const { InvoiceDetailsCard } = await import('./invoice-details-card');

function renderCard() {
  return render(<InvoiceDetailsCard />);
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function validProfile() {
  setField('Business name', 'Iron Fitness');
  setField('Address line 1', '42 Station Road');
  setField('City', 'Mumbai');
  setField('Country', 'India');
}

beforeEach(() => {
  auth.accountRole = 'owner';
  auth.profileLoading = false;
  auth.account = {
    id: 'account-id',
    name: 'Iron Fitness Andheri',
    legal_entity_id: 'entity-id',
  };
  database.profile = null;
  database.legalEntity = { legal_name: 'Iron Fitness Private Limited' };
  database.profileError = null;
  database.legalEntityError = null;
  database.rpcData = { account_id: 'account-id' };
  database.rpc.mockReset();
  database.rpc.mockResolvedValue({ data: database.rpcData, error: null });
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(cleanup);

describe('InvoiceDetailsCard', () => {
  it('prefills a missing profile from the selected branch, legal entity, and country preset', async () => {
    renderCard();

    expect(
      await screen.findByDisplayValue('Iron Fitness Andheri')
    ).toBeTruthy();
    expect(
      screen.getByDisplayValue('Iron Fitness Private Limited')
    ).toBeTruthy();
    expect(screen.getByDisplayValue('India')).toBeTruthy();
  });

  it('renders every saved invoice profile field', async () => {
    database.profile = {
      business_name: 'Iron Fitness',
      legal_name: 'Iron Fitness Private Limited',
      address_line1: '42 Station Road',
      address_line2: 'Near Metro',
      city: 'Mumbai',
      state: 'Maharashtra',
      postal_code: '400001',
      country: 'India',
      phone: '+91 99999 00000',
      email: 'billing@iron.fitness',
    };

    renderCard();

    expect(await screen.findByDisplayValue('Iron Fitness')).toBeTruthy();
    expect(
      screen.getByDisplayValue('Iron Fitness Private Limited')
    ).toBeTruthy();
    expect(screen.getByDisplayValue('42 Station Road')).toBeTruthy();
    expect(screen.getByDisplayValue('Near Metro')).toBeTruthy();
    expect(screen.getByDisplayValue('Mumbai')).toBeTruthy();
    expect(screen.getByDisplayValue('Maharashtra')).toBeTruthy();
    expect(screen.getByDisplayValue('400001')).toBeTruthy();
    expect(screen.getByDisplayValue('India')).toBeTruthy();
    expect(screen.getByDisplayValue('+91 99999 00000')).toBeTruthy();
    expect(screen.getByDisplayValue('billing@iron.fitness')).toBeTruthy();
  });

  it.each(['agent', 'viewer'] as const)(
    'keeps %s inspection read-only',
    async (accountRole) => {
      auth.accountRole = accountRole;
      renderCard();

      expect(
        await screen.findByDisplayValue('Iron Fitness Andheri')
      ).toHaveProperty('disabled', true);
      expect(
        screen.getByRole('button', { name: 'Save invoice details' })
      ).toHaveProperty('disabled', true);
    }
  );

  it('shows required and email validation errors for an owner', async () => {
    renderCard();
    await screen.findByDisplayValue('Iron Fitness Andheri');
    setField('Business name', '');
    setField('Email', 'bad@');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save invoice details' })
    );

    expect(await screen.findByText('Business name is required.')).toBeTruthy();
    expect(screen.getByText('Address line 1 is required.')).toBeTruthy();
    expect(screen.getByText('City is required.')).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'] as const)(
    '%s saves normalized profile values through the authoritative RPC',
    async (accountRole) => {
      auth.accountRole = accountRole;
      renderCard();
      await screen.findByDisplayValue('Iron Fitness Andheri');
      validProfile();
      setField('Email', ' BILLING@IRON.FITNESS ');
      fireEvent.click(
        screen.getByRole('button', { name: 'Save invoice details' })
      );

      await waitFor(() => {
        expect(database.rpc).toHaveBeenCalledWith('save_invoice_profile', {
          account_id: 'account-id',
          p_business_name: 'Iron Fitness',
          p_legal_name: 'Iron Fitness Private Limited',
          p_address_line1: '42 Station Road',
          p_address_line2: '',
          p_city: 'Mumbai',
          p_state: '',
          p_postal_code: '',
          p_country: 'India',
          p_phone: '',
          p_email: 'billing@iron.fitness',
        });
      });
      expect(toast.success).toHaveBeenCalledWith('Invoice details updated');
    }
  );

  it('keeps entered values and offers retry when a save fails', async () => {
    database.rpc.mockResolvedValue({
      data: null,
      error: new Error('Profile save failed'),
    });
    renderCard();
    await screen.findByDisplayValue('Iron Fitness Andheri');
    validProfile();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save invoice details' })
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Profile save failed');
    });
    expect(screen.getByDisplayValue('Iron Fitness')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('treats an RPC save without a returned row as a failure', async () => {
    database.rpc.mockResolvedValue({ data: null, error: null });
    renderCard();
    await screen.findByDisplayValue('Iron Fitness Andheri');
    validProfile();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save invoice details' })
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Invoice details were not saved.'
      );
    });
    expect(screen.getByDisplayValue('Iron Fitness')).toBeTruthy();
  });

  it('shows the recovery copy and retries a failed load', async () => {
    database.profileError = new Error('Profile unavailable');
    renderCard();

    expect(await screen.findByText('Profile unavailable')).toBeTruthy();
    expect(
      screen.getByText('Finish Invoice details in Settings -> Payments first.')
    ).toBeTruthy();
    database.profileError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByDisplayValue('Iron Fitness Andheri')
    ).toBeTruthy();
  });
});
