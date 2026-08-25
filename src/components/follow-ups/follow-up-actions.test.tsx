// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/follow-ups',
  useRouter: () => ({ push: vi.fn() }),
}));

import { FollowUpButton } from './follow-up-button';
import { FollowUpCompletionControl } from './follow-up-completion-control';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FollowUpButton', () => {
  it('runs the allowed follow-up action', async () => {
    const onClick = vi.fn();
    render(<FollowUpButton onClick={onClick} />);

    await userEvent.click(screen.getByRole('button', { name: 'Follow up' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps a permission-blocked action focusable and explains the resolution', async () => {
    const onClick = vi.fn();
    render(
      <FollowUpButton
        canAct={false}
        gateReason="create follow-ups"
        onClick={onClick}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Follow up' });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await userEvent.click(trigger);

    expect(onClick).not.toHaveBeenCalled();
    const blocker = screen.getByRole('dialog', {
      name: 'Admin access required',
    });
    expect(
      within(blocker).getByText('Ask an admin or owner to create follow-ups.')
    ).toBeTruthy();
    expect(within(blocker).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('FollowUpCompletionControl', () => {
  it('runs the allowed completion action for an open follow-up', async () => {
    const onMarkDone = vi.fn();
    render(<FollowUpCompletionControl status="open" onMarkDone={onMarkDone} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Complete follow-up' })
    );

    expect(onMarkDone).toHaveBeenCalledOnce();
  });

  it('keeps a permission-blocked completion focusable and explains the resolution', async () => {
    const onMarkDone = vi.fn();
    render(
      <FollowUpCompletionControl
        status="open"
        canAct={false}
        gateReason="close assigned follow-ups"
        onMarkDone={onMarkDone}
      />
    );

    const trigger = screen.getByRole('button', {
      name: 'Complete follow-up',
    });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await userEvent.click(trigger);

    expect(onMarkDone).not.toHaveBeenCalled();
    const blocker = screen.getByRole('dialog', {
      name: 'Admin access required',
    });
    expect(
      within(blocker).getByText(
        'Ask an admin or owner to close assigned follow-ups.'
      )
    ).toBeTruthy();
    expect(within(blocker).queryAllByRole('button')).toHaveLength(0);
  });

  it('uses the canonical completion reason when a blocked caller omits one', async () => {
    render(
      <FollowUpCompletionControl
        status="open"
        canAct={false}
        onMarkDone={vi.fn()}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Complete follow-up' })
    );

    expect(
      within(screen.getByRole('dialog')).getByText(
        'Ask an admin or owner to complete follow-ups.'
      )
    ).toBeTruthy();
  });

  it('keeps completed and cancelled follow-ups terminal', () => {
    const { rerender } = render(
      <FollowUpCompletionControl status="done" onMarkDone={vi.fn()} />
    );

    expect(screen.getByTitle('Completed')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <FollowUpCompletionControl status="cancelled" onMarkDone={vi.fn()} />
    );

    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
