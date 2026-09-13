// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setupState = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as { message: string } | null,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
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

beforeEach(() => {
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
    await screen.findByText('gym_membership_renewal');
    expect(
      screen.getByRole('heading', { name: 'Set up WhatsApp message' })
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
    expect(
      screen.queryByRole('button', { name: 'See setup details' })
    ).toBeNull();
    expect(screen.getByText('Used for')).toBeTruthy();
    const submit = screen.getByRole('button', {
      name: 'Send to Meta for approval',
    });
    expect(submit.closest('[data-slot="dialog-footer"]')?.className).toContain(
      'sticky'
    );
    expect(window.location.search).toBe(
      '?tab=reminders&rule=membership_renewal'
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledWith(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens an existing required template instead of creating a duplicate', async () => {
    setupState.rows = [
      {
        id: 'existing-template',
        status: 'APPROVED',
        name: 'gym_membership_renewal',
        language: 'en_US',
        category: 'Marketing',
        body_text: 'Existing template content',
        sample_values: {},
        buttons: [],
      },
    ];
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={vi.fn()}
      />
    );
    expect(
      await screen.findByRole('heading', { name: 'Edit template' })
    ).toBeTruthy();
    expect(screen.getByLabelText('Body text')).toHaveProperty(
      'value',
      'Existing template content'
    );
    expect(
      screen.getByRole('button', { name: 'Save and resubmit' })
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a pending template in place without offering another submission', async () => {
    setupState.rows = [
      {
        id: 'pending-template',
        body_text: 'Pending template content',
        category: 'Marketing',
        name: 'gym_membership_renewal',
        language: 'en_US',
        status: 'PENDING',
      },
    ];
    render(
      <TemplateManager
        setupContractId="membership_renewal"
        onSetupClose={vi.fn()}
      />
    );
    expect(
      await screen.findByText(/has already been submitted to Meta/)
    ).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Save and resubmit' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Submit for approval' })
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
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
