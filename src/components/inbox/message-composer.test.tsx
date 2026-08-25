// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageComposer } from './message-composer';

const permissions = vi.hoisted(() => ({ canSendMessages: true }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/inbox',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-can', () => ({
  useCan: () => permissions.canSendMessages,
}));
vi.mock('@/lib/storage/upload-media', () => ({
  MEDIA_MAX_BYTES_BY_KIND: {
    image: 5_000_000,
    video: 16_000_000,
    document: 16_000_000,
    audio: 16_000_000,
  },
  uploadAccountMedia: vi.fn(),
  deleteAccountMedia: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  cleanup();
  permissions.canSendMessages = true;
});

describe('MessageComposer pending feedback', () => {
  it('keeps the send button busy until the async send callback settles', async () => {
    let resolveSend!: () => void;
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        })
    );
    const user = userEvent.setup();
    render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={onSend}
        onSendMedia={vi.fn()}
        onOpenTemplates={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText('Message'), 'Hello');
    const send = screen.getByRole('button', { name: 'Send message' });
    await user.click(send);

    try {
      expect(onSend).toHaveBeenCalledWith('Hello', undefined);
      expect(send.getAttribute('aria-busy')).toBe('true');
      expect((send as HTMLButtonElement).disabled).toBe(true);
      expect(send.querySelector('.animate-spin')).not.toBeNull();
    } finally {
      resolveSend();
    }

    await waitFor(() => expect(send.getAttribute('aria-busy')).toBeNull());
  });
});

describe('MessageComposer blocked actions', () => {
  it('resolves a closed session through the template picker', async () => {
    const onOpenTemplates = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired
        onSend={vi.fn()}
        onSendMedia={vi.fn()}
        onOpenTemplates={onOpenTemplates}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    const blocker = screen.getByRole('dialog', {
      name: 'WhatsApp session has closed',
    });
    expect(blocker).toBeTruthy();
    await user.click(
      within(blocker).getByRole('button', { name: 'Send template' })
    );
    expect(onOpenTemplates).toHaveBeenCalledOnce();
  });

  it('explains read-only send actions without inventing a CTA', async () => {
    permissions.canSendMessages = false;
    const user = userEvent.setup();
    render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={vi.fn()}
        onOpenTemplates={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Send template' }));

    expect(screen.getByText('Admin access required')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ask|request/i })).toBeNull();
  });
});
