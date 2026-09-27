// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BranchExpansionPrompt } from './branch-expansion-prompt';

const money = (amount: number) => `₹${amount}`;
afterEach(cleanup);

describe('BranchExpansionPrompt', () => {
  it('explains that Starter needs Growth plus the add-on for a second branch', () => {
    const dismiss = vi.fn();
    render(
      <BranchExpansionPrompt
        tier="starter"
        requestedActiveBranchCount={2}
        organizationRole="owner"
        formatMoney={money}
        onDismiss={dismiss}
      />
    );
    expect(screen.getByText(/Growth with 2 branches: ₹1998/)).toBeTruthy();
    expect(
      screen.getByText(/tax treatment are still being checked/)
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /buy|pay|upgrade/i })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss branch plan information' })
    );
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('shows the paid Ultimate branch subtotal and tells staff to ask the owner', () => {
    render(
      <BranchExpansionPrompt
        tier="ultimate"
        requestedActiveBranchCount={6}
        organizationRole={null}
        formatMoney={money}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/₹4498\/month/)).toBeTruthy();
    expect(screen.getByText(/Ask the owner/)).toBeTruthy();
  });

  it('has no prompt for an included branch', () => {
    const { container } = render(
      <BranchExpansionPrompt
        tier="ultimate"
        requestedActiveBranchCount={5}
        organizationRole="owner"
        formatMoney={money}
        onDismiss={() => {}}
      />
    );
    expect(container.innerHTML).toBe('');
  });
});
