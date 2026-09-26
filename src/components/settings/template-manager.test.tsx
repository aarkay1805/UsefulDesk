// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTemplateContractById } from '@/lib/whatsapp/template-contracts';

const setupState = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as { message: string } | null,
  legalName: 'Rajat Fitness Private Limited' as string | null,
}));
const toastState = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
const navigationState = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('sonner', () => ({
  toast: toastState,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigationState,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-1',
    canEditSettings: true,
    loading: false,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: setupState.rows, error: setupState.error }),
        maybeSingle: async () => ({
          data:
            table === 'accounts'
              ? {
                  legal_entity: {
                    legal_name: null,
                    name: null,
                  },
                }
              : null,
          error: null,
        }),
      };
      return query;
    },
    rpc: async (name: string) => ({
      data:
        name === 'my_branch_accounts'
          ? [
              {
                account_id: 'account-1',
                legal_entity_name: setupState.legalName,
              },
            ]
          : null,
      error: null,
    }),
  }),
}));

vi.mock('@/lib/storage/upload-media', () => ({
  MEDIA_MAX_BYTES_BY_KIND: { image: 5_000_000 },
  uploadAccountMedia: vi.fn(),
}));

const { TemplateManager } = await import('./template-manager');

const membershipContract = getTemplateContractById('membership_renewal')!;

function membershipTemplate(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'membership-template',
    user_id: 'user-1',
    created_at: '2026-09-20T00:00:00.000Z',
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    provider_components_sync_required_at: null,
    provider_missing_since: null,
    ...membershipContract.payload,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setupState.rows = [];
  setupState.error = null;
  setupState.legalName = 'Rajat Fitness Private Limited';
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/settings?tab=templates');
});

describe('TemplateManager gym preset library', () => {
  it('never renders the legal-name field label as customer message text', async () => {
    setupState.legalName = null;
    render(<TemplateManager />);

    expect(
      await screen.findAllByText(
        'Preview unavailable until the legal business name can be loaded.'
      )
    ).toHaveLength(22);
    expect(screen.queryByText(/Reply to Legal business name/)).toBeNull();
  });

  it('shows the selected legal name even when an approved template stores an old sample', async () => {
    setupState.rows = [membershipTemplate()];
    render(<TemplateManager />);

    const heading = await screen.findByRole('heading', {
      name: 'Membership renewal',
    });
    const card = heading.closest('[data-slot="preset"]') as HTMLElement;
    await waitFor(() => {
      expect(card.textContent).toContain('Rajat Fitness Private Limited');
    });
    expect(card.textContent).not.toContain('FitZone Wellness Private Limited');
  });

  it('submits all required templates once, syncs, and shows the aggregate with individual failures', async () => {
    const user = userEvent.setup();
    let resolveSubmission!: (value: Response) => void;
    const submission = new Promise<Response>((resolve) => {
      resolveSubmission = resolve;
    });
    vi.mocked(fetch)
      .mockReturnValueOnce(submission)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 19,
          inserted: 0,
          updated: 2,
          errors: [],
          truncated: false,
          newly_missing: 0,
        }),
      } as Response);

    render(<TemplateManager />);

    expect(
      await screen.findByText(
        'Choose WhatsApp messages and check if they are ready to use.'
      )
    ).toBeTruthy();
    const moreActions = screen.getByRole('button', {
      name: 'More template actions',
    });
    expect(
      screen.queryByRole('menuitem', {
        name: 'Send needed messages for review',
      })
    ).toBeNull();
    moreActions.focus();
    await user.keyboard(' ');
    const submitAll = screen.getByRole('menuitem', {
      name: 'Send needed messages for review',
    });
    expect(
      screen.getByRole('menuitem', { name: 'Update from WhatsApp' })
    ).toBeTruthy();

    await user.click(submitAll);

    expect(moreActions.getAttribute('aria-busy')).toBe('true');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/whatsapp/templates/submit-required',
      { method: 'POST' }
    );

    resolveSubmission({
      ok: true,
      json: async () => ({
        success: true,
        total: 19,
        submitted: 2,
        already_ready_or_pending: 16,
        failed: 1,
        results: [
          {
            contract_id: 'invoice_overdue',
            name: 'gym_invoice_overdue',
            outcome: 'failed',
            error: 'Meta rejected copy',
          },
        ],
      }),
    } as Response);

    expect(
      await screen.findByText(
        'Sent 2 · Ready or waiting 16 · Failed 1 · Total 19'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('gym_invoice_overdue — Meta rejected copy')
    ).toBeTruthy();
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/whatsapp/templates/sync', {
      method: 'POST',
    });
    expect(moreActions.getAttribute('aria-busy')).toBeNull();
  });

  it('keeps Meta sync available from the overflow menu', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 0,
        inserted: 0,
        updated: 0,
        errors: [],
        truncated: false,
        newly_missing: 0,
      }),
    } as Response);

    render(<TemplateManager />);
    const moreActions = await screen.findByRole('button', {
      name: 'More template actions',
    });
    moreActions.focus();
    await user.keyboard(' ');
    await user.click(
      screen.getByRole('menuitem', { name: 'Update from WhatsApp' })
    );

    expect(fetch).toHaveBeenCalledWith('/api/whatsapp/templates/sync', {
      method: 'POST',
    });
    expect(toastState.success).toHaveBeenCalledWith(
      'Checked 0 messages on WhatsApp'
    );
  });

  it('opens the required new-template modal directly without a gallery or provider call', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings?tab=reminders&rule=membership_renewal'
    );
    const close = vi.fn();
    const user = userEvent.setup();
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={close}
      />
    );
    expect(
      await screen.findByRole('heading', { name: 'Set up message' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Message templates' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Use this message' })
    ).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Message language' })
    ).toBeNull();
    expect(screen.queryByText('What members will see')).toBeNull();
    expect(screen.getByText('Needs WhatsApp review')).toBeTruthy();
    expect(screen.getByText(/will not turn on by itself/)).toBeTruthy();
    expect(screen.getByText('What it does')).toBeTruthy();
    // Sending for review reads as step one of three, not the finish line.
    const steps = within(
      screen.getByRole('list', { name: 'How a message gets approved' })
    ).getAllByRole('listitem');
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([
      'step',
      null,
      null,
    ]);
    const submit = screen.getByRole('button', {
      name: 'Send for review',
    });
    expect(submit.closest('[data-slot="dialog-footer"]')?.className).toContain(
      'sticky'
    );
    expect(window.location.search).toBe(
      '?tab=reminders&rule=membership_renewal'
    );
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('gym_membership_renewal')).toBeTruthy();
    expect(screen.getByText('Category')).toBeTruthy();
    expect(screen.getByText('No header')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledWith(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows an approved and synced message as ready without submitting or activating it', async () => {
    setupState.rows = [membershipTemplate()];
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={vi.fn()}
      />
    );
    expect(await screen.findByText('Approved for WhatsApp')).toBeTruthy();
    expect(screen.getByText(/Go back to Messages/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Return to Messages' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a pending template in place without offering another submission', async () => {
    setupState.rows = [membershipTemplate({ status: 'PENDING' })];
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={vi.fn()}
      />
    );
    expect(await screen.findByText('Waiting for WhatsApp review')).toBeTruthy();
    expect(
      screen.getByText(/Check its status after WhatsApp reviews it/)
    ).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Save and resubmit' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Check status' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /submit.*approval/i })
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('offers one explicit resubmission action after WhatsApp rejects the message', async () => {
    const user = userEvent.setup();
    setupState.rows = [
      membershipTemplate({
        status: 'REJECTED',
        rejection_reason: 'The message needs another review.',
      }),
    ];
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={vi.fn()}
      />
    );

    expect(await screen.findByText('WhatsApp did not approve it')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Send for review again',
      })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('The message needs another review.')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a sync when an approved message has provider changes', async () => {
    setupState.rows = [
      membershipTemplate({
        provider_components_sync_required_at: '2026-09-20T01:00:00.000Z',
      }),
    ];
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={vi.fn()}
      />
    );

    expect(await screen.findByText('Check WhatsApp status')).toBeTruthy();
    expect(screen.getByText(/WhatsApp changed this message/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check status' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /submit.*approval/i })
    ).toBeNull();
  });

  it('repairs an approved message whose exact contract copy has drifted', async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    setupState.rows = [
      membershipTemplate({
        body_text:
          'Hi {{1}}, your {{2}} membership ends on {{3}}. Reply to renew.',
      }),
    ];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, dry_run: false }),
    } as Response);
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={close}
      />
    );

    expect(await screen.findByText('Message needs updating')).toBeTruthy();
    const repair = screen.getByRole('button', {
      name: 'Update and send for review',
    });
    expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull();

    await user.click(repair);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/whatsapp/templates/membership-template',
      expect.objectContaining({ method: 'PATCH' })
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body)).sample_values.body.at(-1)).toBe(
      'Rajat Fitness Private Limited'
    );
    expect(close).toHaveBeenCalledWith(true);
  });

  it('routes an approved category mismatch to Templates instead of looping sync', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings?tab=reminders&rule=membership_renewal'
    );
    const close = vi.fn();
    const user = userEvent.setup();
    setupState.rows = [membershipTemplate({ category: 'Utility' })];
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={close}
      />
    );

    expect(
      await screen.findByText('Message category needs replacing')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open Templates' }));

    expect(navigationState.replace).toHaveBeenCalledWith(
      '/settings?tab=templates&contract=membership_renewal&rule=membership_renewal'
    );
    expect(close).toHaveBeenCalledWith(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('submits only the approval request and leaves activation to Messages', async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, dry_run: false }),
    } as Response);
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={close}
      />
    );

    await user.click(
      await screen.findByRole('button', {
        name: 'Send for review',
      })
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/whatsapp/templates/submit',
      expect.objectContaining({ method: 'POST' })
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body)).sample_values.body.at(-1)).toBe(
      'Rajat Fitness Private Limited'
    );
    expect(toastState.success).toHaveBeenCalledWith(
      'Sent for WhatsApp review. This does not turn the message on.'
    );
    expect(close).toHaveBeenCalledWith(true);
  });

  it('shows a boundary error for custom copy before making a submission request', async () => {
    const user = userEvent.setup();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TemplateManager />);
    await user.click(
      await screen.findByRole('button', { name: 'New template' })
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Template name' }),
      'custom_due'
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Message text' }),
      'Invoice due: {{{{1}}}}.'
    );
    await user.type(
      screen.getByRole('textbox', {
        name: 'Example for {{1}}',
      }),
      'INV-1024'
    );
    await user.click(screen.getByRole('button', { name: 'Send for review' }));

    expect(fetch).not.toHaveBeenCalled();
    expect(toastState.error).toHaveBeenCalledWith(
      expect.stringContaining('Add meaningful fixed words')
    );
    errorLog.mockRestore();
  });

  it('does not offer a duplicate creation form when the template lookup fails', async () => {
    setupState.error = { message: 'Template lookup failed' };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={vi.fn()}
      />
    );
    expect(await screen.findByText('Template lookup failed')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Send for review' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('opens the exact locked feature preset from an automated-message focus', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings?tab=templates&rule=membership_renewal&contract=membership_renewal'
    );
    const user = userEvent.setup();
    render(<TemplateManager />);
    await user.click(
      await screen.findByRole('button', {
        name: 'Set up Membership renewal',
      })
    );
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(screen.queryByText('What members will see')).toBeNull();
    expect(
      screen.getAllByText('gym_membership_renewal').length
    ).toBeGreaterThan(0);
  });

  it('groups all twenty-two contracts and explains operational requirements', async () => {
    render(<TemplateManager />);
    await screen.findByRole('heading', { name: 'UsefulDesk features' });

    for (const heading of ['UsefulDesk features', 'Marketing']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    for (const title of [
      'Missed gym visits',
      'Membership renewal',
      'Service renewal',
      'Expired membership follow-up',
      'Expired service follow-up',
      'Low session pack balance',
      'Session pack used',
      'Planned membership return',
      'Membership win-back',
      'Service win-back',
      'Installment reminder',
      'Invoice due reminder',
      'Overdue invoice reminder',
      'Upcoming promised payment',
      'Missed promised payment',
      'Payment confirmation',
      'Payment and membership renewal confirmation',
      'AutoPay retry update',
      'AutoPay payment help',
      'Payment link',
      'Invoice document',
      'Festival offer',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.queryByText(/Consent:/)).toBeNull();
    expect(
      screen.queryByText(/Requires recorded .* WhatsApp opt-in/)
    ).toBeNull();
    expect(screen.getAllByText(/Used when:/).length).toBe(22);
    expect(
      screen.getByRole('group', {
        name: 'Filter message templates by approval status',
      })
    ).toBeTruthy();
  });

  it('shows linked Meta wording once and filters approved and pending cards', async () => {
    const user = userEvent.setup();
    const serviceContract = getTemplateContractById('service_renewal')!;
    setupState.rows = [
      membershipTemplate({ body_text: 'Approved wording from Meta.' }),
      membershipTemplate({
        id: 'service-template',
        ...serviceContract.payload,
        status: 'PENDING',
        body_text: 'Pending wording from Meta.',
      }),
      membershipTemplate({
        id: 'custom-template',
        name: 'custom_welcome',
        body_text: 'Welcome to our gym.',
      }),
    ];

    render(<TemplateManager />);
    const membership = await screen.findByRole('heading', {
      name: 'Membership renewal',
    });
    const membershipCard = membership.closest('[data-slot="preset"]');
    expect(membershipCard).toBeTruthy();
    expect(
      within(membershipCard as HTMLElement).getByText(
        'Approved wording from Meta.'
      )
    ).toBeTruthy();
    expect(
      screen.getAllByRole('heading', { name: 'Membership renewal' })
    ).toHaveLength(1);

    const filters = screen.getByRole('group', {
      name: 'Filter message templates by approval status',
    });
    await user.click(within(filters).getByText('In review'));
    expect(
      screen.getByRole('heading', { name: 'Service renewal' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Membership renewal' })
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'custom_welcome' })
    ).toBeNull();

    await user.click(within(filters).getByText('Approved'));
    expect(
      screen.getByRole('heading', { name: 'Membership renewal' })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'custom_welcome' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Service renewal' })
    ).toBeNull();
  });

  it('keeps retired provider messages reachable without repeating them in Other templates', async () => {
    const user = userEvent.setup();
    setupState.rows = [
      membershipTemplate(),
      membershipTemplate({
        id: 'old-renewal',
        name: 'gym_renewal_reminder',
        body_text: 'Older renewal message.',
      }),
      membershipTemplate({
        id: 'old-payment',
        name: 'gym_payment_due',
        body_text: 'Older payment message.',
      }),
      membershipTemplate({
        id: 'custom-template',
        name: 'custom_welcome',
        body_text: 'Welcome to our gym.',
      }),
    ];

    render(<TemplateManager />);
    await screen.findByRole('heading', { name: 'Other templates' });
    expect(
      screen.getByRole('heading', { name: 'custom_welcome' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'gym_renewal_reminder' })
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'gym_payment_due' })
    ).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Older templates (2)' })
    );
    expect(
      screen.getByText('These older messages are no longer used by UsefulDesk.')
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'gym_renewal_reminder' })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'gym_payment_due' })
    ).toBeTruthy();
  });

  it('keeps invoice contract identity locked while requiring an editable document sample URL', async () => {
    const user = userEvent.setup();
    render(<TemplateManager />);
    await screen.findByRole('heading', { name: 'Invoice document' });

    const card = screen
      .getByRole('heading', { name: 'Invoice document' })
      .closest('[data-slot="preset"]');
    expect(card).toBeTruthy();
    await user.click(
      within(card as HTMLElement).getByRole('button', {
        name: 'Use this message',
      })
    );

    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Header' })).toBeNull();
    const sample = screen.getByLabelText('PDF link for review');
    expect(sample).toHaveProperty('disabled', false);
    expect(sample).toHaveProperty('required', true);
    expect(sample).toHaveProperty('value', '');
  });

  it('shows a simple review without editable contract fields', async () => {
    const user = userEvent.setup();
    render(<TemplateManager />);
    await screen.findByRole('heading', { name: 'Membership renewal' });

    const card = screen
      .getByRole('heading', { name: 'Membership renewal' })
      .closest('[data-slot="preset"]');
    expect(card).toBeTruthy();
    await user.click(
      within(card as HTMLElement).getByRole('button', {
        name: 'Use this message',
      })
    );

    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Body text' })).toBeNull();
    expect(
      screen.queryByRole('textbox', { name: 'Footer (optional)' })
    ).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Message language' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'See setup details' })
    ).toBeNull();
    expect(screen.getByText('gym_membership_renewal')).toBeTruthy();
    expect(screen.getByText('What it does')).toBeTruthy();
  });
});
