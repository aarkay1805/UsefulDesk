// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
        order: async () => ({ data: [], error: null }),
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

afterEach(cleanup);

describe('TemplateManager gym preset library', () => {
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

    expect(screen.getByLabelText('Template name')).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByLabelText('Header')).toHaveProperty('disabled', true);
    const sample = screen.getByLabelText('Public document URL');
    expect(sample).toHaveProperty('disabled', false);
    expect(sample).toHaveProperty('required', true);
    expect(sample).toHaveProperty('value', '');
  });

  it('locks a feature contract while leaving language editable', async () => {
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

    expect(
      screen.getByLabelText('Template name').hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByLabelText('Body text').hasAttribute('disabled')).toBe(
      true
    );
    expect(
      screen.getByLabelText('Footer (optional)').hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByLabelText('Language').hasAttribute('disabled')).toBe(
      false
    );
    expect(
      screen.getByText(/UsefulDesk feature contract is locked/)
    ).toBeTruthy();
  });
});
