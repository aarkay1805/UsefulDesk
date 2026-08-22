// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account-1', accountRole: 'agent' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { MemberDangerZone } = await import('./member-danger-zone');

afterEach(cleanup);

describe('MemberDangerZone', () => {
  it('keeps ongoing WhatsApp consent management inside member settings', () => {
    render(
      <MemberDangerZone
        contactId="contact-1"
        memberName="Rahul"
        canDelete={false}
        onDeleted={vi.fn()}
      />
    );

    expect(screen.getByText('Settings')).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'WhatsApp consent' })
    ).toBeDefined();
  });
});
