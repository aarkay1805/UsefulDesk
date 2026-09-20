// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  LifecycleSendingHoursSettings,
  type LifecycleSendingHoursDraft,
} from './lifecycle-sending-hours-settings';

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: { timeZone: 'Asia/Kolkata' },
    fmt: {
      today: () => '2026-09-20',
      time: (value: Date) =>
        new Intl.DateTimeFormat('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        }).format(value),
    },
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ScopeHarness({
  scopeKey,
  canEdit = true,
  save,
}: {
  scopeKey: string;
  canEdit?: boolean;
  save: (patch: Record<string, boolean | number | number[]>) => Promise<void>;
}) {
  const [values, setValues] = useState({
    'branch-a': { start: 9, end: 19 },
    'branch-b': { start: 8, end: 18 },
  });
  const [drafts, setDrafts] = useState<
    Record<string, LifecycleSendingHoursDraft>
  >({});
  const value = values[scopeKey as keyof typeof values];
  return (
    <LifecycleSendingHoursSettings
      scopeKey={scopeKey}
      value={value}
      draft={drafts[scopeKey] ?? {}}
      canEdit={canEdit}
      onDraftChange={(draft) =>
        setDrafts((current) => ({ ...current, [scopeKey]: draft }))
      }
      onSave={async (patch) => {
        await save(patch);
        setValues((current) => ({
          ...current,
          [scopeKey]: {
            start: Number(patch.sendWindowStart),
            end: Number(patch.sendWindowEnd),
          },
        }));
      }}
    />
  );
}

async function chooseStart(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Start sending at' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('Lifecycle sending hours', () => {
  it('names every lifecycle rule in scope and calls out the workers outside it', () => {
    render(
      <ScopeHarness
        scopeKey="branch-a"
        save={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(
      screen.getAllByRole('listitem').map((item) => item.textContent)
    ).toEqual([
      'Unpaid invoice reminders',
      'Expired membership follow-up',
      'Expired service follow-up',
      'Promised payment reminder',
      'Payment link follow-up',
      'Session pack reminders',
      'Return after a membership pause',
      'Invite expired members back',
      'Invite members to renew a service',
    ]);
    expect(
      screen.getByText('Choose when the messages listed below can be sent.')
    ).toBeTruthy();
    expect(
      screen.getByText('Messages that share these sending hours')
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Membership renewal, service renewal, and installment reminders still start after/i
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Payment confirmations and AutoPay updates send when the payment status changes/i
      )
    ).toBeTruthy();
    expect(screen.queryByText(/lifecycle reminders/i)).toBeNull();
    expect(screen.queryByText(/recorded events/i)).toBeNull();
    expect(screen.queryByText(/this window/i)).toBeNull();
  });

  it('keeps cancel and save local to the hours draft', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ScopeHarness scopeKey="branch-a" save={save} />);

    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    await chooseStart('10:00 am');
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    await chooseStart('9:00 am');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();

    await chooseStart('10:00 am');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Start sending at' }).textContent
    ).toContain('9:00 am');

    await chooseStart('10:00 am');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        sendWindowStart: 10,
        sendWindowEnd: 19,
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    );
    expect(
      screen.getByRole('combobox', { name: 'Start sending at' }).textContent
    ).toContain('10:00 am');
  });

  it('preserves a failed draft and gives it an inline recovery state', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Write failed'));
    render(<ScopeHarness scopeKey="branch-a" save={save} />);

    await chooseStart('10:00 am');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const alertTitle = await screen.findByText('Sending hours weren’t saved');
    expect(alertTitle.closest('[role="alert"]')).toBeTruthy();
    expect(screen.getByText('Write failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(
      screen.getByRole('combobox', { name: 'Start sending at' }).textContent
    ).toContain('10:00 am');
  });

  it('keeps unsaved hours isolated by branch and restores them on return', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const rendered = render(<ScopeHarness scopeKey="branch-a" save={save} />);

    await chooseStart('10:00 am');
    rendered.rerender(<ScopeHarness scopeKey="branch-b" save={save} />);
    expect(
      screen.getByRole('combobox', { name: 'Start sending at' }).textContent
    ).toContain('8:00 am');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();

    rendered.rerender(<ScopeHarness scopeKey="branch-a" save={save} />);
    expect(
      screen.getByRole('combobox', { name: 'Start sending at' }).textContent
    ).toContain('10:00 am');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the editor read-only when settings access is missing', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ScopeHarness scopeKey="branch-a" canEdit={false} save={save} />);

    expect(
      screen.getByRole('combobox', { name: 'Start sending at' })
    ).toHaveProperty('disabled', true);
    expect(
      screen.getByRole('combobox', { name: 'Stop sending after' })
    ).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
