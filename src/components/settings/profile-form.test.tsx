// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-id' },
    profile: {
      full_name: 'Rajat',
      email: 'rajat@example.com',
      avatar_url: null,
    },
    profileLoading: false,
    refreshProfile: vi.fn(),
  }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

const { ProfileForm } = await import('./profile-form');

afterEach(cleanup);

describe('ProfileForm', () => {
  it('keeps cosmetic profile editing to photo and display name', () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText('Display name')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(
      screen.getByText(
        'Update the photo and display name people see in UsefulDesk.'
      )
    ).toBeTruthy();
  });
});
