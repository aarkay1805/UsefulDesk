// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyUpiLinkButton } from './copy-upi-link-button';

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/finance',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ locale: { currency: 'INR' } }),
}));

const upi = { vpa: 'gym@upi', payeeName: 'Useful Gym' };
const clipboardWrite = vi.fn();

beforeEach(() => {
  clipboardWrite.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, {
    clipboard: { writeText: clipboardWrite },
  });
});

afterEach(cleanup);

describe('CopyUpiLinkButton blocker contract', () => {
  it('keeps the optional default behavior unchanged', async () => {
    render(<CopyUpiLinkButton upi={upi} amount={50} note="Invoice INV-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'UPI link' }));
    expect(clipboardWrite).toHaveBeenCalledOnce();
    expect(clipboardWrite.mock.calls[0]?.[0]).toContain('am=50');
  });

  it('protects copying and offers the supplied resolution while blocked', async () => {
    const onResolve = vi.fn();
    render(
      <CopyUpiLinkButton
        upi={upi}
        amount={50}
        blocker={{
          title: 'Refund review blocks collection',
          description: 'Resolve the refund review before collecting again.',
          resolution: { label: 'Resolve refund review', onResolve },
        }}
      />
    );

    const action = screen.getByRole('button', { name: 'UPI link' });
    expect(action.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(action);
    expect(clipboardWrite).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Resolve refund review' })
    );
    expect(onResolve).toHaveBeenCalledOnce();
  });
});
