// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    account: { id: 'branch-1', name: 'Rajat Kashyap' },
    branches: [
      {
        account_id: 'branch-1',
        account_name: 'Rajat Kashyap',
        organization_name: 'UsefulDesk',
        legal_entity_legal_name: null,
        role: 'owner',
        branch_status: 'active',
      },
    ],
    switchBranch: vi.fn(),
    isOrganizationOwner: true,
  }),
}));

vi.mock('@/components/branches/branch-creation-dialog', () => ({
  BranchCreationDialog: () => null,
}));

const { BranchSwitcher } = await import('./branch-switcher');

afterEach(cleanup);

describe('BranchSwitcher trigger', () => {
  it('renders a persistent control border so the branch menu is discoverable', () => {
    render(<BranchSwitcher collapsed={false} />);

    const trigger = screen.getByRole('button', {
      name: 'Current branch: Rajat Kashyap',
    });

    expect(trigger.classList.contains('border-border')).toBe(true);
    expect(trigger.classList.contains('border-transparent')).toBe(false);
  });

  it('shows gym brand context without presenting an unset legal name as registered', async () => {
    render(<BranchSwitcher collapsed={false} />);
    screen
      .getByRole('button', { name: 'Current branch: Rajat Kashyap' })
      .focus();
    await userEvent.keyboard(' ');

    expect(screen.getByText('UsefulDesk')).toBeTruthy();
    expect(screen.getByText(/Registered business name not set/)).toBeTruthy();
  });
});
