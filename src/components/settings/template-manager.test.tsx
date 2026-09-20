// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTemplateContractById } from '@/lib/whatsapp/template-contracts';

const setupState = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as { message: string } | null,
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
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: setupState.rows, error: setupState.error }),
      };
      return query;
    },
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
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/settings?tab=templates');
});

describe('TemplateManager gym preset library', () => {
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
    expect(screen.queryByRole('button', { name: 'Use preset' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Message language' })
    ).toBeNull();
    expect(screen.queryByText('What members will see')).toBeNull();
    expect(screen.getByText('Approval needed')).toBeTruthy();
    expect(
      screen.getByText(/Submitting does not turn on the message/)
    ).toBeTruthy();
    expect(screen.getByText('Used for')).toBeTruthy();
    const submit = screen.getByRole('button', {
      name: 'Submit for WhatsApp approval',
    });
    expect(submit.closest('[data-slot="dialog-footer"]')?.className).toContain(
      'sticky'
    );
    expect(window.location.search).toBe(
      '?tab=reminders&rule=membership_renewal'
    );
    await user.click(screen.getByRole('button', { name: 'Technical details' }));
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
    expect(screen.getByText(/Return to Messages to continue/)).toBeTruthy();
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
    expect(
      await screen.findByText('Waiting for WhatsApp approval')
    ).toBeTruthy();
    expect(screen.getByText(/When WhatsApp finishes its review/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Save and resubmit' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Sync approval status' })
    ).toBeTruthy();
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

    expect(
      await screen.findByText('WhatsApp did not approve this message')
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Resubmit for WhatsApp approval',
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Sync approval status' })
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Technical details' }));
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

    expect(
      await screen.findByText('Approval status needs syncing')
    ).toBeTruthy();
    expect(screen.getByText(/WhatsApp changed this message/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Sync approval status' })
    ).toBeTruthy();
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
      name: 'Update and resubmit for WhatsApp approval',
    });
    expect(
      screen.queryByRole('button', { name: 'Sync approval status' })
    ).toBeNull();

    await user.click(repair);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/whatsapp/templates/membership-template',
      expect.objectContaining({ method: 'PATCH' })
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual(
      expect.objectContaining(membershipContract.payload)
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
    expect(
      screen.queryByRole('button', { name: 'Sync approval status' })
    ).toBeNull();

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
        name: 'Submit for WhatsApp approval',
      })
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/whatsapp/templates/submit',
      expect.objectContaining({ method: 'POST' })
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual(
      expect.objectContaining(membershipContract.payload)
    );
    expect(toastState.success).toHaveBeenCalledWith(
      'Submitted for WhatsApp approval. Submitting does not turn on this message.'
    );
    expect(close).toHaveBeenCalledWith(true);
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
      screen.queryByRole('button', { name: 'Submit for approval' })
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
        name: 'Use Membership renewal preset',
      })
    );
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(screen.queryByText('What members will see')).toBeNull();
    expect(
      screen.getAllByText('gym_membership_renewal').length
    ).toBeGreaterThan(0);
  });

  it('groups all twenty-three contracts and explains operational requirements', async () => {
    const user = userEvent.setup();
    render(<TemplateManager />);

    await user.click(
      await screen.findByRole('button', { name: 'Use a preset' })
    );

    for (const heading of [
      'UsefulDesk features',
      'Account updates',
      'Marketing',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    for (const title of [
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
      'Payment promise reminder',
      'Payment confirmation',
      'AutoPay retry update',
      'AutoPay payment help',
      'Payment link',
      'Invoice document',
      'Payment due',
      'Payment receipt',
      'Membership activation',
      'Win back a lapsed member',
      'Festival offer',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.queryByText(/Consent:/)).toBeNull();
    expect(
      screen.queryByText(/Requires recorded .* WhatsApp opt-in/)
    ).toBeNull();
    expect(screen.getAllByText(/Sends when:/).length).toBe(23);
    expect(
      screen.getAllByText(/approval and recipient delivery are not guaranteed/)
        .length
    ).toBeGreaterThan(0);
  });

  it('keeps invoice contract identity locked while requiring an editable document sample URL', async () => {
    const user = userEvent.setup();
    render(<TemplateManager />);
    await user.click(
      await screen.findByRole('button', { name: 'Use a preset' })
    );

    const card = screen
      .getByRole('heading', { name: 'Invoice document' })
      .closest('[data-slot="preset"]');
    expect(card).toBeTruthy();
    await user.click(
      within(card as HTMLElement).getByRole('button', { name: 'Use preset' })
    );

    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Header' })).toBeNull();
    const sample = screen.getByLabelText('Sample PDF link for Meta');
    expect(sample).toHaveProperty('disabled', false);
    expect(sample).toHaveProperty('required', true);
    expect(sample).toHaveProperty('value', '');
  });

  it('shows a simple review without editable contract fields', async () => {
    const user = userEvent.setup();
    render(<TemplateManager />);
    await user.click(
      await screen.findByRole('button', { name: 'Use a preset' })
    );

    const card = screen
      .getByRole('heading', { name: 'Membership renewal' })
      .closest('[data-slot="preset"]');
    expect(card).toBeTruthy();
    await user.click(
      within(card as HTMLElement).getByRole('button', { name: 'Use preset' })
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
    expect(screen.getByText('Used for')).toBeTruthy();
  });
});
