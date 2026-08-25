// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({
  pathname: '/invoices',
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

import { Button } from '@/components/ui/button';
import { ResolvableAction } from '@/components/ui/resolvable-action';

afterEach(cleanup);

describe('ResolvableAction', () => {
  it('runs an unblocked action normally', async () => {
    const onAction = vi.fn();
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        onAction={onAction}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the blocker without running the business action', async () => {
    const onAction = vi.fn();
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        onAction={onAction}
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
        }}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Send invoice' });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(trigger);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("Invoice template isn't ready")).toBeTruthy();
  });

  it('opens from Enter and restores focus after Escape', async () => {
    const user = userEvent.setup();
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
        }}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Send invoice' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText("Invoice template isn't ready")).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('runs a callback resolution but not the original action', async () => {
    const onAction = vi.fn();
    const onResolve = vi.fn();
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        onAction={onAction}
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
          resolution: { label: 'Open template setup', onResolve },
        }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Open template setup' })
    );
    expect(onResolve).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps a truly disabled trigger inert', async () => {
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        disabled
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
        }}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Send invoice' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(trigger);
    expect(screen.queryByText("Invoice template isn't ready")).toBeNull();
  });

  it('keeps an already-disabled trigger inert', async () => {
    render(
      <ResolvableAction
        trigger={
          <Button type="button" disabled>
            Send invoice
          </Button>
        }
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
        }}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Send invoice' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(trigger);
    expect(screen.queryByText("Invoice template isn't ready")).toBeNull();
  });

  it('keeps a link resolution pending until navigation replaces the view', async () => {
    const user = userEvent.setup();
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
          resolution: {
            label: 'Open template setup',
            href: '/settings/templates',
          },
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Send invoice' }));
    const resolution = screen.getByRole('button', {
      name: 'Open template setup',
    });
    resolution.addEventListener('click', (event) => event.preventDefault());
    await user.click(resolution);

    expect(resolution.getAttribute('aria-busy')).toBe('true');
    expect(resolution.querySelector('.animate-spin')).not.toBeNull();
  });
});
