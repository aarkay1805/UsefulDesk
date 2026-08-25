// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/leads',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: { timeZone: 'Asia/Kolkata' },
    fmt: {
      today: () => '2026-08-25',
      date: (value: string) => value,
      dateTime: (value: string) => value,
      time: (value: string) => value,
    },
  }),
}));

import { FollowUpActivityCard } from './contact-notes-thread';

afterEach(cleanup);

const followUp: Parameters<typeof FollowUpActivityCard>[0]['followUp'] = {
  id: 'follow-up-1',
  note_id: null,
  status: 'open',
  task_type: 'call',
  reason: 'other',
  due_date: '2026-08-25',
  assigned_to: 'user-1',
  remind_at: null,
  note: null,
  created_by: 'user-1',
  created_at: '2026-08-24T10:00:00.000Z',
};

function renderCard(canCompleteFollowUps: boolean, onMarkDone = vi.fn()) {
  render(
    <FollowUpActivityCard
      followUp={followUp}
      authorName="Asha"
      authorAvatarUrl={null}
      currentUserId="user-1"
      nameById={new Map([['user-1', 'Asha']])}
      canCompleteFollowUps={canCompleteFollowUps}
      onMarkDone={onMarkDone}
    />
  );
  return onMarkDone;
}

describe('FollowUpActivityCard completion permission', () => {
  it('runs the real profile completion callback for an agent-capable role', async () => {
    const onMarkDone = renderCard(true);

    await userEvent.click(
      screen.getByRole('button', { name: 'Complete follow-up' })
    );

    expect(onMarkDone).toHaveBeenCalledWith('follow-up-1');
  });

  it('keeps viewer completion focusable and suppresses the profile callback', async () => {
    const onMarkDone = renderCard(false);
    const complete = screen.getByRole('button', {
      name: 'Complete follow-up',
    });
    expect((complete as HTMLButtonElement).disabled).toBe(false);
    expect(complete.getAttribute('aria-disabled')).toBe('true');

    await userEvent.click(complete);

    const blocker = screen.getByRole('dialog', {
      name: 'Admin access required',
    });
    expect(
      within(blocker).getByText('Ask an admin or owner to complete follow-ups.')
    ).toBeTruthy();
    expect(onMarkDone).not.toHaveBeenCalled();
  });
});
