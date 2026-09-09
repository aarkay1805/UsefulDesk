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

import { downloadCsv } from '@/lib/csv/export';
import type { CatalogItem, MembershipPlan } from '@/types';
import {
  buildMemberImportCandidates,
  resolvePaymentConflict,
  type MemberImportCandidateInput,
} from '@/lib/memberships/member-import-candidates';
import { ImportMembersPreview } from './import-members-preview';

vi.mock('@/lib/csv/export', async (original) => ({
  ...(await original<typeof import('@/lib/csv/export')>()),
  downloadCsv: vi.fn(),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: { phoneCountryCode: '+1' },
    fmt: {
      date: (value: string) => value,
      money: (value: number) => `$${value}`,
      number: (value: number) => String(value),
      phone: (value?: string | null) => {
        if (!value || value === 'not-a-phone' || value.startsWith('+')) {
          return value ?? '';
        }
        return value.length === 11 ? `+${value}` : `+1${value}`;
      },
      today: () => '2026-07-11',
      config: { phoneCountryCode: '+1' },
    },
  }),
}));

beforeAll(() => {
  Element.prototype.getAnimations = () => [];
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
    onResolveMembershipTerm: vi.fn(),
    onResolveCancelledDebt: vi.fn(),
    onSetDisposition: vi.fn(),
    ...overrides,
  };
  const { rerender } = render(<ImportMembersPreview {...props} />);
  return { ...props, rerender };
}

describe('ImportMembersPreview worksheet', () => {
  it('leads an all-excluded import back to its rows and lets a manual exclusion be reversed', async () => {
    const user = userEvent.setup();
    const rows = candidates([input(2, { phone: '' })]);
    const { rerender, ...props } = renderPreview(rows);
    rerender(
      <ImportMembersPreview
        {...props}
        candidates={rows.map((row) => ({
          ...row,
          disposition: 'excluded',
          exclusionReason: 'manual',
          isReady: false,
        }))}
      />
    );

    expect(screen.getByText('Every row is excluded')).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Review excluded rows' })
    );
    await user.click(
      within(screen.getByTestId('member-import-mobile')).getByRole('button', {
        name: 'Review Member 2, source row 2',
      })
    );
    await user.click(
      screen.getByRole('button', { name: 'Include Member 2, source row 2' })
    );
    expect(props.onSetDisposition).toHaveBeenCalledWith('sheet:2', 'included');
  });

  it('keeps a clear way forward when the last review issue is resolved', async () => {
    const user = userEvent.setup();
    const rows = candidates([input(2, { amountPaid: '500', balance: '100' })]);
    const { rerender, ...props } = renderPreview(rows);
    await user.click(
      within(screen.getByTestId('member-import-mobile')).getByRole('button', {
        name: 'Review Member 2, source row 2',
      })
    );
    const corrected = resolvePaymentConflict(
      rows,
      rows[0].sourceKey,
      'manual',
      { paid: '500', balance: '700' },
      { plans, dateOrder: 'DMY', today: '2026-07-11' }
    );
    rerender(<ImportMembersPreview {...props} candidates={corrected} />);
    expect(screen.getByText('All included rows are ready')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Row inspector' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review ready rows' }));
    expect(
      within(screen.getByRole('table')).getByText('Member 2')
    ).toBeTruthy();
  });

  it('opens the needs-review worksheet beside its resolver and keeps ready rows reachable', async () => {
    const user = userEvent.setup();
    renderPreview(
      candidates([input(2, { phone: '' }), input(3, { name: 'Ready member' })])
    );
    const table = screen.getByRole('table', { name: 'Import rows' });
    expect(within(table).getByText('Member 2')).toBeTruthy();
    expect(within(table).queryByText('Ready member')).toBeNull();
    expect(screen.getByRole('region', { name: 'Focused issue' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ready 1' }));
    expect(
      within(screen.getByRole('table')).getByText('Ready member')
    ).toBeTruthy();
  });

  it.each([
    ['15550000044', '+15550000044'],
    ['1555000044', '+11555000044'],
    ['not-a-phone', 'not-a-phone'],
  ])('shows %s honestly in the row inspector', (phone, display) => {
    renderPreview(candidates([input(2, { phone })]));
    expect(
      within(screen.getByRole('region', { name: 'Row inspector' })).getByText(
        display
      )
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('member-import-mobile')).getByText(display)
    ).toBeTruthy();
  });

  it('keeps a ready phone editable in the inspector', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderPreview(candidates([input(2)]));
    await user.click(screen.getByRole('button', { name: 'Edit phone' }));
    const phone = screen.getByRole('textbox', { name: 'Phone for Member 2' });
    await user.clear(phone);
    await user.type(phone, '5550000099');
    await user.click(
      screen.getByRole('button', { name: 'Save phone changes' })
    );
    expect(onPatch).toHaveBeenCalledWith('sheet:2', { phone: '+15550000099' });
  });

  it('shows and corrects both people in a shared-phone group without leaving the worksheet', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderPreview(
      candidates([
        input(2, { phone: '+15550000044', name: 'Asha Rao' }),
        input(3, { phone: '+15550000044', name: 'Neha Rao' }),
      ])
    );
    const issue = screen.getByRole('region', { name: 'Focused issue' });
    const phones = within(issue).getAllByRole('textbox');
    expect(phones).toHaveLength(2);
    await user.clear(phones[1]);
    await user.type(phones[1], '5550000055');
    await user.click(
      within(
        screen.getByRole('group', { name: 'Resolution actions' })
      ).getByRole('button', { name: 'Save phone changes' })
    );
    expect(onPatch).toHaveBeenCalledWith('sheet:3', { phone: '+15550000055' });
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('opens one issue accordion at a time beside its corresponding correction', async () => {
    const user = userEvent.setup();
    renderPreview(
      candidates([input(2, { phone: '' }), input(3, { phone: 'not-a-phone' })])
    );
    expect(
      screen.getByRole('heading', { name: 'Add missing phone number' })
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Missing phones 1' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Invalid phones 1' }));
    expect(
      screen
        .getByRole('button', { name: 'Missing phones 1' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    expect(
      screen
        .getByRole('button', { name: 'Invalid phones 1' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(
      screen.getByRole('heading', { name: 'Correct invalid phone number' })
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Missing phones 1' }));
    expect(
      screen.getByRole('heading', { name: 'Add missing phone number' })
    ).toBeTruthy();
  });

  it('keeps an instructional side panel when every issue accordion is collapsed and restores the correction on reopen', async () => {
    const user = userEvent.setup();
    renderPreview(
      candidates([input(2, { phone: '' }), input(3, { phone: 'not-a-phone' })])
    );
    await user.click(screen.getByRole('button', { name: 'Missing phones 1' }));
    expect(
      screen
        .getByRole('button', { name: 'Missing phones 1' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    expect(
      screen
        .getByRole('button', { name: 'Invalid phones 1' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    expect(screen.queryByRole('table')).toBeNull();
    const inspector = within(
      screen.getByRole('region', { name: 'Row inspector' })
    );
    expect(inspector.getByText('Choose a row to review')).toBeTruthy();
    expect(
      inspector.getByText(
        'Open a group on the left, then choose a row. This panel shows what needs fixing and how to fix it.'
      )
    ).toBeTruthy();
    expect(inspector.queryByRole('textbox')).toBeNull();
    expect(
      inspector.queryByRole('group', { name: 'Resolution actions' })
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Missing phones 1' }));
    expect(
      within(screen.getByRole('table')).getByText('Member 2')
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Phone for Member 2' })
    ).toBeTruthy();
    expect(screen.queryByText('Choose a row to review')).toBeNull();
  });

  it('counts each row once per issue type and focuses that type on multi-issue rows', async () => {
    const user = userEvent.setup();
    renderPreview(
      candidates([
        input(2, {
          listPrice: '1500',
          discountAmount: '200',
          fee: '1200',
          amountPaid: '700',
          amountDue: '600',
        }),
        input(3, {
          phone: '+15550000044',
          fee: '1200',
          amountPaid: '700',
          amountDue: '600',
        }),
        input(4, { phone: '+15550000044' }),
        input(5, { phone: '' }),
        input(6, { phone: 'not-a-phone' }),
      ])
    );
    const table = screen.getByRole('table');
    expect(
      screen.getByRole('button', { name: 'Billing issues 2' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Needs review 5' })).toBeTruthy();
    expect(within(table).getByText('Member 2')).toBeTruthy();
    expect(within(table).getByText('Member 3')).toBeTruthy();
    expect(within(table).queryByText('Member 4')).toBeNull();
    await user.click(
      within(table).getByRole('button', {
        name: 'Review Member 3, source row 3',
      })
    );
    expect(
      screen.getByRole('combobox', { name: 'Resolve payment for source row 3' })
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Duplicate phones 2' })
    );
    expect(
      within(screen.getByRole('table')).getByText('Member 3')
    ).toBeTruthy();
    expect(
      within(screen.getByRole('table')).getByText('Member 4')
    ).toBeTruthy();
    expect(
      within(screen.getByRole('table')).queryByText('Member 2')
    ).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Phone for Member 3' })
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Phone for Member 4' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('combobox', {
        name: 'Resolve payment for source row 3',
      })
    ).toBeNull();
  });

  it('searches closed accordions and preserves the original grouped mapping scope', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 51 }, (_, index) =>
      input(index + 2, {
        fee: '1200',
        amountPaid: '700',
        amountDue: '600',
      })
    );
    rows.push(input(53, { planName: 'Legacy Gold', pricingOption: 'Monthly' }));
    rows.push(
      input(54, { planName: 'Legacy Silver', pricingOption: 'Monthly' })
    );
    rows.push(input(55, { planName: 'Legacy Gold', pricingOption: 'Monthly' }));
    const { onResolveGroupedPlan } = renderPreview(candidates(rows));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.type(screen.getByRole('searchbox'), 'Member 53');
    expect(
      screen
        .getByRole('button', { name: 'Plan matching 1' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Plan matching 1' }));
    await user.click(screen.getByRole('button', { name: 'Plan matching 1' }));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      'Member 53'
    );
    expect(
      within(screen.getByRole('table')).getByText('Member 53')
    ).toBeTruthy();
    expect(
      within(screen.getByRole('table')).queryByText('Member 54')
    ).toBeNull();
    screen.getByRole('combobox', { name: 'Map Legacy Gold · Monthly' }).focus();
    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(screen.getByRole('button', { name: 'Apply to 2 rows' }));
    expect(onResolveGroupedPlan).toHaveBeenCalledWith(
      ['sheet:53', 'sheet:55'],
      {
        planId: 'plan-gold',
        pricingOptionId: 'gold-month',
      }
    );
  });

  it('moves a corrected row out of billing while keeping its duplicate-phone issue visible', () => {
    const rows = candidates([
      input(2, {
        phone: '+15550000044',
        fee: '1200',
        amountPaid: '700',
        amountDue: '600',
      }),
      input(3, { phone: '+15550000044' }),
    ]);
    const props = renderPreview(rows);
    expect(
      screen.getByRole('button', { name: 'Billing issues 1' })
    ).toBeTruthy();
    const corrected = resolvePaymentConflict(
      rows,
      'sheet:2',
      'manual',
      { paid: '700', balance: '500' },
      {
        plans,
        catalogItems: [],
        dateOrder: 'DMY',
        today: '2026-07-11',
      }
    );
    props.rerender(<ImportMembersPreview {...props} candidates={corrected} />);
    expect(screen.queryByRole('button', { name: /Billing issues/ })).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Duplicate phones 2' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(
      screen.getByRole('textbox', { name: 'Phone for Member 2' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Needs review 2' })).toBeTruthy();
  });

  it('finds a problem beyond the first unfiltered page and recovers from empty search', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 51 }, (_, index) => input(index + 2));
    rows[50] = input(52, { phone: '' });
    renderPreview(candidates(rows));
    expect(
      screen.getByRole('textbox', { name: 'Phone for Member 52' })
    ).toBeTruthy();
    await user.type(screen.getByRole('searchbox'), 'missing-search-value');
    expect(screen.queryByRole('region', { name: 'Row inspector' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show all rows' }));
    expect(
      within(screen.getByRole('table')).getByText('Member 2')
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(
      within(screen.getByRole('table')).getByText('Member 52')
    ).toBeTruthy();
  });

  it('stages one plan and billing option before applying it to the named matching rows', async () => {
    const user = userEvent.setup();
    const { onResolveGroupedPlan } = renderPreview(
      candidates([
        input(2, { planName: 'Legacy Gold', pricingOption: 'Monthly' }),
        input(3, { planName: 'Legacy Gold', pricingOption: 'Monthly' }),
      ])
    );
    screen.getByRole('combobox', { name: 'Map Legacy Gold · Monthly' }).focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onResolveGroupedPlan).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply to 2 rows' }));
    expect(onResolveGroupedPlan).toHaveBeenCalledWith(['sheet:2', 'sheet:3'], {
      planId: 'plan-gold',
      pricingOptionId: 'gold-month',
    });
  });

  it('keeps fee and paid, previews corrected dues, and only saves after explicit confirmation', async () => {
    const user = userEvent.setup();
    const { onResolvePayment } = renderPreview(
      candidates([
        input(2, { fee: '1200', amountPaid: '700', amountDue: '600' }),
      ])
    );
    expect(
      within(screen.getByRole('region', { name: 'Focused issue' })).getByText(
        '$600'
      )
    ).toBeTruthy();
    screen
      .getByRole('combobox', { name: 'Resolve payment for source row 2' })
      .focus();
    await user.keyboard('{ArrowDown}{Enter}');
    const preview = screen.getByRole('region', { name: 'After correction' });
    expect(within(preview).getByText('$1200')).toBeTruthy();
    expect(within(preview).getByText('$700')).toBeTruthy();
    expect(within(preview).getByText('$500')).toBeTruthy();
    expect(onResolvePayment).not.toHaveBeenCalled();
    const save = within(
      screen.getByRole('group', { name: 'Resolution actions' })
    ).getByRole('button', { name: 'Save payment correction' });
    expect(save.closest('[data-slot="scroll-area-viewport"]')).toBeNull();
    await user.click(save);
    expect(onResolvePayment).toHaveBeenCalledWith('sheet:2', 'manual', {
      paid: '700',
      balance: '500',
    });
  });

  it('keeps the next unresolved row selected when saving removes a row at a page boundary', async () => {
    const user = userEvent.setup();
    const rows = candidates(
      Array.from({ length: 51 }, (_, index) =>
        input(index + 2, { fee: '1200', amountPaid: '700', amountDue: '600' })
      )
    );
    const props = renderPreview(rows);
    await user.click(
      within(screen.getByRole('table')).getByRole('button', {
        name: 'Review Member 51, source row 51',
      })
    );
    screen
      .getByRole('combobox', { name: 'Resolve payment for source row 51' })
      .focus();
    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(
      screen.getByRole('button', { name: 'Save payment correction' })
    );
    const corrected = resolvePaymentConflict(
      rows,
      'sheet:51',
      'manual',
      { paid: '700', balance: '500' },
      {
        plans,
        catalogItems: [],
        dateOrder: 'DMY',
        today: '2026-07-11',
      }
    );
    props.rerender(<ImportMembersPreview {...props} candidates={corrected} />);
    expect(
      screen.getByRole('combobox', {
        name: 'Resolve payment for source row 52',
      })
    ).toBeTruthy();
    expect(
      within(screen.getByRole('table')).getByText('Member 52')
    ).toBeTruthy();
  });

  it('blocks unreadable and inconsistent manual corrections instead of treating them as zero', async () => {
    const user = userEvent.setup();
    const { onResolvePayment } = renderPreview(
      candidates([
        input(2, { fee: '1200', amountPaid: '700', amountDue: '600' }),
      ])
    );
    screen
      .getByRole('combobox', { name: 'Resolve payment for source row 2' })
      .focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    const paid = screen.getByRole('textbox', { name: 'Corrected paid' });
    await user.clear(paid);
    await user.type(paid, 'unknown');
    expect(
      (
        screen.getByRole('button', {
          name: 'Save payment correction',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(onResolvePayment).not.toHaveBeenCalled();
  });

  it('repairs an invalid membership field in the inspector', () => {
    const { onPatch } = renderPreview(
      candidates([input(2, { status: 'ALIEN' })])
    );
    const status = screen.getByRole('textbox', {
      name: 'Status for source row 2',
    });
    fireEvent.change(status, { target: { value: 'Active' } });
    fireEvent.blur(status);
    expect(onPatch).toHaveBeenCalledWith('sheet:2', { status: 'Active' });
  });

  it('offers an explicit current-term choice for ambiguous legacy memberships', async () => {
    const rows = candidates(
      [
        input(2, { startDate: '01/07/2026', endDate: '01/08/2026' }),
        input(3, { startDate: '01/07/2026', endDate: '01/09/2026' }),
      ].map((row) => ({ ...row, legacyMemberId: 'LEG-SAME' }))
    ).map((row) => ({
      ...row,
      isReady: false,
      issues: [
        ...row.issues,
        {
          code: 'membership-term-needs-resolution' as const,
          severity: 'decision' as const,
          groupKey: 'membership-term:LEG-SAME',
          explanation:
            'More than one membership term is equally current in this file.',
          nextAction: 'Choose the one current membership term to import.',
          message:
            'More than one membership term is equally current in this file.',
          resolved: false,
        },
      ],
    }));
    const { onResolveMembershipTerm } = renderPreview(rows);
    const choice = screen.getByRole('combobox', {
      name: 'Choose current membership term for LEG-SAME',
    });
    choice.focus();
    await userEvent.setup().keyboard('{ArrowDown}{Enter}');
    expect(onResolveMembershipTerm).toHaveBeenCalledWith('LEG-SAME', 'sheet:2');
  });

  it('locks a checkpointed row from identity edits while it is recoverable', () => {
    renderPreview(candidates([input(2, { phone: '' })]), {
      lockedSourceKeys: new Set(['sheet:2']),
    });
    expect(
      screen.getByText(
        'This row already has a saved import attempt. Its details are locked so a retry can use the exact recorded payload.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole('textbox', { name: 'Phone for Member 2' })
    ).toBeNull();
  });

  it('requires an explicit cancelled-membership balance write-off', async () => {
    const user = userEvent.setup();
    const { onResolveCancelledDebt } = renderPreview(
      candidates([
        input(2, {
          status: 'cancelled',
          amountPaid: '500',
          amountDue: '700',
        }),
      ])
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Record membership balance write-off',
      })
    );
    expect(onResolveCancelledDebt).toHaveBeenCalledWith('sheet:2');
  });

  it('exposes the list price and discount that caused a membership pricing mismatch', () => {
    const { onPatch } = renderPreview(
      candidates([
        input(2, { listPrice: '1500', discountAmount: '200', fee: '1200' }),
      ])
    );
    expect(
      screen.getByRole('textbox', { name: 'List price for source row 2' })
    ).toBeTruthy();
    const discount = screen.getByRole('textbox', {
      name: 'Discount for source row 2',
    });
    fireEvent.change(discount, { target: { value: '300' } });
    fireEvent.blur(discount);
    expect(onPatch).toHaveBeenCalledWith('sheet:2', { discountAmount: '300' });
  });

  it('shows service outcome, fee and service expiry in its inspector', () => {
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
            amountPaid: '3500',
          }),
        ],
        services
      ),
      { catalogItems: services }
    );
    const inspector = screen.getByRole('region', { name: 'Row inspector' });
    expect(within(inspector).getByText('Service')).toBeTruthy();
    expect(within(inspector).getByText('$3500')).toBeTruthy();
    expect(within(inspector).getByText('2026-09-01')).toBeTruthy();
    const actions = screen.getByRole('group', { name: 'Resolution actions' });
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Edit phone', 'Exclude this row']);
  });

  it.each(['membership-history', 'summary-row', 'existing-member'] as const)(
    'keeps an automatically excluded %s row read-only without an empty action footer',
    (exclusionReason) => {
      const rows = candidates([input(2)]);
      rows[0] = {
        ...rows[0],
        disposition: 'excluded',
        exclusionReason,
        isReady: false,
      };
      renderPreview(rows);
      expect(
        screen.getByRole('region', { name: 'Row inspector' })
      ).toBeTruthy();
      expect(
        screen.queryByRole('group', { name: 'Resolution actions' })
      ).toBeNull();
      expect(screen.queryByRole('button', { name: /^Include / })).toBeNull();
    }
  );

  it('offers only reinclusion for a manually excluded row', async () => {
    const user = userEvent.setup();
    const rows = candidates([input(2)]);
    rows[0] = {
      ...rows[0],
      disposition: 'excluded',
      exclusionReason: 'manual',
      isReady: false,
    };
    const { onSetDisposition } = renderPreview(rows);
    const actions = screen.getByRole('group', { name: 'Resolution actions' });
    const buttons = within(actions).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Include this row');
    await user.click(buttons[0]);
    expect(onSetDisposition).toHaveBeenCalledWith('sheet:2', 'included');
  });

  it('omits Save when a service has no available mapping option', () => {
    renderPreview(
      candidates([
        input(2, {
          planName: '',
          serviceName: 'Unlisted service',
          serviceOption: '1 month',
          serviceStart: '01/08/2026',
          serviceSoldPrice: '1200',
        }),
      ])
    );
    expect(
      screen.getByText(/No active service option matches this row/)
    ).toBeTruthy();
    const actions = screen.getByRole('group', { name: 'Resolution actions' });
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Edit phone', 'Exclude this row']);
  });

  it('offers corrections for an invalid service purchase total', () => {
    const { onPatch } = renderPreview(
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
      { catalogItems: services }
    );
    const total = screen.getByRole('textbox', {
      name: 'Row total for source row 2',
    });
    fireEvent.change(total, { target: { value: '4000' } });
    fireEvent.blur(total);
    expect(onPatch).toHaveBeenCalledWith('sheet:2', { fee: '4000' });
  });

  it('makes notices available on demand even when a row is ready', async () => {
    const user = userEvent.setup();
    const rows = candidates([input(2, { endDate: '20/02/2026' })]);
    const notice = rows[0].issues.find((issue) => issue.severity === 'notice');
    expect(notice).toBeTruthy();
    renderPreview(rows);
    expect(
      screen.getByRole('heading', { name: 'Import notices' })
    ).toBeTruthy();
    expect(screen.queryByText(notice!.explanation)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Import notices' }));
    expect(screen.getByText(notice!.explanation)).toBeTruthy();
  });

  it('reviews excluded rows through their filter and downloads source values with reasons', async () => {
    const user = userEvent.setup();
    const rows = candidates([input(2, { name: '=unsafe formula' }), input(3)]);
    rows[0] = {
      ...rows[0],
      disposition: 'excluded',
      exclusionReason: 'manual',
      isReady: false,
    };
    renderPreview(rows);
    await user.type(screen.getByRole('searchbox'), 'Member 3');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await user.click(screen.getByRole('button', { name: /^Excluded/ }));
    expect(
      within(screen.getByRole('table')).getByText('=unsafe formula')
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Download excluded rows' })
    );
    expect(downloadCsv).toHaveBeenCalledWith(
      'member-import-excluded.csv',
      expect.stringContaining("'=unsafe formula")
    );
    expect(downloadCsv).toHaveBeenCalledWith(
      'member-import-excluded.csv',
      expect.stringContaining('Excluded by you')
    );
  });
});
