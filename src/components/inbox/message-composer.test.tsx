// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageComposer } from './message-composer';

const permissions = vi.hoisted(() => ({ canSendMessages: true }));
const mediaStorage = vi.hoisted(() => ({
  uploadAccountMedia: vi.fn(),
  deleteAccountMedia: vi.fn(),
}));

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
  uploadAccountMedia: mediaStorage.uploadAccountMedia,
  deleteAccountMedia: mediaStorage.deleteAccountMedia,
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

beforeEach(() => {
  permissions.canSendMessages = true;
  mediaStorage.uploadAccountMedia.mockReset();
  mediaStorage.deleteAccountMedia.mockReset();
  mediaStorage.deleteAccountMedia.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
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
  it('explains permission before empty-input validation on the text Send action', async () => {
    permissions.canSendMessages = false;
    const onSend = vi.fn();
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

    const send = screen.getByRole('button', { name: 'Send message' });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    expect(send.getAttribute('aria-disabled')).toBe('true');
    await user.click(send);

    const blocker = screen.getByRole('dialog', {
      name: 'Admin access required',
    });
    expect(within(blocker).queryAllByRole('button')).toHaveLength(0);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('opens the allowed attachment menu by pointer and keyboard without a competing popover', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={vi.fn()}
        onOpenTemplates={vi.fn()}
      />
    );

    const attach = screen.getByRole('button', { name: 'Attach media' });
    await user.click(attach);
    expect(screen.getByRole('menuitem', { name: 'Photo' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.keyboard('{Escape}');
    attach.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('menuitem', { name: 'Photo' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      consoleError.mock.calls.some((args) =>
        args.some(
          (value) => typeof value === 'string' && value.includes('nativeButton')
        )
      )
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('keeps attachment permission blockers focusable and opens only the explanation', async () => {
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

    const attach = screen.getByRole('button', { name: 'Attach media' });
    expect(attach.getAttribute('disabled')).toBeNull();
    expect(attach.getAttribute('tabindex')).toBe('0');
    expect(attach.getAttribute('aria-disabled')).toBe('true');
    attach.focus();
    await user.keyboard(' ');

    expect(
      screen.getByRole('dialog', { name: 'Admin access required' })
    ).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: /ask|request/i })).toBeNull();
  });

  it('resolves a closed-session attachment attempt through the template picker', async () => {
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

    const attach = screen.getByRole('button', { name: 'Attach media' });
    expect(attach.getAttribute('disabled')).toBeNull();
    expect(attach.getAttribute('tabindex')).toBe('0');
    attach.focus();
    await user.keyboard('{Enter}');

    const blocker = screen.getByRole('dialog', {
      name: 'WhatsApp session has closed',
    });
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(
      within(blocker).getByRole('button', { name: 'Send template' })
    );
    expect(onOpenTemplates).toHaveBeenCalledOnce();
  });

  it('keeps a staged attachment send focusable and suppresses its callback when permission is lost', async () => {
    mediaStorage.uploadAccountMedia.mockResolvedValue({
      publicUrl: 'https://example.test/member.jpg',
      path: 'account-1/member.jpg',
    });
    const onSendMedia = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={vi.fn()}
      />
    );

    const fileInput = view.container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="image/"]'
    );
    if (!fileInput) throw new Error('Missing image input');
    await user.upload(
      fileInput,
      new File(['image'], 'member.jpg', { type: 'image/jpeg' })
    );
    await screen.findByRole('img', { name: 'member.jpg' });

    permissions.canSendMessages = false;
    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={vi.fn()}
      />
    );

    const sendAttachment = screen.getByRole('button', {
      name: 'Send attachment',
    });
    expect((sendAttachment as HTMLButtonElement).disabled).toBe(false);
    expect(sendAttachment.getAttribute('aria-disabled')).toBe('true');
    await user.click(sendAttachment);

    expect(screen.getByText('Admin access required')).toBeTruthy();
    expect(onSendMedia).not.toHaveBeenCalled();
  });

  it('resolves a staged attachment when the session closes before send', async () => {
    mediaStorage.uploadAccountMedia.mockResolvedValue({
      publicUrl: 'https://example.test/member.jpg',
      path: 'account-1/member.jpg',
    });
    const onSendMedia = vi.fn();
    const onOpenTemplates = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
      />
    );

    const fileInput = view.container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="image/"]'
    );
    if (!fileInput) throw new Error('Missing image input');
    await user.upload(
      fileInput,
      new File(['image'], 'member.jpg', { type: 'image/jpeg' })
    );
    await screen.findByRole('img', { name: 'member.jpg' });

    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Send attachment' }));

    const blocker = screen.getByRole('dialog', {
      name: 'WhatsApp session has closed',
    });
    expect(onSendMedia).not.toHaveBeenCalled();
    await user.click(
      within(blocker).getByRole('button', { name: 'Send template' })
    );
    expect(onOpenTemplates).toHaveBeenCalledOnce();
  });

  it('blocks caption Enter when permission is lost and anchors the permission explanation to Send attachment', async () => {
    mediaStorage.uploadAccountMedia.mockResolvedValue({
      publicUrl: 'https://example.test/member.jpg',
      path: 'account-1/member.jpg',
    });
    const onSendMedia = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={vi.fn()}
      />
    );
    const fileInput = view.container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="image/"]'
    );
    if (!fileInput) throw new Error('Missing image input');
    await user.upload(
      fileInput,
      new File(['image'], 'member.jpg', { type: 'image/jpeg' })
    );
    await screen.findByRole('img', { name: 'member.jpg' });

    permissions.canSendMessages = false;
    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={vi.fn()}
      />
    );
    const sendAttachment = screen.getByRole('button', {
      name: 'Send attachment',
    });
    screen.getByPlaceholderText('Add a caption').focus();
    await user.keyboard('{Enter}');

    const blocker = screen.getByRole('dialog', {
      name: 'Admin access required',
    });
    expect(sendAttachment.getAttribute('aria-expanded')).toBe('true');
    expect(within(blocker).queryAllByRole('button')).toHaveLength(0);
    expect(onSendMedia).not.toHaveBeenCalled();
  });

  it('blocks caption Enter after session close and reuses the template resolution', async () => {
    mediaStorage.uploadAccountMedia.mockResolvedValue({
      publicUrl: 'https://example.test/member.jpg',
      path: 'account-1/member.jpg',
    });
    const onSendMedia = vi.fn();
    const onOpenTemplates = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
      />
    );
    const fileInput = view.container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="image/"]'
    );
    if (!fileInput) throw new Error('Missing image input');
    await user.upload(
      fileInput,
      new File(['image'], 'member.jpg', { type: 'image/jpeg' })
    );
    await screen.findByRole('img', { name: 'member.jpg' });

    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
      />
    );
    screen.getByPlaceholderText('Add a caption').focus();
    await user.keyboard('{Enter}');

    const blocker = screen.getByRole('dialog', {
      name: 'WhatsApp session has closed',
    });
    expect(onSendMedia).not.toHaveBeenCalled();
    expect(within(blocker).queryAllByRole('button')).toHaveLength(1);
    await user.click(
      within(blocker).getByRole('button', { name: 'Send template' })
    );
    expect(onOpenTemplates).toHaveBeenCalledOnce();
  });

  it('does not reopen a returning staged-media blocker without a new activation', async () => {
    mediaStorage.uploadAccountMedia.mockResolvedValue({
      publicUrl: 'https://example.test/member.jpg',
      path: 'account-1/member.jpg',
    });
    const onSendMedia = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={vi.fn()}
      />
    );
    const fileInput = view.container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="image/"]'
    );
    if (!fileInput) throw new Error('Missing image input');
    await user.upload(
      fileInput,
      new File(['image'], 'member.jpg', { type: 'image/jpeg' })
    );
    await screen.findByRole('img', { name: 'member.jpg' });
    const caption = screen.getByPlaceholderText('Add a caption');
    await user.type(caption, 'Keep this caption');

    permissions.canSendMessages = false;
    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Send attachment' }));
    expect(
      screen.getByRole('dialog', { name: 'Admin access required' })
    ).toBeTruthy();

    permissions.canSendMessages = true;
    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('img', { name: 'member.jpg' })).toBeTruthy();
    expect((caption as HTMLInputElement).value).toBe('Keep this caption');

    caption.focus();
    permissions.canSendMessages = false;
    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(caption);
    expect(onSendMedia).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Send attachment' }));
    expect(
      screen.getByRole('dialog', { name: 'Admin access required' })
    ).toBeTruthy();
  });

  it('resets an open permission explanation when the staged-media blocker changes to session', async () => {
    mediaStorage.uploadAccountMedia.mockResolvedValue({
      publicUrl: 'https://example.test/member.jpg',
      path: 'account-1/member.jpg',
    });
    const onSendMedia = vi.fn();
    const onOpenTemplates = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
      />
    );
    const fileInput = view.container.querySelector<HTMLInputElement>(
      'input[type="file"][accept^="image/"]'
    );
    if (!fileInput) throw new Error('Missing image input');
    await user.upload(
      fileInput,
      new File(['image'], 'member.jpg', { type: 'image/jpeg' })
    );
    await screen.findByRole('img', { name: 'member.jpg' });

    permissions.canSendMessages = false;
    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired={false}
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Send attachment' }));
    expect(
      screen.getByRole('dialog', { name: 'Admin access required' })
    ).toBeTruthy();

    permissions.canSendMessages = true;
    view.rerender(
      <MessageComposer
        conversationId="conversation-1"
        sessionExpired
        onSend={vi.fn()}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
      />
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('img', { name: 'member.jpg' })).toBeTruthy();

    const caption = screen.getByPlaceholderText('Add a caption');
    caption.focus();
    expect(document.activeElement).toBe(caption);
    await user.keyboard('{Enter}');

    const blocker = screen.getByRole('dialog', {
      name: 'WhatsApp session has closed',
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(onSendMedia).not.toHaveBeenCalled();
    await user.click(
      within(blocker).getByRole('button', { name: 'Send template' })
    );
    expect(onOpenTemplates).toHaveBeenCalledOnce();
  });

  it.each(['caption Enter', 'Send attachment button'])(
    'keeps allowed staged-media sending through %s',
    async (activation) => {
      mediaStorage.uploadAccountMedia.mockResolvedValue({
        publicUrl: 'https://example.test/member.jpg',
        path: 'account-1/member.jpg',
      });
      const onSendMedia = vi.fn();
      const user = userEvent.setup();
      const view = render(
        <MessageComposer
          conversationId="conversation-1"
          sessionExpired={false}
          onSend={vi.fn()}
          onSendMedia={onSendMedia}
          onOpenTemplates={vi.fn()}
        />
      );
      const fileInput = view.container.querySelector<HTMLInputElement>(
        'input[type="file"][accept^="image/"]'
      );
      if (!fileInput) throw new Error('Missing image input');
      await user.upload(
        fileInput,
        new File(['image'], 'member.jpg', { type: 'image/jpeg' })
      );
      await screen.findByRole('img', { name: 'member.jpg' });

      if (activation === 'caption Enter') {
        screen.getByPlaceholderText('Add a caption').focus();
        await user.keyboard('{Enter}');
      } else {
        await user.click(
          screen.getByRole('button', { name: 'Send attachment' })
        );
      }

      await waitFor(() => expect(onSendMedia).toHaveBeenCalledOnce());
      expect(onSendMedia).toHaveBeenCalledWith({
        kind: 'image',
        mediaUrl: 'https://example.test/member.jpg',
        path: 'account-1/member.jpg',
        caption: undefined,
        filename: undefined,
        replyToId: undefined,
      });
    }
  );

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
