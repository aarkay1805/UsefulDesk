// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { MembershipPlan } from '@/types';

type MockImportDraft = {
  id: string;
  revision: number;
  sourceFilename: string;
  state: Record<string, unknown>;
};

const draftHook = vi.hoisted(() => ({
  draft: null as MockImportDraft | null,
  saveState: 'idle' as
    'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'conflict',
  lastAcknowledgedRevision: null as number | null,
  lastError: null as string | null,
  adopt: vi.fn(),
  load: vi.fn(async (): Promise<MockImportDraft | null> => null),
  reload: vi.fn(async (): Promise<MockImportDraft | null> => null),
  initialize: vi.fn(
    async (): Promise<null | {
      id: string;
      revision: number;
      sourceFilename: string;
      state: Record<string, unknown>;
    }> => null
  ),
  save: vi.fn(),
  flush: vi.fn(async () => true),
  saveAndFlush: vi.fn(async () => true),
  discard: vi.fn(async () => true),
}));

const membershipPlansHook = vi.hoisted(() => ({
  plans: [] as MembershipPlan[],
  loading: false,
}));

vi.mock('@/hooks/use-member-import-draft', () => ({
  useMemberImportDraft: () => draftHook,
}));

const plan = {
  id: 'gold',
  name: 'Gold',
  price: 1200,
  duration_days: 30,
  plan_type: 'recurring',
  pricing_options: [
    {
      id: 'gold-month',
      account_id: 'account',
      plan_id: 'gold',
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
} as unknown as MembershipPlan;

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account',
    user: { id: 'user' },
    canEditSettings: true,
  }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: {
      phoneCountryCode: '+91',
      dateOrder: 'DMY',
      timeZone: 'Asia/Kolkata',
      currency: 'INR',
    },
    fmt: {
      date: (value: string) => value,
      money: (value: number) => `₹${value}`,
      number: (value: number) => String(value),
      phone: (value?: string | null) => value ?? '',
      today: () => '2026-08-16',
      config: { phoneCountryCode: '+91' },
    },
  }),
}));

vi.mock('./use-membership-plans', () => ({
  useMembershipPlans: () => membershipPlansHook,
}));

vi.mock('./use-account-staff', () => ({
  useAccountStaff: () => ({ staff: [], loading: false }),
}));

const emptyResult = { data: [], error: null };
const supabase = {
  rpc: vi.fn(),
  from: vi.fn((table: string) => {
    const result = table === 'custom_fields' ? emptyResult : emptyResult;
    const query = {
      range: async () => result,
      order: () => query,
      then: (resolve: (value: typeof result) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    const filter = {
      eq: () => query,
      order: () => filter,
    };
    return { select: () => filter };
  }),
};

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabase }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

const { ImportMembersCsvDialog } = await import('./import-members-csv-dialog');

beforeAll(() => {
  Element.prototype.getAnimations = () => [];
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

beforeEach(() => {
  supabase.rpc.mockReset();
  membershipPlansHook.plans = [plan];
  membershipPlansHook.loading = false;
  draftHook.draft = null;
  draftHook.saveState = 'idle';
  draftHook.lastAcknowledgedRevision = null;
  draftHook.load.mockClear();
  draftHook.reload.mockClear();
  draftHook.initialize.mockReset().mockImplementation(async () => {
    const next = {
      id: 'draft-new',
      revision: 1,
      sourceFilename: 'members.csv',
      state: {},
    };
    draftHook.draft = next;
    return next;
  });
  draftHook.save.mockClear();
  draftHook.saveAndFlush.mockReset().mockResolvedValue(true);
  draftHook.flush.mockReset().mockResolvedValue(true);
  draftHook.discard.mockReset().mockResolvedValue(true);
});

afterEach(cleanup);

describe('ImportMembersCsvDialog candidate continuity', () => {
  it('offers reload and start-fresh recovery when the saved file cannot be opened', async () => {
    const user = userEvent.setup();
    draftHook.draft = {
      id: 'draft-unavailable',
      revision: 1,
      sourceFilename: 'members.csv',
      state: {},
    };
    draftHook.saveState = 'saved';
    draftHook.load.mockResolvedValueOnce(draftHook.draft);
    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('The saved file could not be opened.')
    );
    await user.click(
      screen.getByRole('button', { name: 'Reload saved draft' })
    );
    expect(draftHook.reload).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect(
      screen.getByRole('button', { name: 'Delete draft and start fresh' })
    ).toBeTruthy();
    expect(draftHook.discard).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])(
    'reports %i successful members without claiming failed rows were imported',
    async (successful) => {
      const user = userEvent.setup();
      const onSaved = vi.fn();
      for (let index = 0; index < 2; index++) {
        supabase.rpc.mockResolvedValueOnce(
          index < successful
            ? {
                data: {
                  contact_id: `contact-${index}`,
                  membership_id: `membership-${index}`,
                  rows: [
                    {
                      source_key: `members.csv:${index + 2}`,
                      status: 'imported',
                    },
                  ],
                },
                error: null,
              }
            : { data: null, error: { message: 'Could not save this member' } }
        );
      }
      render(
        <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={onSaved} />
      );
      await user.upload(
        document.querySelector<HTMLInputElement>('input[type="file"]')!,
        new window.File(
          [
            'Name,Phone,Plan,Billing option,Start date\nAsha,+919876543210,Gold,1 month,01/08/2026\nRavi,+919876543211,Gold,1 month,01/08/2026',
          ],
          'members.csv',
          { type: 'text/csv' }
        )
      );
      await user.click(
        await screen.findByRole('button', { name: 'Map manually' })
      );
      await user.click(screen.getByRole('button', { name: 'Review 2 rows' }));
      await user.click(
        await screen.findByRole('button', { name: 'Review import' })
      );
      expect(supabase.rpc).not.toHaveBeenCalled();
      await user.click(screen.getByRole('checkbox'));
      await user.click(
        screen.getByRole('button', { name: 'Import 2 members' })
      );

      expect(
        await screen.findByRole('heading', {
          name:
            successful === 0
              ? 'No members imported'
              : `${successful} member${successful === 1 ? '' : 's'} imported`,
        })
      ).toBeTruthy();
      expect(supabase.rpc).toHaveBeenCalledTimes(2);
      expect(
        screen.getByRole('button', { name: 'Download import report' })
      ).toBeTruthy();
      expect(Boolean(screen.queryByText('Review incomplete records'))).toBe(
        successful < 2
      );
      expect(onSaved).toHaveBeenCalledTimes(successful > 0 ? 1 : 0);
    }
  );

  it('offers explicit date-order choices and preserves the selection on Back', async () => {
    const user = userEvent.setup();
    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new window.File(
        ['Name,Phone,Plan,Start date\nAsha,+919876543210,Gold,02/07/2026'],
        'members.csv',
        { type: 'text/csv' }
      )
    );
    await user.click(
      await screen.findByRole('button', { name: 'Map manually' })
    );
    expect(
      screen.getByRole('heading', { name: 'All 4 columns mapped' })
    ).toBeTruthy();

    const dateOrder = screen.getByRole('combobox', { name: 'Date order' });
    expect(dateOrder.textContent).toContain('Day / month');
    dateOrder.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(
      await screen.findByRole('option', { name: 'Month / day' })
    );
    expect(dateOrder.textContent).toContain('Month / day');
    // Choosing the current option must not toggle the date interpretation.
    dateOrder.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(
      await screen.findByRole('option', { name: 'Month / day' })
    );
    expect(dateOrder.textContent).toContain('Month / day');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Map manually' }));
    expect(
      screen.getByRole('combobox', { name: 'Date order' }).textContent
    ).toContain('Month / day');
  });

  it('allows a service-only file to reach preview without membership plans', async () => {
    const user = userEvent.setup();
    membershipPlansHook.plans = [];

    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    await user.upload(
      input!,
      new window.File(
        window.Array.of(
          'Name,Phone,Service\nAsha,+919876543210,Personal training'
        ),
        'service-members.csv',
        { type: 'text/csv' }
      )
    );

    await user.click(
      await screen.findByRole('button', { name: 'Map manually' })
    );

    expect(
      (
        screen.getByRole('button', {
          name: 'Review 1 row',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it('keeps automatically excluded repeated headers inspectable', async () => {
    const user = userEvent.setup();
    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new window.File(
        [
          'Name,Phone,Plan\nAsha,+919876543210,Gold\nName,Phone,Plan\nRavi,+919876543211,Gold',
        ],
        'members.csv',
        { type: 'text/csv' }
      )
    );
    expect(
      await screen.findByText('1 source row excluded automatically')
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Inspect excluded source rows' })
    );
    expect(screen.getByText('repeated header')).toBeTruthy();
    expect(screen.getByText('Name | Phone | Plan')).toBeTruthy();
  });

  it('clears a selected workbook when private draft initialization fails', async () => {
    const user = userEvent.setup();
    draftHook.initialize.mockResolvedValueOnce(null);

    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    await user.upload(
      input!,
      new window.File(
        window.Array.of('Name,Phone,Plan\nAsha,+919876543210,Gold'),
        'unsaved-members.csv',
        { type: 'text/csv' }
      )
    );

    expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();
    expect(screen.queryByText('unsaved-members.csv')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Match columns',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it('does not schedule another autosave when only the acknowledged revision changes', async () => {
    const user = userEvent.setup();
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      onSaved: vi.fn(),
    };
    const view = render(<ImportMembersCsvDialog {...props} />);
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    await user.upload(
      input!,
      new window.File(
        window.Array.of('Name,Phone,Plan\nAsha,+919876543210,Gold'),
        'members.csv',
        { type: 'text/csv' }
      )
    );

    draftHook.draft = {
      id: 'draft-new',
      revision: 1,
      sourceFilename: 'members.csv',
      state: {},
    };
    view.rerender(<ImportMembersCsvDialog {...props} />);
    await waitFor(() => expect(draftHook.save).toHaveBeenCalledTimes(1));

    draftHook.draft = {
      ...draftHook.draft,
      revision: 2,
    };
    view.rerender(<ImportMembersCsvDialog {...props} />);

    expect(draftHook.save).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'closes from the header only if the draft saves (saved: %s)',
    async (saved) => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      draftHook.draft = {
        id: 'draft-1',
        revision: 2,
        sourceFilename: 'members.csv',
        state: {},
      };
      draftHook.saveState = 'error';
      draftHook.flush.mockResolvedValue(saved);

      render(
        <ImportMembersCsvDialog
          open
          onOpenChange={onOpenChange}
          onSaved={vi.fn()}
        />
      );
      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]');
      await user.upload(
        input!,
        new window.File(
          window.Array.of('Name,Phone,Plan\nAsha,+919876543210,Gold'),
          'members.csv',
          { type: 'text/csv' }
        )
      );

      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(draftHook.flush).toHaveBeenCalled();
      if (saved) {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      } else {
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
        const draft = screen.getByRole('group', { name: 'Import draft' });
        expect(
          within(draft).getByRole('button', { name: 'Retry saving' })
        ).toBeTruthy();
        expect(
          within(draft).getByRole('button', { name: 'Discard draft' })
        ).toBeTruthy();
      }
    }
  );

  it('names the private workbook in Start fresh confirmation', async () => {
    const user = userEvent.setup();
    draftHook.draft = {
      id: 'draft-1',
      revision: 2,
      sourceFilename: 'August members.xlsx',
      state: {},
    };
    draftHook.saveState = 'saved';
    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: 'Start fresh' }));

    expect(screen.getByText(/August members\.xlsx/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Delete draft and start fresh' })
    ).toBeTruthy();
  });

  it('keeps the worksheet table and row inspector inside the bounded step frame', async () => {
    const user = userEvent.setup();
    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    await user.upload(
      input!,
      new window.File(
        window.Array.of(
          'Name,Phone,Plan,Billing option,Start date\nAsha,+919876543210,Legacy Platinum,Monthly,01/08/2026'
        ),
        'members.csv',
        { type: 'text/csv' }
      )
    );

    await user.click(
      await screen.findByRole('button', { name: 'Map manually' })
    );
    await user.click(screen.getByRole('button', { name: 'Review 1 row' }));

    const table = await screen.findByRole('table', { name: 'Import rows' });
    expect(table.parentElement?.className).toContain('overflow-auto');
    const inspector = screen.getByRole('region', { name: 'Row inspector' });
    expect(
      inspector.querySelector('[data-slot="scroll-area-viewport"]')
    ).toBeTruthy();

    const rowsPanel = screen.getByRole('region', { name: 'Import rows panel' });
    expect(
      within(rowsPanel).getByRole('heading', { name: 'Import members' })
    ).toBeTruthy();
    expect(
      within(rowsPanel).getByText(
        'Fix each issue or exclude its rows before continuing.'
      )
    ).toBeTruthy();
    const importDraft = screen.getByRole('group', { name: 'Import draft' });
    expect(
      within(importDraft).getByText('members.csv · 1 source rows')
    ).toBeTruthy();
    expect(
      within(rowsPanel).getByRole('button', { name: 'Back' })
    ).toBeTruthy();
    expect(inspector.contains(rowsPanel)).toBe(false);
    expect(rowsPanel.contains(inspector)).toBe(false);

    // Step 3 is a two-pane workspace: the step frame itself must not scroll,
    // or the tab strip and both panes ride one shared column scroll.
    const frameClasses = screen
      .getByRole('region', { name: 'Resolve issues content' })
      .className.split(/\s+/);
    expect(frameClasses).toContain('overflow-hidden');
    expect(frameClasses).not.toContain('overflow-y-auto');
  });

  it('keeps draft utilities throughout the wizard and preserves grouped corrections on Back', async () => {
    const user = userEvent.setup();
    const props = { open: true, onOpenChange: vi.fn(), onSaved: vi.fn() };
    const view = render(<ImportMembersCsvDialog {...props} />);
    const expectDraftUtilities = (upload = false) => {
      const draft = screen.getByRole('group', { name: 'Import draft' });
      expect(
        within(draft).getByRole('button', { name: 'Start fresh' })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', {
          name: upload ? 'File requirements & import rules' : 'Import rules',
        })
      ).toBeTruthy();
      expect(within(draft).getByText('Draft saved')).toBeTruthy();
    };
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    await user.upload(
      input!,
      new window.File(
        window.Array.of(
          'Name,Phone,Plan,Billing option,Start date\nAsha,+919876543210,Legacy Platinum,Monthly,01/08/2026'
        ),
        'members.csv',
        { type: 'text/csv' }
      )
    );

    draftHook.draft = {
      id: 'draft-new',
      revision: 1,
      sourceFilename: 'members.csv',
      state: {},
    };
    draftHook.saveState = 'saved';
    view.rerender(<ImportMembersCsvDialog {...props} />);
    expectDraftUtilities(true);
    expect(screen.queryByRole('button', { name: 'Save & close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'File requirements & import rules' })
    );
    expect(
      await screen.findByText(/Resolve every included row before confirming/)
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Download sample CSV' })
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'File requirements & import rules' })
    );

    await user.click(
      await screen.findByRole('button', { name: 'Map manually' })
    );
    expectDraftUtilities();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Review 1 row' }));

    const planSelect = await screen.findByRole('combobox', {
      name: /^Map /,
    });
    expectDraftUtilities();
    expect(screen.queryByRole('button', { name: 'Review import' })).toBeNull();
    planSelect.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(screen.getByRole('button', { name: 'Apply match' }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Review import',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );

    await user.click(screen.getByRole('button', { name: 'Review import' }));
    expect(
      screen.getByText('Review the totals, then import the included rows.')
    ).toBeTruthy();
    expectDraftUtilities();
    const submit = screen.getByRole('button', {
      name: 'Import 1 member',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    await user.click(
      screen.getByRole('button', { name: 'Source rows & invoice details' })
    );
    expect(screen.getByText('Automatically excluded')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(
      screen.queryByRole('combobox', {
        name: /^Map /,
      })
    ).toBeNull();
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expectDraftUtilities();
  });
});
