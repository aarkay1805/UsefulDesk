// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
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

const BUSINESS_CALLBACKS = [
  'onRenew',
  'onChangePlan',
  'onEdit',
  'onFreeze',
  'onResume',
  'onCancel',
  'onReactivate',
] as const;

const ACTION_CASES: Array<{
  item: string;
  status: React.ComponentProps<typeof MembershipActionsMenu>['status'];
  isTrial: boolean;
  callback: (typeof BUSINESS_CALLBACKS)[number];
}> = [
  {
    item: 'Renew membership',
    status: 'active',
    isTrial: false,
    callback: 'onRenew',
  },
  {
    item: 'Change plan',
    status: 'active',
    isTrial: false,
    callback: 'onChangePlan',
  },
  {
    item: 'Edit membership',
    status: 'active',
    isTrial: false,
    callback: 'onEdit',
  },
  {
    item: 'Freeze membership',
    status: 'active',
    isTrial: false,
    callback: 'onFreeze',
  },
  {
    item: 'Resume membership',
    status: 'frozen',
    isTrial: false,
    callback: 'onResume',
  },
  {
    item: 'Cancel membership',
    status: 'active',
    isTrial: false,
    callback: 'onCancel',
  },
  {
    item: 'Reactivate membership',
    status: 'cancelled',
    isTrial: false,
    callback: 'onReactivate',
  },
];

function expectNoBusinessCallbacks(actions: ReturnType<typeof renderMenu>) {
  for (const callback of BUSINESS_CALLBACKS) {
    expect(actions[callback]).not.toHaveBeenCalled();
  }
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

  it.each(ACTION_CASES)(
    'routes $item only to $callback when allowed',
    async ({ item, status, isTrial, callback }) => {
      const actions = renderMenu({ status, isTrial });

      await openMenu();
      await userEvent.click(screen.getByRole('menuitem', { name: item }));

      expect(actions[callback]).toHaveBeenCalledOnce();
      for (const otherCallback of BUSINESS_CALLBACKS) {
        if (otherCallback !== callback) {
          expect(actions[otherCallback]).not.toHaveBeenCalled();
        }
      }
      expect(actions.onOpenBilling).not.toHaveBeenCalled();
    }
  );

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

  it.each(ACTION_CASES)(
    'keeps $item selectable and resolves only through Billing when AutoPay blocks it',
    async ({ item, status, isTrial }) => {
      const actions = renderMenu({
        status,
        isTrial,
        lifecycleBlockReason:
          "Resolve this member's AutoPay mandate before changing this membership.",
      });

      await openMenu();
      const menuItem = screen.getByRole('menuitem', { name: item });
      expect(menuItem.getAttribute('aria-disabled')).toBeNull();
      await userEvent.click(menuItem);

      expectNoBusinessCallbacks(actions);
      expect(screen.getByText('AutoPay must be resolved first')).toBeTruthy();
      const dialog = screen.getByRole('dialog');
      expect(
        within(dialog)
          .getAllByRole('button')
          .map((button) => button.textContent?.trim())
      ).toEqual(['Open billing']);

      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Open billing' })
      );
      expect(actions.onOpenBilling).toHaveBeenCalledOnce();
      expectNoBusinessCallbacks(actions);
    }
  );

  it.each(ACTION_CASES)(
    'keeps $item selectable with no resolution when permission blocks it',
    async ({ item, status, isTrial }) => {
      const actions = renderMenu({
        status,
        isTrial,
        canManage: false,
        lifecycleBlockReason:
          "Resolve this member's AutoPay mandate before changing this membership.",
      });

      await openMenu();
      const menuItem = screen.getByRole('menuitem', { name: item });
      expect(menuItem.getAttribute('aria-disabled')).toBeNull();
      await userEvent.click(menuItem);

      expectNoBusinessCallbacks(actions);
      expect(actions.onOpenBilling).not.toHaveBeenCalled();
      expect(screen.getByText('Admin access required')).toBeTruthy();
      expect(
        within(screen.getByRole('dialog')).queryAllByRole('button')
      ).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Open billing' })).toBeNull();
    }
  );

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
