// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { DEFAULT_FORMATTERS } from '@/lib/locale/format';
import { BASELINE, collectibleStudyFees, studyFollowUps } from './fixtures';
import { HomeStudy } from './study';

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ fmt: DEFAULT_FORMATTERS }),
}));
vi.mock('@/components/layout/branch-link', () => ({
  BranchLink: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ui/animated-number', () => ({
  AnimatedNumber: ({
    value,
    format,
  }: {
    value: number;
    format?: (value: number) => string;
  }) => <span>{format ? format(value) : value}</span>,
}));
if (!Element.prototype.getAnimations)
  Element.prototype.getAnimations = () => [];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('The study must not fetch real data');
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function followUpSection() {
  return screen.getByRole('region', { name: 'Follow-ups' });
}

describe('Home study', () => {
  it('keeps Upcoming reachable in the due-only, short-preview comparison', () => {
    render(
      <HomeStudy
        initialOptions={{ ...BASELINE, followUps: 'due', preview: 'short' }}
      />
    );
    const queue = within(followUpSection());
    expect(queue.getAllByRole('listitem')).toHaveLength(3);
    expect(queue.queryByText('Priya Nair')).toBeNull();
    expect(queue.getByText('3 of 6')).toBeTruthy();
    fireEvent.click(queue.getByRole('button', { name: /Upcoming/ }));
    expect(queue.getByText('Priya Nair')).toBeTruthy();
    expect(queue.getByText('3 of 4')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reaches the exact full fee list from the unchanged first-fold link', () => {
    render(<HomeStudy />);
    expect(
      screen.queryByRole('region', { name: 'Fees to collect' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /Fees to collect/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Kavita Menon')).toBeTruthy();
    expect(dialog.getByText('Aarti Deshmukh')).toBeTruthy();
    expect(dialog.getAllByRole('listitem')).toHaveLength(2);
    expect(
      dialog.getByText(/Unpaid membership fees, including older invoices/)
    ).toBeTruthy();
    fireEvent.click(
      dialog.getByRole('button', { name: 'Details for Kavita Menon' })
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', {
        name: 'Kavita Menon',
      })
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not mistake a reminder for collection or renewal', () => {
    render(
      <HomeStudy
        initialOptions={{
          ...BASELINE,
          fees: 'shown',
          actions: 'labelled',
          preview: 'short',
        }}
      />
    );
    const fees = within(
      screen.getByRole('region', { name: 'Fees to collect' })
    );
    const renewals = within(
      screen.getByRole('region', { name: 'Expiring memberships' })
    );
    const beforeFees = fees.getByText(/INV-000042/).textContent;
    const beforeExpiry = renewals.getByText(/29 Sept|29 Sep/).textContent;
    fireEvent.click(
      renewals.getByRole('button', { name: 'Send reminder for Aarti Deshmukh' })
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Send reminder',
      })
    );
    expect(screen.getByRole('status').textContent).toContain('Reminder sent');
    expect(fees.getByText(/INV-000042/).textContent).toBe(beforeFees);
    expect(renewals.getByText(/29 Sept|29 Sep/).textContent).toBe(beforeExpiry);
    fireEvent.click(
      fees.getByRole('button', { name: 'Record payment for Aarti Deshmukh' })
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Record payment',
      })
    );
    expect(fees.queryByText('Aarti Deshmukh')).toBeNull();
    expect(renewals.getByText('Aarti Deshmukh')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('completes only the chosen follow-up and updates its counts', () => {
    render(<HomeStudy initialOptions={{ ...BASELINE, actions: 'labelled' }} />);
    const queue = within(followUpSection());
    fireEvent.click(
      queue.getByRole('button', { name: 'Mark done for Rohit Shah' })
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Mark done',
      })
    );
    expect(queue.queryByText('Rohit Shah')).toBeNull();
    expect(queue.getByText('8 of 9')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps cancelled, void, and rounding-only fees out of practice totals', () => {
    expect(collectibleStudyFees(new Set()).map((row) => row.id)).toEqual([
      'kavita',
      'aarti',
    ]);
    expect(
      collectibleStudyFees(new Set(['kavita'])).map((row) => row.id)
    ).toEqual(['aarti']);
    expect(studyFollowUps('due', new Set())).toHaveLength(6);
    expect(studyFollowUps('upcoming', new Set())).toHaveLength(4);
  });
});
