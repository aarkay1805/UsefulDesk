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
  profileRequest: null as Promise<{
    data: Record<string, string> | null;
    error: Error | null;
  }> | null,
  legalEntityError: null as Error | null,
  prefill: [
    {
      business_name: 'Iron Fitness Andheri',
      legal_name: 'Iron Fitness Private Limited',
      country_code: 'IN',
    },
  ] as Array<{
    business_name: string;
    legal_name: string | null;
    country_code: string | null;
  }> | null,
  prefillError: null as Error | null,
  rpcData: { account_id: 'account-id' } as Record<string, string> | null,
  from: vi.fn(),
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
    from: database.from,
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

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: resolve! };
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
  database.profileRequest = null;
  database.legalEntity = { legal_name: 'Iron Fitness Private Limited' };
  database.profileError = null;
  database.legalEntityError = null;
  database.prefill = [
    {
      business_name: 'Iron Fitness Andheri',
      legal_name: 'Iron Fitness Private Limited',
      country_code: 'IN',
    },
  ];
  database.prefillError = null;
  database.rpcData = { account_id: 'account-id' };
  database.from.mockReset();
  database.from.mockImplementation((table: string) => {
    if (table === 'legal_entities') {
      throw new Error('legal_entities is owner-only');
    }
    const result = {
      data: database.profile,
      error: database.profileError,
    };
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => database.profileRequest ?? Promise.resolve(result),
    };
    return builder;
  });
  database.rpc.mockReset();
  database.rpc.mockImplementation((name) => {
    if (name === 'get_invoice_profile_prefill') {
      return Promise.resolve({
        data: database.prefill,
        error: database.prefillError,
      });
    }
    return Promise.resolve({ data: database.rpcData, error: null });
  });
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(cleanup);

describe('InvoiceDetailsCard', () => {
  it('uses the member-readable prefill RPC instead of directly reading legal entities', async () => {
    renderCard();

    expect(
      await screen.findByDisplayValue('Iron Fitness Private Limited')
    ).toBeTruthy();
    await waitFor(() => {
      expect(database.rpc).toHaveBeenCalledWith('get_invoice_profile_prefill', {
        p_account_id: 'account-id',
      });
    });
    expect(database.from).not.toHaveBeenCalledWith('legal_entities');
  });

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
    expect(database.rpc).not.toHaveBeenCalledWith(
      'save_invoice_profile',
      expect.anything()
    );
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
    database.rpc.mockImplementation((name) => {
      if (name === 'save_invoice_profile') {
        return Promise.resolve({
          data: null,
          error: new Error('Profile save failed'),
        });
      }
      return Promise.resolve({ data: database.prefill, error: null });
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
    database.rpc.mockImplementation((name) =>
      Promise.resolve({
        data: name === 'save_invoice_profile' ? [] : database.prefill,
        error: null,
      })
    );
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

  it('shows a prefill RPC error through the standard recovery path', async () => {
    database.prefillError = new Error('Prefill unavailable');
    renderCard();

    expect(await screen.findByText('Prefill unavailable')).toBeTruthy();
    expect(
      screen.getByText('Finish Invoice details in Settings -> Payments first.')
    ).toBeTruthy();
  });

  it('keeps a deferred prior-account load hidden after account resolution changes', async () => {
    const oldLoad = deferred<{
      data: Record<string, string> | null;
      error: Error | null;
    }>();
    database.profileRequest = oldLoad.promise;
    const view = renderCard();
    expect(await screen.findByText('Loading invoice details…')).toBeTruthy();

    auth.accountId = 'account-b';
    auth.account = {
      id: 'account-b',
      name: 'Iron Fitness Bandra',
      legal_entity_id: 'entity-b',
    };
    auth.profileLoading = true;
    view.rerender(<InvoiceDetailsCard />);
    oldLoad.resolve({
      data: {
        business_name: 'Old branch',
        legal_name: 'Old entity',
        address_line1: 'Old road',
        address_line2: '',
        city: 'Mumbai',
        state: '',
        postal_code: '',
        country: 'India',
        phone: '',
        email: '',
      },
      error: null,
    });

    await Promise.resolve();
    expect(screen.getByText('Loading invoice details…')).toBeTruthy();
    expect(screen.queryByDisplayValue('Old branch')).toBeNull();
  });

  it('hides a loaded branch profile while the next account is resolving', async () => {
    const view = renderCard();
    await screen.findByDisplayValue('Iron Fitness Andheri');

    auth.accountId = 'account-b';
    auth.account = {
      id: 'account-b',
      name: 'Iron Fitness Bandra',
      legal_entity_id: 'entity-b',
    };
    auth.profileLoading = true;
    view.rerender(<InvoiceDetailsCard />);

    expect(screen.getByText('Loading invoice details…')).toBeTruthy();
    expect(screen.queryByDisplayValue('Iron Fitness Andheri')).toBeNull();
  });

  it('ignores a previous account save that settles after an account transition', async () => {
    const save = deferred<{
      data: Array<{ account_id: string }>;
      error: null;
    }>();
    database.rpc.mockImplementation((name) => {
      if (name === 'save_invoice_profile') return save.promise;
      return Promise.resolve({ data: database.prefill, error: null });
    });
    const view = renderCard();
    await screen.findByDisplayValue('Iron Fitness Andheri');
    validProfile();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save invoice details' })
    );

    auth.accountId = 'account-b';
    auth.account = {
      id: 'account-b',
      name: 'Iron Fitness Bandra',
      legal_entity_id: 'entity-b',
    };
    auth.profileLoading = true;
    view.rerender(<InvoiceDetailsCard />);
    save.resolve({ data: [{ account_id: 'account-id' }], error: null });

    expect(await screen.findByText('Loading invoice details…')).toBeTruthy();
    await Promise.resolve();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
