// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

const draftHook = vi.hoisted(() => ({
  draft: null as null | {
    id: string;
    revision: number;
    sourceFilename: string;
    state: Record<string, unknown>;
  },
  saveState: 'idle' as
    'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'conflict',
  lastAcknowledgedRevision: null as number | null,
  adopt: vi.fn(),
  load: vi.fn(async () => null),
  reload: vi.fn(async () => null),
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
  from: vi.fn((table: string) => ({
    select: () => ({
      eq: () =>
        table === 'custom_fields'
          ? { order: async () => emptyResult }
          : Promise.resolve(emptyResult),
    }),
  })),
};

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabase }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

const { ImportMembersCsvDialog } = await import('./import-members-csv-dialog');

beforeAll(() => {
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
  membershipPlansHook.plans = [plan];
  membershipPlansHook.loading = false;
  draftHook.draft = null;
  draftHook.saveState = 'idle';
  draftHook.lastAcknowledgedRevision = null;
  draftHook.load.mockClear();
  draftHook.reload.mockClear();
  draftHook.initialize.mockReset().mockResolvedValue({
    id: 'draft-new',
    revision: 1,
    sourceFilename: 'members.csv',
    state: {},
  });
  draftHook.save.mockClear();
  draftHook.flush.mockReset().mockResolvedValue(true);
  draftHook.discard.mockReset().mockResolvedValue(true);
});

afterEach(cleanup);

describe('ImportMembersCsvDialog candidate continuity', () => {
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
          name: 'Preview 1 row',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
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

    expect(
      screen.getByText('Click to choose a CSV or Excel file')
    ).toBeTruthy();
    expect(screen.queryByText('unsaved-members.csv')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Analyze file',
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

  it('keeps the dialog open when Save & close cannot flush', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    draftHook.draft = {
      id: 'draft-1',
      revision: 2,
      sourceFilename: 'members.csv',
      state: {},
    };
    draftHook.saveState = 'error';
    draftHook.flush.mockResolvedValue(false);

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

    await user.click(screen.getByRole('button', { name: 'Save & close' }));

    expect(draftHook.flush).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

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

    expect(screen.getAllByText(/August members\.xlsx/)).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Delete draft and start fresh' })
    ).toBeTruthy();
  });

  it('gives the queue rail and the focused issue their own scrollports', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Preview 1 row' }));

    // The queue rail only exists once the step-3 panel has swapped in.
    const queue = await screen.findByRole('navigation', {
      name: 'Issue queue',
    });
    expect(queue.className.split(/\s+/)).toContain('overflow-y-auto');

    const focused = screen.getByRole('region', { name: 'Focused issue' });
    expect(focused.parentElement?.className.split(/\s+/)).toContain(
      'overflow-y-auto'
    );

    // Step 3 is a two-pane workspace: the step frame itself must not scroll,
    // or the tab strip and both panes ride one shared column scroll.
    const frameClasses = screen
      .getByRole('region', { name: 'Resolve issues content' })
      .className.split(/\s+/);
    expect(frameClasses).toContain('overflow-hidden');
    expect(frameClasses).not.toContain('overflow-y-auto');
  });

  it('keeps a grouped resolution when navigating from Confirm back to Resolve issues', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Preview 1 row' }));

    const planSelect = await screen.findByRole('combobox', {
      name: /^Map /,
    });
    planSelect.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Next: Confirm',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );

    await user.click(screen.getByRole('button', { name: 'Next: Confirm' }));
    expect(
      screen.getByText('Review the exact source equation and confirm.')
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(
      screen.queryByRole('combobox', {
        name: /^Map /,
      })
    ).toBeNull();
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
  });
});
