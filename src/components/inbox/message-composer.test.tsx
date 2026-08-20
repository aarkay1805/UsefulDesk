// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageComposer } from './message-composer';

vi.mock('@/hooks/use-can', () => ({ useCan: () => true }));
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

afterEach(cleanup);

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

    await waitFor(() =>
      expect(send.getAttribute('aria-busy')).toBeNull()
    );
  });
});
