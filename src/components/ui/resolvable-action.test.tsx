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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ResolvableAction,
  type ResolvableActionOpenChangeDetails,
} from '@/components/ui/resolvable-action';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it('preserves a supplied trigger handler when onAction is absent', async () => {
    const triggerAction = vi.fn();
    render(
      <ResolvableAction
        trigger={
          <Button type="button" onClick={triggerAction}>
            Send invoice
          </Button>
        }
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));

    expect(triggerAction).toHaveBeenCalledOnce();
  });

  it('uses onAction as the single authoritative handler when both are supplied', async () => {
    const onAction = vi.fn();
    const triggerAction = vi.fn();
    render(
      <ResolvableAction
        trigger={
          <Button type="button" onClick={triggerAction}>
            Send invoice
          </Button>
        }
        onAction={onAction}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));

    expect(onAction).toHaveBeenCalledOnce();
    expect(triggerAction).not.toHaveBeenCalled();
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

  it('keeps native Button semantics without Base UI nativeButton warnings', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
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
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('role')).toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.keyboard(' ');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    expect(
      consoleError.mock.calls.some((args) =>
        args.some(
          (value) => typeof value === 'string' && value.includes('nativeButton')
        )
      )
    ).toBe(false);
  });

  it('keeps its positioned blocker narrower than a phone viewport', async () => {
    vi.stubGlobal('innerWidth', 320);
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

    await user.click(screen.getByRole('button', { name: 'Send invoice' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className.split(' ')).toContain('w-72');
    expect(dialog.parentElement?.getAttribute('role')).toBe('presentation');
  });

  it('suppresses action handlers attached to a blocked supplied trigger', async () => {
    const onAction = vi.fn();
    const triggerAction = vi.fn();
    render(
      <ResolvableAction
        trigger={
          <Button type="button" onClick={triggerAction}>
            Send invoice
          </Button>
        }
        onAction={onAction}
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
        }}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));

    expect(triggerAction).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("Invoice template isn't ready")).toBeTruthy();
  });

  it('keeps a non-Button blocked trigger visibly interactive', async () => {
    const onAction = vi.fn();
    render(
      <ResolvableAction
        trigger={
          <div role="button" tabIndex={0}>
            Send invoice
          </div>
        }
        onAction={onAction}
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
        }}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Send invoice' });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.className).toContain('[&:not(button)]:cursor-pointer');
    expect(trigger.className).toContain('focus-visible:ring-3');

    await userEvent.click(trigger);

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("Invoice template isn't ready")).toBeTruthy();
  });

  it('supports an explicitly non-native composite trigger without warnings', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    render(
      <DropdownMenu open={false}>
        <ResolvableAction
          trigger={
            <DropdownMenuTrigger
              nativeButton={false}
              render={
                <Button
                  nativeButton={false}
                  render={<div />}
                  aria-label="Invoice actions"
                />
              }
            />
          }
          blocker={{
            title: 'Admin access required',
            description: 'Ask an admin or owner to send this invoice.',
          }}
        />
        <DropdownMenuContent>
          <DropdownMenuItem>Download</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const trigger = screen.getByRole('button', { name: 'Invoice actions' });
    expect(trigger.tagName).toBe('DIV');
    await user.click(trigger);
    expect(
      screen.getByRole('dialog', { name: 'Admin access required' })
    ).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      consoleError.mock.calls.some((args) =>
        args.some(
          (value) => typeof value === 'string' && value.includes('nativeButton')
        )
      )
    ).toBe(false);
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

  it('dismisses the blocker without running the action', async () => {
    const user = userEvent.setup();
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
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('passes the outside-press reason and preserves the clicked focus target', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <>
        <ResolvableAction
          trigger={<Button type="button">Send invoice</Button>}
          blocker={{
            title: "Invoice template isn't ready",
            description: 'Approve the invoice template before sending.',
          }}
          onOpenChange={onOpenChange}
        />
        <input aria-label="Invoice caption" />
      </>
    );

    await user.click(screen.getByRole('button', { name: 'Send invoice' }));
    const caption = screen.getByRole('textbox', { name: 'Invoice caption' });
    await user.click(caption);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(caption);
    expect(onOpenChange).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ reason: 'outside-press' })
    );
  });

  it('honors cancellation before opening its uncontrolled popover', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn(
      (open: boolean, eventDetails?: ResolvableActionOpenChangeDetails) => {
        if (open) eventDetails?.cancel();
      }
    );
    render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={{
          title: "Invoice template isn't ready",
          description: 'Approve the invoice template before sending.',
        }}
        onOpenChange={onOpenChange}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Send invoice' });
    await user.click(trigger);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(onOpenChange).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ reason: 'trigger-press' })
    );
    expect(onOpenChange.mock.lastCall?.[1]?.isCanceled).toBe(true);
  });

  it('honors cancellation before closing its uncontrolled popover', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn(
      (open: boolean, eventDetails?: ResolvableActionOpenChangeDetails) => {
        if (!open) eventDetails?.cancel();
      }
    );
    render(
      <>
        <ResolvableAction
          trigger={<Button type="button">Send invoice</Button>}
          blocker={{
            title: "Invoice template isn't ready",
            description: 'Approve the invoice template before sending.',
          }}
          onOpenChange={onOpenChange}
        />
        <input aria-label="Invoice caption" />
      </>
    );

    const trigger = screen.getByRole('button', { name: 'Send invoice' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('textbox', { name: 'Invoice caption' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(onOpenChange).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ reason: 'outside-press' })
    );
    expect(onOpenChange.mock.lastCall?.[1]?.isCanceled).toBe(true);
  });

  it('clears uncontrolled open intent when a blocker is removed and later restored', async () => {
    const blocker = {
      title: "Invoice template isn't ready",
      description: 'Approve the invoice template before sending.',
    };
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={blocker}
        onOpenChange={onOpenChange}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Send invoice' });

    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();

    rerender(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={null}
        onOpenChange={onOpenChange}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Send invoice' })
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    rerender(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={blocker}
        onOpenChange={onOpenChange}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('invalidates stale controlled open intent across blocker removal', () => {
    const blocker = {
      title: "Invoice template isn't ready",
      description: 'Approve the invoice template before sending.',
    };
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={blocker}
        open
        onOpenChange={onOpenChange}
      />
    );
    expect(screen.getByRole('dialog')).toBeTruthy();

    rerender(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={null}
        open
        onOpenChange={onOpenChange}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Send invoice' })
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    rerender(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={blocker}
        open
        onOpenChange={onOpenChange}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={blocker}
        open={false}
        onOpenChange={onOpenChange}
      />
    );
    rerender(
      <ResolvableAction
        trigger={<Button type="button">Send invoice</Button>}
        blocker={blocker}
        open
        onOpenChange={onOpenChange}
      />
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
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
