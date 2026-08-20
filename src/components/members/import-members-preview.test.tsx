// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CatalogItem, MembershipPlan } from '@/types';
import {
  buildMemberImportCandidates,
  type MemberImportCandidateInput,
} from '@/lib/memberships/member-import-candidates';
import { ImportMembersPreview } from './import-members-preview';

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: { phoneCountryCode: '+1' },
    fmt: {
      date: (value: string) => value,
      money: (value: number) => `$${value}`,
      number: (value: number) => String(value),
      today: () => '2026-07-11',
    },
  }),
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(cleanup);

const plans = [
  {
    id: 'plan-gold',
    name: 'Gold Membership With A Deliberately Long Plan Name',
    price: 1200,
    duration_days: 30,
    plan_type: 'recurring',
    pricing_options: [
      {
        id: 'gold-month',
        account_id: 'account-1',
        plan_id: 'plan-gold',
        duration_count: 1,
        duration_unit: 'month',
        price: 1200,
        setup_fee: 0,
        is_active: true,
        sort_order: 0,
        created_at: '',
        updated_at: '',
      },
    ],
  },
] as unknown as MembershipPlan[];

const services = [
  {
    id: 'service-pt',
    account_id: 'account-1',
    kind: 'service',
    name: 'Personal training',
    requires_trainer: false,
    is_active: true,
    catalog_options: [
      {
        id: 'pt-month',
        account_id: 'account-1',
        item_id: 'service-pt',
        duration_count: 1,
        duration_unit: 'month',
        standard_price: 4000,
        is_active: true,
        trainer_rates: [],
      },
    ],
  },
] as unknown as CatalogItem[];

function input(
  sourceRow: number,
  values: Partial<MemberImportCandidateInput['originalValues']> = {}
): MemberImportCandidateInput {
  return {
    sourceKey: `sheet:${sourceRow}`,
    sourceRow,
    legacyMemberId: `LEG-${sourceRow}`,
    originalValues: {
      phone: `+1555000${String(sourceRow).padStart(4, '0')}`,
      name: `Member ${sourceRow}`,
      planName: 'Gold Membership With A Deliberately Long Plan Name',
      startDate: '01/01/2026',
      fee: '1200',
      amountPaid: '1200',
      tagNames: [],
      customValues: [],
      ...values,
    },
  };
}

function candidates(
  rows: MemberImportCandidateInput[],
  catalogItems: CatalogItem[] = []
) {
  return buildMemberImportCandidates(rows, {
    plans,
    catalogItems,
    dateOrder: 'DMY',
    today: '2026-07-11',
  });
}

function renderPreview(
  rows: ReturnType<typeof candidates>,
  overrides: Partial<React.ComponentProps<typeof ImportMembersPreview>> = {}
) {
  const props: React.ComponentProps<typeof ImportMembersPreview> = {
    candidates: rows,
    plans,
    catalogItems: [],
    trainers: [],
    onPatch: vi.fn(),
    onResolveGroupedPlan: vi.fn(),
    onResolveGroupedOffering: vi.fn(),
    onResolveGroupedService: vi.fn(),
    onResolvePayment: vi.fn(),
    onResolveExistingContact: vi.fn(),
    onSetDisposition: vi.fn(),
    ...overrides,
  };
  render(<ImportMembersPreview {...props} />);
  return props;
}

describe('ImportMembersPreview conflict resolution', () => {
  it('focuses the issue queue and reveals the row ledger only on request', async () => {
    const user = userEvent.setup();
    renderPreview(
      candidates([input(2, { phone: '' }), input(3, { name: 'Ready member' })])
    );

    expect(
      screen.getByRole('tab', {
        name: 'Issues, 1 to resolve',
        selected: true,
      })
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Focused issue' })).toBeTruthy();
    expect(screen.queryByTestId('member-import-desktop')).toBeNull();

    await user.click(
      screen.getByRole('tab', { name: 'Review rows, 2 in total' })
    );

    expect(screen.getByTestId('member-import-desktop')).toBeTruthy();
    expect(
      screen.getByRole('searchbox', { name: 'Search import rows' })
    ).toBeTruthy();
  });

  it('shows a plus on digits-only account-qualified phones', () => {
    renderPreview(candidates([input(2, { phone: '15550000044' })]));

    const desktop = screen.getByTestId('member-import-desktop');
    expect(within(desktop).getByText('+15550000044')).toBeTruthy();
    const mobile = screen.getByTestId('member-import-mobile');
    expect(within(mobile).getByText('+15550000044')).toBeTruthy();
  });

  it('preserves invalid source text instead of presenting it as account-qualified', async () => {
    const user = userEvent.setup();
    renderPreview(candidates([input(2, { phone: 'not-a-phone' })]));

    await user.click(
      screen.getByRole('tab', { name: 'Review rows, 1 in total' })
    );

    const desktop = screen.getByTestId('member-import-desktop');
    expect(within(desktop).getByText('not-a-phone')).toBeTruthy();
    expect(within(desktop).queryByText('+1not-a-phone')).toBeNull();
  });

  it('preserves a national phone that begins with its country code', () => {
    renderPreview(candidates([input(2, { phone: '1555000044' })]));

    const desktop = screen.getByTestId('member-import-desktop');
    expect(within(desktop).getByText('1555000044')).toBeTruthy();
    expect(within(desktop).queryByText('+1555000044')).toBeNull();
  });

  it('keeps the complete phone and icon actions together in a floated editor', async () => {
    const user = userEvent.setup();
    renderPreview(candidates([input(2, { phone: '15550000044' })]));

    const desktop = screen.getByTestId('member-import-desktop');
    await user.click(
      within(desktop).getByRole('button', { name: '+15550000044' })
    );

    const phone = within(desktop).getByRole('textbox') as HTMLInputElement;
    const editor = phone.parentElement?.parentElement;
    const save = within(desktop).getByRole('button', { name: 'Save' });
    const cancel = within(desktop).getByRole('button', { name: 'Cancel' });

    expect(phone.value).toBe('5550000044');
    expect(phone.className).toContain('pr-13');
    expect(editor?.className).toContain('w-[min(15rem,calc(100vw-2rem))]');
    expect(editor?.className).toContain('z-20');
    expect(editor?.className).toContain('shadow-md');
    expect(save.textContent).toBe('');
    expect(cancel.textContent).toBe('');
    expect(editor?.contains(save)).toBe(true);
    expect(editor?.contains(cancel)).toBe(true);
  });

  it('repairs a phone conflict inline without jumping to the row ledger', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    renderPreview(
      candidates([
        input(2, { phone: '+15550000044', name: 'Asha Rao' }),
        input(3, { phone: '+15550000044', name: 'Neha Rao' }),
      ]),
      { onPatch }
    );

    const focusedIssue = screen.getByRole('region', { name: 'Focused issue' });
    const phones = within(focusedIssue).getAllByRole('textbox');
    expect(phones).toHaveLength(2);

    await user.clear(phones[1]);
    await user.type(phones[1], '5550000055');
    await user.click(
      within(focusedIssue).getByRole('button', { name: 'Save & resolve' })
    );

    expect(onPatch).toHaveBeenCalledWith('sheet:3', {
      phone: '+15550000055',
    });
    expect(screen.queryByTestId('member-import-desktop')).toBeNull();
  });

  it('explains each phone issue as the operator advances the queue', async () => {
    const user = userEvent.setup();
    renderPreview(
      candidates([
        input(2, { phone: '' }),
        input(3, { phone: 'not-a-phone' }),
        input(4, { phone: '+15550000044', name: 'Asha Rao' }),
        input(5, { phone: '+15550000044', name: 'Neha Rao' }),
      ])
    );

    expect(
      screen.getByRole('heading', { name: 'Add missing phone number' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Every member needs their own phone number. Add one, or exclude the row.'
      )
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next issue' }));
    expect(
      screen.getByRole('heading', { name: 'Correct invalid phone number' })
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next issue' }));
    expect(
      screen.getByRole('heading', {
        name: 'Phone number used by multiple members',
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'More than one member in this file uses this phone number. Give each member their own number, or exclude the duplicate. UsefulDesk never merges these records.'
      )
    ).toBeTruthy();
  });

  it('keeps a correction directly accessible when its row is beyond the first ledger page', () => {
    const rows = Array.from({ length: 51 }, (_, index) => input(index + 2));
    rows[50] = input(52, { phone: '' });
    renderPreview(candidates(rows));

    const focusedIssue = screen.getByRole('region', { name: 'Focused issue' });
    expect(within(focusedIssue).getByText('Member 52')).toBeTruthy();
    expect(
      within(focusedIssue).getByRole('textbox', {
        name: 'Phone for Member 52',
      })
    ).toBeTruthy();
    expect(screen.queryByTestId('member-import-desktop')).toBeNull();
  });

  it('keeps a missing-phone editor visible and saves its correction inline', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    renderPreview(candidates([input(2, { phone: '' })]), { onPatch });

    const phone = screen.getByRole('textbox', { name: 'Phone for Member 2' });
    await user.type(phone, '5550000099');
    await user.click(screen.getByRole('button', { name: 'Save & resolve' }));

    expect(onPatch).toHaveBeenCalledWith('sheet:2', {
      phone: '+15550000099',
    });
  });

  it('applies one canonical plan and billing option to every row in a conflict group', async () => {
    const user = userEvent.setup();
    const onResolveGroupedPlan = vi.fn();
    renderPreview(
      candidates([
        input(2, { planName: 'Legacy Gold', pricingOption: 'Monthly' }),
        input(3, { planName: 'Legacy Gold', pricingOption: 'Monthly' }),
      ]),
      { onResolveGroupedPlan }
    );

    const planSelect = screen.getByRole('combobox', {
      name: 'Map Legacy Gold · Monthly',
    });
    planSelect.focus();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onResolveGroupedPlan).toHaveBeenCalledWith(['sheet:2', 'sheet:3'], {
      planId: 'plan-gold',
      pricingOptionId: 'gold-month',
    });
  });

  it('requires an explicit payment choice and reports the selected decision', async () => {
    const user = userEvent.setup();
    const onResolvePayment = vi.fn();
    renderPreview(
      candidates([
        input(2, { fee: '1200', amountPaid: '700', balance: '600' }),
      ]),
      { onResolvePayment }
    );

    // The queue names each issue kind above its instances, so the focused
    // title is asserted as the heading rather than as page text.
    expect(
      screen.getByRole('heading', { name: 'Payment figures conflict' })
    ).toBeTruthy();
    const paymentSelect = screen.getByRole('combobox', {
      name: 'Resolve payment for source row 2',
    });
    paymentSelect.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    expect(onResolvePayment).toHaveBeenCalledWith('sheet:2', 'member_only');
  });

  it('lets a blocking membership value be repaired without excluding the row', () => {
    const onPatch = vi.fn();
    renderPreview(candidates([input(2, { status: 'ALIEN' })]), { onPatch });

    const status = screen.getByRole('textbox', {
      name: 'Status for source row 2',
    });
    fireEvent.change(status, { target: { value: 'Active' } });
    fireEvent.blur(status);

    expect(onPatch).toHaveBeenCalledWith('sheet:2', { status: 'Active' });
  });

  it('shows service outcome, fee, and its own expiry date', () => {
    renderPreview(
      candidates(
        [
          input(2, {
            planName: '',
            serviceName: 'Personal training',
            serviceOption: '1 month',
            serviceStart: '01/08/2026',
            serviceSoldPrice: '3500',
            fee: '3500',
          }),
        ],
        services
      ),
      { catalogItems: services }
    );

    const desktop = screen.getByTestId('member-import-desktop');
    expect(within(desktop).getByText('Service')).toBeTruthy();
    // The sold price reads from the Fee column, and a service-only row
    // promotes its own end date into Expiry rather than borrowing a
    // membership's.
    expect(within(desktop).getByText('$3500')).toBeTruthy();
    expect(within(desktop).getByText('2026-09-01')).toBeTruthy();
  });

  it('offers labelled corrections for an invalid service purchase total', () => {
    const onPatch = vi.fn();
    renderPreview(
      candidates(
        [
          input(2, {
            planName: '',
            serviceName: 'Personal training',
            serviceOption: '1 month',
            serviceSoldPrice: '4000',
            fee: 'not money',
          }),
        ],
        services
      ),
      { catalogItems: services, onPatch }
    );

    expect(
      screen.getByRole('heading', { name: 'Correct purchase total' })
    ).toBeTruthy();
    const total = screen.getByRole('textbox', {
      name: 'Row total for source row 2',
    });
    fireEvent.change(total, { target: { value: '4000' } });
    fireEvent.blur(total);
    expect(onPatch).toHaveBeenCalledWith('sheet:2', { fee: '4000' });
  });

  it('provides a compact issue picker when the desktop queue is unavailable', () => {
    renderPreview(candidates([input(2, { phone: '' })]));

    expect(screen.getByRole('combobox', { name: 'Choose issue' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Focused issue' })).toBeTruthy();
  });
});
