// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ invite: INVITE_TOKEN }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword: vi.fn() },
  }),
}));

const { default: LoginPage } = await import('./page');

afterEach(cleanup);

describe('invitation login continuation', () => {
  it('carries the invitation into forgot-password recovery', () => {
    render(<LoginPage />);

    expect(
      screen
        .getByRole('link', { name: 'Forgot password?' })
        .getAttribute('href')
    ).toBe(`/forgot-password?invite=${INVITE_TOKEN}`);
  });
});
