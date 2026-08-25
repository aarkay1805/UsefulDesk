// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/members',
  useRouter: () => ({ push: vi.fn() }),
}));

import { MembershipActionsMenu } from './membership-actions-menu';

afterEach(cleanup);

function renderMenu(
  overrides: Partial<React.ComponentProps<typeof MembershipActionsMenu>> = {}
) {
  const actions = {
    onRenew: vi.fn(),
    onChangePlan: vi.fn(),
    onEdit: vi.fn(),
    onFreeze: vi.fn(),
    onResume: vi.fn(),
    onCancel: vi.fn(),
    onReactivate: vi.fn(),
    onOpenBilling: vi.fn(),
  };

  render(
    <MembershipActionsMenu
      status="active"
      isTrial={false}
      canManage
      lifecycleBlockReason={null}
      busy={false}
      {...actions}
      {...overrides}
    />
  );

  return actions;
}

async function openMenu() {
  await userEvent.click(
    screen.getByRole('button', { name: 'Membership actions' })
  );
}

describe('MembershipActionsMenu', () => {
  it.each([
    {
      label: 'active paid membership',
      status: 'active' as const,
      isTrial: false,
      items: [
        'Renew membership',
        'Change plan',
        'Edit membership',
        'Freeze membership',
        'Cancel membership',
      ],
    },
    {
      label: 'active trial',
      status: 'active' as const,
      isTrial: true,
      items: ['Edit membership', 'Freeze membership', 'Cancel membership'],
    },
    {
      label: 'frozen membership',
      status: 'frozen' as const,
      isTrial: false,
      items: ['Edit membership', 'Resume membership', 'Cancel membership'],
    },
    {
      label: 'cancelled membership',
      status: 'cancelled' as const,
      isTrial: false,
      items: ['Edit membership', 'Reactivate membership'],
    },
    {
      label: 'expired membership',
      status: 'expired' as const,
      isTrial: false,
      items: ['Edit membership', 'Cancel membership'],
    },
  ])(
    'preserves the action order for $label',
    async ({ status, isTrial, items }) => {
      renderMenu({ status, isTrial });

      await openMenu();

      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())
      ).toEqual(items);
    }
  );

  it('runs an allowed lifecycle callback through the existing menu semantics', async () => {
    const actions = renderMenu();

    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Freeze membership' })
    );

    expect(actions.onFreeze).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps a mandate-blocked action selectable and anchors its resolution to the persistent trigger', async () => {
    const actions = renderMenu({
      lifecycleBlockReason:
        "Resolve this member's AutoPay mandate before changing this membership.",
    });

    await openMenu();
    const renew = screen.getByRole('menuitem', { name: 'Renew membership' });
    expect(renew.getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(renew);

    expect(actions.onRenew).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Membership actions' });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('AutoPay must be resolved first')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open billing' }));
    expect(actions.onOpenBilling).toHaveBeenCalledOnce();
  });

  it('does not run a protected lifecycle callback while AutoPay is blocking it', async () => {
    const actions = renderMenu({
      lifecycleBlockReason:
        "Resolve this member's AutoPay mandate before changing this membership.",
    });

    await openMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Freeze membership' })
    );

    expect(actions.onFreeze).not.toHaveBeenCalled();
    expect(screen.getByText('AutoPay must be resolved first')).toBeTruthy();
  });

  it('prioritizes permission, omits an escalation CTA, and never runs the selected action', async () => {
    const actions = renderMenu({
      canManage: false,
      lifecycleBlockReason:
        "Resolve this member's AutoPay mandate before changing this membership.",
    });

    await openMenu();
    const cancel = screen.getByRole('menuitem', {
      name: 'Cancel membership',
    });
    expect(cancel.getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(cancel);

    expect(actions.onCancel).not.toHaveBeenCalled();
    expect(screen.getByText('Admin access required')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open billing' })).toBeNull();
  });

  it('keeps busy lifecycle items genuinely disabled without disabling unrelated menu actions', async () => {
    const actions = renderMenu({ busy: true });

    await openMenu();
    const freeze = screen.getByRole('menuitem', {
      name: 'Freeze membership',
    });
    expect(freeze.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(freeze);
    expect(actions.onFreeze).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Renew membership' })
    );
    expect(actions.onRenew).toHaveBeenCalledOnce();
  });
});
