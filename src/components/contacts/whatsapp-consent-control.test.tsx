// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  accountId: 'account-1' as string | null,
  accountRole: 'agent' as 'owner' | 'admin' | 'agent' | 'viewer' | null,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc }),
}));

const { WhatsAppConsentControl } = await import('./whatsapp-consent-control');

beforeEach(() => {
  auth.accountId = 'account-1';
  auth.accountRole = 'agent';
  rpc.mockReset().mockResolvedValue({ data: 'event-1', error: null });
});
afterEach(cleanup);

describe('WhatsAppConsentControl', () => {
  it('is unavailable to a viewer', () => {
    auth.accountRole = 'viewer';
    render(
      <WhatsAppConsentControl contactId="contact-1" contactName="Rahul" />
    );
    expect(
      screen.queryByRole('button', { name: 'WhatsApp permission' })
    ).toBeNull();
  });

  it('requires evidence and records Marketing separately from account updates', async () => {
    const user = userEvent.setup();
    render(
      <WhatsAppConsentControl contactId="contact-1" contactName="Rahul" />
    );

    await user.click(screen.getByRole('button', { name: 'WhatsApp permission' }));
    expect(
      screen.getByRole('heading', { name: 'Save WhatsApp permission' })
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Save: agreed to messages' })
    ).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('radio', { name: /marketing/i }));
    await user.type(
      screen.getByLabelText('How did they tell you?'),
      'Member signed the front-desk WhatsApp consent form.'
    );
    await user.click(screen.getByRole('button', { name: 'Save: agreed to messages' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('record_contact_consent', {
        p_account_id: 'account-1',
        p_contact_id: 'contact-1',
        p_purpose: 'whatsapp_marketing',
        p_action: 'opt_in',
        p_source: 'staff_recorded',
        p_evidence: {
          note: 'Member signed the front-desk WhatsApp consent form.',
        },
      })
    );
  });

  it('records a deliberate global opt-out through the same audited RPC', async () => {
    const user = userEvent.setup();
    render(
      <WhatsAppConsentControl contactId="contact-1" contactName="Rahul" />
    );
    await user.click(screen.getByRole('button', { name: 'WhatsApp permission' }));
    await user.type(
      screen.getByLabelText('How did they tell you?'),
      'Member asked staff to stop all proactive WhatsApp messages.'
    );
    await user.click(screen.getByRole('button', { name: 'Save: does not want messages' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        'record_contact_consent',
        expect.objectContaining({
          p_purpose: 'whatsapp_account_updates',
          p_action: 'opt_out',
        })
      )
    );
  });
});
