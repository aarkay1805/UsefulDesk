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

import type { MembershipPlan } from '@/types';
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

function candidates(rows: MemberImportCandidateInput[]) {
  return buildMemberImportCandidates(rows, {
    plans,
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
    onPatch: vi.fn(),
    onResolveGroupedPlan: vi.fn(),
    onResolvePayment: vi.fn(),
    onResolveExistingContact: vi.fn(),
    onSetDisposition: vi.fn(),
    ...overrides,
  };
  render(<ImportMembersPreview {...props} />);
  return props;
}

describe('ImportMembersPreview conflict resolution', () => {
  it('keeps a missing-phone candidate visible and opens its inline phone editor', async () => {
    const user = userEvent.setup();
    renderPreview(candidates([input(2, { phone: '' })]));

    const desktop = screen.getByTestId('member-import-desktop');
    expect(within(desktop).getByText('Member 2')).toBeTruthy();
    await user.click(
      within(desktop).getByRole('button', { name: 'Add phone' })
    );

    expect(document.activeElement).toBe(within(desktop).getByRole('textbox'));
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

    expect(screen.getByText('Payment figures conflict')).toBeTruthy();
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

    expect(onPatch).toHaveBeenCalledWith('sheet:2', { status: 'Active' });
  });
});
