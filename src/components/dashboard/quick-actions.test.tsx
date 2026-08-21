// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuickActions } from './quick-actions';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: '00000000-0000-4000-8000-000000000001',
  }),
}));

afterEach(cleanup);

describe('QuickActions branch navigation', () => {
  it('keeps the selected branch in every dashboard action', () => {
    render(<QuickActions />);

    const expected = {
      'Add lead':
        '/leads?action=new&branch=00000000-0000-4000-8000-000000000001',
      'Add member':
        '/members?action=new&branch=00000000-0000-4000-8000-000000000001',
      'Send broadcast':
        '/broadcasts/new?branch=00000000-0000-4000-8000-000000000001',
      'Add automation':
        '/automations/new?branch=00000000-0000-4000-8000-000000000001',
    } as const;

    for (const [name, href] of Object.entries(expected)) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(
        href
      );
    }
  });
});
