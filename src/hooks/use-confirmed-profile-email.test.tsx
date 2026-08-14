// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConfirmedProfileEmail } from './use-confirmed-profile-email';

const select = vi.hoisted(() => vi.fn());
const eq = vi.hoisted(() => vi.fn(() => ({ select })));
const update = vi.hoisted(() => vi.fn(() => ({ eq })));
const from = vi.hoisted(() => vi.fn(() => ({ update })));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from }),
}));

function Harness({
  authEmail,
  profileEmail,
  onSynced,
}: {
  authEmail: string;
  profileEmail: string;
  onSynced: () => Promise<void>;
}) {
  useConfirmedProfileEmail({
    userId: 'user-id',
    authEmail,
    profileEmail,
    onSynced,
  });
  return null;
}

beforeEach(() => {
  select
    .mockReset()
    .mockResolvedValue({ data: [{ id: 'profile-id' }], error: null });
  eq.mockClear();
  update.mockClear();
  from.mockClear();
});
afterEach(cleanup);

describe('useConfirmedProfileEmail', () => {
  it('copies only the already-confirmed Auth email into the profile', async () => {
    const onSynced = vi.fn(async () => {});
    render(
      <Harness
        authEmail="new@example.com"
        profileEmail="old@example.com"
        onSynced={onSynced}
      />
    );

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ email: 'new@example.com' })
    );
    expect(eq).toHaveBeenCalledWith('user_id', 'user-id');
    expect(select).toHaveBeenCalledWith('id');
    expect(onSynced).toHaveBeenCalledOnce();
  });

  it('does nothing while Auth and profile emails already match', () => {
    render(
      <Harness
        authEmail="same@example.com"
        profileEmail="same@example.com"
        onSynced={vi.fn(async () => {})}
      />
    );

    expect(update).not.toHaveBeenCalled();
  });
});
