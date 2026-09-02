import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Suspense, type ReactNode, useEffect, useState } from 'react';

import type { ConversationRepository } from './conversation-repository';
import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type {
  InboxConnectionState,
  InboxRealtimeEvent,
} from './inbox-realtime';
import {
  ABSENT_MESSAGE_ID,
  BRANCH_ID,
  CONVERSATION_ID,
  MESSAGE_0_ID,
  MESSAGE_1_ID,
  MESSAGE_2_ID,
  MESSAGE_3_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
  conversation,
  message,
  page,
} from './inbox-test-fixtures';
import type { SessionWindowMessageRepository } from './message-repository';
import type {
  MobileSendDependencies,
  MobileSendInput,
  MobileSendResult,
} from './send-message-client';
import { MobileSendError } from './send-message-client';
import type {
  ConnectionReadiness,
  InboxConversation,
  InboxMessage,
  MessageCursor,
  NativeTemplate,
  Page,
} from './inbox-types';
import type { TemplateRepository } from './template-repository';
import {
  type UseMessageThreadOptions,
  type UseMessageThreadResult,
  useMessageThread,
} from './use-message-thread';

type MessagePage = Page<InboxMessage, MessageCursor>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const conversations: jest.Mocked<ConversationRepository> = {
  list: jest.fn(),
  unreadCount: jest.fn(),
  get: jest.fn().mockResolvedValue(conversation()),
  markRead: jest.fn().mockResolvedValue(undefined),
};
const messages: jest.Mocked<SessionWindowMessageRepository> = {
  get: jest.fn().mockResolvedValue(message()),
  getLatestCustomerMessageAt: jest
    .fn()
    .mockResolvedValue('2026-09-01T08:01:00.000Z'),
  list: jest
    .fn()
    .mockResolvedValue(
      page([
        message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T08:01:00.000Z' }),
        message({ id: MESSAGE_2_ID, createdAt: '2026-09-01T08:02:00.000Z' }),
      ])
    ),
};

const connectedReadiness: ConnectionReadiness = {
  status: 'connected',
  ready: true,
  reason: null,
  connectedAt: '2026-09-01T08:00:00.000Z',
};

const sendableTemplate: NativeTemplate = {
  id: '5b52d03c-9d8c-4cf4-b8c6-a10b9b233571',
  name: 'static_notice',
  language: 'en',
  category: 'Utility',
  bodyText: 'The gym opens at 6 AM.',
  headerType: null,
  headerContent: null,
  headerMediaUrl: null,
  buttons: [],
  status: 'APPROVED',
  parameterFormat: 'POSITIONAL',
  providerMissingSince: null,
  providerComponentsSyncRequiredAt: null,
};

const templateRepository: jest.Mocked<TemplateRepository> = {
  listSendableTemplates: jest.fn().mockResolvedValue([sendableTemplate]),
  getWhatsAppConnectionReadiness: jest
    .fn()
    .mockResolvedValue(connectedReadiness),
};

function fakeThreadRealtimeFeed(): InboxRealtimeFeed & {
  eventCleanup: jest.Mock;
  statusCleanup: jest.Mock;
  emit(event: InboxRealtimeEvent): Promise<void>;
  emitStatus(
    connection: InboxConnectionState,
    generation: number
  ): Promise<void>;
} {
  const events = new Set<(event: InboxRealtimeEvent) => void>();
  const statuses = new Set<
    (snapshot: ReturnType<InboxRealtimeFeed['getSnapshot']>) => void
  >();
  let snapshot: ReturnType<InboxRealtimeFeed['getSnapshot']> = {
    connection: 'connected',
    resyncGeneration: 0,
  };
  const eventCleanup = jest.fn();
  const statusCleanup = jest.fn();
  return {
    eventCleanup,
    statusCleanup,
    getSnapshot: () => snapshot,
    listen(listener) {
      events.add(listener);
      return () => {
        events.delete(listener);
        eventCleanup();
      };
    },
    listenStatus(listener) {
      statuses.add(listener);
      return () => {
        statuses.delete(listener);
        statusCleanup();
      };
    },
    async emit(event) {
      events.forEach((listener) => listener(event));
      await Promise.resolve();
    },
    async emitStatus(connection, resyncGeneration) {
      snapshot = { connection, resyncGeneration };
      statuses.forEach((listener) => listener(snapshot));
      await Promise.resolve();
    },
  };
}

let realtime = fakeThreadRealtimeFeed();

function useConfiguredThread(
  overrides: Partial<UseMessageThreadOptions> = {}
): UseMessageThreadResult {
  return useMessageThread({
    accountId: BRANCH_ID,
    conversationId: CONVERSATION_ID,
    role: 'agent',
    conversations,
    messages,
    realtime,
    templates: templateRepository,
    ...overrides,
  });
}

beforeEach(() => {
  conversations.get.mockReset().mockResolvedValue(conversation());
  conversations.markRead.mockReset().mockResolvedValue(undefined);
  messages.list
    .mockReset()
    .mockResolvedValue(
      page([
        message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T08:01:00.000Z' }),
        message({ id: MESSAGE_2_ID, createdAt: '2026-09-01T08:02:00.000Z' }),
      ])
    );
  messages.get.mockReset().mockResolvedValue(message());
  messages.getLatestCustomerMessageAt
    .mockReset()
    .mockResolvedValue('2026-09-01T08:01:00.000Z');
  templateRepository.listSendableTemplates
    .mockReset()
    .mockResolvedValue([sendableTemplate]);
  templateRepository.getWhatsAppConnectionReadiness
    .mockReset()
    .mockResolvedValue(connectedReadiness);
  realtime = fakeThreadRealtimeFeed();
});

describe('useMessageThread', () => {
  it('loads the verified conversation and latest chronological message page', async () => {
    const { result } = renderHook(() =>
      useMessageThread({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        role: 'agent',
        conversations,
        messages,
        realtime,
      })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_1_ID,
      MESSAGE_2_ID,
    ]);
    expect(conversations.markRead).toHaveBeenCalledWith(
      BRANCH_ID,
      CONVERSATION_ID
    );
  });

  it('loads latest inbound, sendable templates, and connection readiness for the current branch owner', async () => {
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() =>
      expect(result.current.sendReadiness.status).toBe('ready')
    );

    expect(messages.getLatestCustomerMessageAt).toHaveBeenCalledWith(
      BRANCH_ID,
      CONVERSATION_ID
    );
    expect(templateRepository.listSendableTemplates).toHaveBeenCalledWith(
      BRANCH_ID
    );
    expect(
      templateRepository.getWhatsAppConnectionReadiness
    ).toHaveBeenCalledWith(BRANCH_ID);
    expect(result.current.sendReadiness).toEqual({
      status: 'ready',
      latestInboundAt: '2026-09-01T08:01:00.000Z',
      templates: [sendableTemplate],
      connectionReadiness: connectedReadiness,
      templateReadiness: {
        status: 'ready',
        hasLocalTemplates: true,
        contractReady: true,
      },
    });
  });

  it('does not load customer-send readiness for a viewer', async () => {
    const { result } = renderHook(() =>
      useConfiguredThread({ role: 'viewer' })
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.sendReadiness.status).toBe('hidden');
    expect(messages.getLatestCustomerMessageAt).not.toHaveBeenCalled();
    expect(templateRepository.listSendableTemplates).not.toHaveBeenCalled();
    expect(
      templateRepository.getWhatsAppConnectionReadiness
    ).not.toHaveBeenCalled();
  });

  it('fails closed only template readiness when template data is inconsistent', async () => {
    templateRepository.listSendableTemplates.mockResolvedValueOnce([
      {
        ...sendableTemplate,
        parameterFormat: 'NAMED',
      } as unknown as NativeTemplate,
    ]);
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() =>
      expect(result.current.sendReadiness.templateReadiness?.status).toBe(
        'error'
      )
    );
    expect(result.current.sendReadiness.status).toBe('ready');
    expect(result.current.sendReadiness.templates).toEqual([]);
  });

  it('keeps open-text readiness available when template parsing fails', async () => {
    templateRepository.listSendableTemplates.mockRejectedValueOnce(
      new Error('Could not load sendable templates')
    );
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() =>
      expect(result.current.sendReadiness.status).toBe('ready')
    );
    expect(result.current.sendReadiness).toMatchObject({
      latestInboundAt: '2026-09-01T08:01:00.000Z',
      connectionReadiness: connectedReadiness,
      templates: [],
      templateReadiness: {
        status: 'error',
        hasLocalTemplates: false,
        contractReady: false,
      },
    });
  });

  it('drops stale readiness completions after a branch and conversation change', async () => {
    const oldLatest = deferred<string | null>();
    const oldTemplates = deferred<NativeTemplate[]>();
    const oldConnection = deferred<ConnectionReadiness>();
    messages.getLatestCustomerMessageAt
      .mockReturnValueOnce(oldLatest.promise)
      .mockResolvedValueOnce('2026-09-01T09:00:00.000Z');
    templateRepository.listSendableTemplates
      .mockReturnValueOnce(oldTemplates.promise)
      .mockResolvedValueOnce([sendableTemplate]);
    templateRepository.getWhatsAppConnectionReadiness
      .mockReturnValueOnce(oldConnection.promise)
      .mockResolvedValueOnce(connectedReadiness);
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(
        conversation({
          id: OTHER_CONVERSATION_ID,
          accountId: OTHER_BRANCH_ID,
        })
      );
    messages.list
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { accountId: string; conversationId: string }
    >(
      ({ accountId, conversationId }) =>
        useConfiguredThread({ accountId, conversationId }),
      {
        initialProps: {
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
        },
      }
    );

    rerender({
      accountId: OTHER_BRANCH_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    await waitFor(() =>
      expect(result.current.sendReadiness).toMatchObject({
        status: 'ready',
        latestInboundAt: '2026-09-01T09:00:00.000Z',
      })
    );

    await act(async () => {
      oldLatest.resolve('2026-09-01T07:00:00.000Z');
      oldTemplates.resolve([]);
      oldConnection.resolve({
        status: 'disconnected',
        ready: false,
        reason: 'Old branch is disconnected.',
        connectedAt: null,
      });
      await Promise.all([
        oldLatest.promise,
        oldTemplates.promise,
        oldConnection.promise,
      ]);
    });

    expect(result.current.sendReadiness).toMatchObject({
      status: 'ready',
      latestInboundAt: '2026-09-01T09:00:00.000Z',
      templates: [sendableTemplate],
      connectionReadiness: connectedReadiness,
    });
  });

  it('drops stale readiness completions after the realtime feed changes', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    const oldLatest = deferred<string | null>();
    const oldTemplates = deferred<NativeTemplate[]>();
    const oldConnection = deferred<ConnectionReadiness>();
    messages.getLatestCustomerMessageAt
      .mockReturnValueOnce(oldLatest.promise)
      .mockResolvedValue('2026-09-01T10:00:00.000Z');
    templateRepository.listSendableTemplates
      .mockReturnValueOnce(oldTemplates.promise)
      .mockResolvedValueOnce([sendableTemplate]);
    templateRepository.getWhatsAppConnectionReadiness
      .mockReturnValueOnce(oldConnection.promise)
      .mockResolvedValueOnce(connectedReadiness);
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { currentFeed: InboxRealtimeFeed }
    >(({ currentFeed }) => useConfiguredThread({ realtime: currentFeed }), {
      initialProps: { currentFeed: firstFeed },
    });

    rerender({ currentFeed: secondFeed });
    await waitFor(() =>
      expect(result.current.sendReadiness).toMatchObject({
        status: 'ready',
        latestInboundAt: '2026-09-01T10:00:00.000Z',
      })
    );

    await act(async () => {
      oldLatest.resolve(null);
      oldTemplates.resolve([]);
      oldConnection.resolve({
        status: 'absent',
        ready: false,
        reason: 'Old feed result.',
        connectedAt: null,
      });
      await Promise.all([
        oldLatest.promise,
        oldTemplates.promise,
        oldConnection.promise,
      ]);
    });

    expect(result.current.sendReadiness).toMatchObject({
      status: 'ready',
      latestInboundAt: '2026-09-01T10:00:00.000Z',
      templates: [sendableTemplate],
      connectionReadiness: connectedReadiness,
    });
  });

  it('advances latest inbound readiness for realtime customer inserts without regressing for an older insert', async () => {
    messages.getLatestCustomerMessageAt.mockResolvedValueOnce(
      '2026-09-01T08:01:00.000Z'
    );
    messages.get
      .mockResolvedValueOnce(
        message({
          id: MESSAGE_3_ID,
          senderType: 'customer',
          createdAt: '2026-09-01T10:00:00.000Z',
        })
      )
      .mockResolvedValueOnce(
        message({
          id: MESSAGE_0_ID,
          senderType: 'customer',
          createdAt: '2026-09-01T09:00:00.000Z',
        })
      );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() =>
      expect(result.current.sendReadiness.status).toBe('ready')
    );

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_3_ID,
      })
    );
    await waitFor(() =>
      expect(result.current.sendReadiness.latestInboundAt).toBe(
        '2026-09-01T10:00:00.000Z'
      )
    );

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      })
    );

    expect(result.current.sendReadiness.latestInboundAt).toBe(
      '2026-09-01T10:00:00.000Z'
    );
  });

  it('does not clear shared unread state for a viewer', async () => {
    renderHook(() =>
      useMessageThread({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        role: 'viewer',
        conversations,
        messages,
        realtime,
      })
    );
    await waitFor(() => expect(messages.list).toHaveBeenCalled());
    expect(conversations.markRead).not.toHaveBeenCalled();
  });

  it('publishes unavailable when the verified conversation is missing', async () => {
    conversations.get.mockRejectedValueOnce(
      new Error('Conversation is unavailable')
    );
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.items).toEqual([]);
    expect(conversations.markRead).not.toHaveBeenCalled();
  });

  it('publishes a fixed recoverable error when the initial load fails', async () => {
    messages.list.mockRejectedValueOnce(new Error('Database details'));
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Could not load messages');
    expect(result.current.items).toEqual([]);
  });

  it('preserves visible history and warns when manual refresh fails', async () => {
    messages.list
      .mockResolvedValueOnce(
        page([
          message({
            id: MESSAGE_1_ID,
            createdAt: '2026-09-01T08:01:00.000Z',
          }),
          message({
            id: MESSAGE_2_ID,
            createdAt: '2026-09-01T08:02:00.000Z',
          }),
        ])
      )
      .mockRejectedValueOnce(new Error('Could not load messages'));
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.refresh());

    await waitFor(() =>
      expect(result.current.refreshWarning).toBe('Could not refresh messages')
    );
    expect(result.current.conversation).toEqual(conversation());
    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_1_ID,
      MESSAGE_2_ID,
    ]);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(result.current.refreshing).toBe(false);
  });

  it('preserves visible history across failed foreground and reconnect resyncs', async () => {
    messages.list
      .mockResolvedValueOnce(
        page([
          message({
            id: MESSAGE_1_ID,
            createdAt: '2026-09-01T08:01:00.000Z',
          }),
          message({
            id: MESSAGE_2_ID,
            createdAt: '2026-09-01T08:02:00.000Z',
          }),
        ])
      )
      .mockRejectedValueOnce(new Error('Foreground refresh failed'))
      .mockRejectedValueOnce(new Error('Reconnect refresh failed'));
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => realtime.emitStatus('connected', 1));
    await waitFor(() =>
      expect(result.current.refreshWarning).toBe('Could not refresh messages')
    );
    expect(result.current.items).toHaveLength(2);
    expect(result.current.refreshing).toBe(false);

    await act(async () => realtime.emitStatus('disconnected', 1));
    await act(async () => realtime.emitStatus('connected', 2));
    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.status).toBe('ready');
    expect(result.current.refreshWarning).toBe('Could not refresh messages');
  });

  it('publishes unavailable when a refresh verifies the conversation is gone', async () => {
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockRejectedValueOnce(new Error('Conversation is unavailable'));
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.conversation).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(result.current.refreshWarning).toBeNull();
  });

  it('keeps readable history and warns when clearing unread fails', async () => {
    conversations.markRead.mockRejectedValueOnce(new Error('Denied'));
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() =>
      expect(result.current.unreadWarning).toBe(
        'Could not clear unread messages'
      )
    );
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toHaveLength(2);
  });

  it('retries a failed unread clear on refresh', async () => {
    conversations.markRead
      .mockRejectedValueOnce(new Error('Denied'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() =>
      expect(result.current.unreadWarning).toBe(
        'Could not clear unread messages'
      )
    );

    act(() => result.current.refresh());

    await waitFor(() =>
      expect(conversations.markRead).toHaveBeenCalledTimes(2)
    );
    await waitFor(() => expect(result.current.unreadWarning).toBeNull());
  });

  it('deduplicates inserts and ignores updates for another thread', async () => {
    messages.get.mockResolvedValueOnce(
      message({
        id: MESSAGE_0_ID,
        createdAt: '2026-09-01T08:00:00.000Z',
      })
    );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_2_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_2_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: OTHER_CONVERSATION_ID,
        messageId: MESSAGE_3_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: ABSENT_MESSAGE_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      });
    });
    await waitFor(() =>
      expect(result.current.items.map((item) => item.id)).toEqual([
        MESSAGE_0_ID,
        MESSAGE_1_ID,
        MESSAGE_2_ID,
      ])
    );
    expect(messages.get).toHaveBeenCalledTimes(1);
  });

  it('hydrates a delivery update only for an existing message id', async () => {
    messages.get.mockResolvedValueOnce(
      message({ id: MESSAGE_2_ID, senderType: 'agent', status: 'read' })
    );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_2_ID,
      })
    );
    await waitFor(() =>
      expect(
        result.current.items.find((item) => item.id === MESSAGE_2_ID)?.status
      ).toBe('read')
    );
  });

  it('removes a matching message after a delete event', async () => {
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );

    expect(result.current.items.map((item) => item.id)).toEqual([MESSAGE_2_ID]);
  });

  it('coalesces concurrent hydrations for the same message id', async () => {
    const hydrate = deferred<InboxMessage>();
    messages.get.mockReturnValueOnce(hydrate.promise);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const event: InboxRealtimeEvent = {
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_0_ID,
    };

    await act(async () => {
      await Promise.all([realtime.emit(event), realtime.emit(event)]);
    });

    expect(messages.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      hydrate.resolve(
        message({
          id: MESSAGE_0_ID,
          createdAt: '2026-09-01T08:00:00.000Z',
        })
      );
      await hydrate.promise;
      await Promise.resolve();
    });
    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_0_ID,
      MESSAGE_1_ID,
      MESSAGE_2_ID,
    ]);
  });

  it('replays a status update that arrives while its insert hydration is in flight', async () => {
    const insertHydration = deferred<InboxMessage>();
    messages.get
      .mockReturnValueOnce(insertHydration.promise)
      .mockResolvedValueOnce(
        message({
          id: MESSAGE_0_ID,
          senderType: 'agent',
          providerMessageId: 'wamid.raced-provider-failure',
          status: 'failed',
          providerErrorTitle: 'Message not delivered',
          createdAt: '2026-09-01T08:00:00.000Z',
        })
      );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      });
    });

    expect(messages.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      insertHydration.resolve(
        message({
          id: MESSAGE_0_ID,
          senderType: 'agent',
          providerMessageId: 'wamid.raced-provider-failure',
          status: 'sent',
          createdAt: '2026-09-01T08:00:00.000Z',
        })
      );
      await insertHydration.promise;
    });

    await waitFor(() => expect(messages.get).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        result.current.items.find((item) => item.id === MESSAGE_0_ID)
      ).toEqual(
        expect.objectContaining({
          status: 'failed',
          providerErrorTitle: 'Message not delivered',
        })
      )
    );
  });

  it('replaces the authoritative header and handles conversation deletion', async () => {
    const updated = conversation({ status: 'closed', unreadCount: 0 });
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(updated);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    await waitFor(() => expect(result.current.conversation).toEqual(updated));

    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    expect(result.current.status).toBe('unavailable');
    expect(result.current.conversation).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it('clears unread once while inbound insert clearing is already in flight', async () => {
    const clearing = deferred<void>();
    messages.get
      .mockResolvedValueOnce(message({ id: MESSAGE_0_ID }))
      .mockResolvedValueOnce(message({ id: MESSAGE_3_ID }));
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() =>
      expect(conversations.markRead).toHaveBeenCalledTimes(1)
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    conversations.markRead.mockClear().mockReturnValue(clearing.promise);

    await act(async () => {
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_3_ID,
      });
    });

    await waitFor(() =>
      expect(conversations.markRead).toHaveBeenCalledTimes(1)
    );
    await act(async () => {
      clearing.resolve();
      await clearing.promise;
    });
  });

  it('never mutates unread state for a viewer after inbound inserts', async () => {
    messages.get.mockResolvedValueOnce(message({ id: MESSAGE_0_ID }));
    const { result } = renderHook(() =>
      useConfiguredThread({ role: 'viewer' })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      })
    );

    expect(conversations.markRead).not.toHaveBeenCalled();
  });

  it('prepends older history without changing the newest-page order', async () => {
    messages.list
      .mockResolvedValueOnce(
        page(
          [
            message({
              id: MESSAGE_1_ID,
              createdAt: '2026-09-01T08:01:00.000Z',
            }),
            message({
              id: MESSAGE_2_ID,
              createdAt: '2026-09-01T08:02:00.000Z',
            }),
          ],
          { createdAt: '2026-09-01T08:01:00.000Z', id: MESSAGE_1_ID }
        )
      )
      .mockResolvedValueOnce(
        page([
          message({
            id: MESSAGE_0_ID,
            createdAt: '2026-09-01T08:00:00.000Z',
          }),
        ])
      );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.loadOlder());
    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_0_ID,
      MESSAGE_1_ID,
      MESSAGE_2_ID,
    ]);
  });

  it('keeps visible history when loading older messages fails', async () => {
    messages.list
      .mockResolvedValueOnce(
        page([message({ id: MESSAGE_1_ID })], {
          createdAt: '2026-09-01T08:01:00.000Z',
          id: MESSAGE_1_ID,
        })
      )
      .mockRejectedValueOnce(new Error('Could not load messages'));
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.loadOlder());
    expect(result.current.items.map((item) => item.id)).toEqual([MESSAGE_1_ID]);
    expect(result.current.paginationError).toBe(
      'Could not load older messages'
    );
  });

  it('refetches the open thread when the shared provider requests resync', async () => {
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => realtime.emitStatus('connected', 1));
    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    expect(conversations.get).toHaveBeenCalledTimes(2);
  });

  it('ignores stale initial completions after the branch and conversation change', async () => {
    const firstConversation = deferred<InboxConversation>();
    const firstMessages = deferred<MessagePage>();
    const nextConversation = conversation({
      id: OTHER_CONVERSATION_ID,
      accountId: OTHER_BRANCH_ID,
    });
    const nextMessage = message({
      id: MESSAGE_3_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    conversations.get
      .mockReturnValueOnce(firstConversation.promise)
      .mockResolvedValueOnce(nextConversation);
    messages.list
      .mockReturnValueOnce(firstMessages.promise)
      .mockResolvedValueOnce(page([nextMessage]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { accountId: string; conversationId: string }
    >((props) => useConfiguredThread(props), {
      initialProps: {
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
      },
    });

    rerender({
      accountId: OTHER_BRANCH_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    await waitFor(() =>
      expect(result.current.conversation).toEqual(nextConversation)
    );

    await act(async () => {
      firstConversation.resolve(conversation());
      firstMessages.resolve(page([message()]));
      await Promise.all([firstConversation.promise, firstMessages.promise]);
      await Promise.resolve();
    });

    expect(result.current.conversation).toEqual(nextConversation);
    expect(result.current.items).toEqual([nextMessage]);
  });

  it('ignores stale pagination after the conversation changes', async () => {
    const older = deferred<MessagePage>();
    const cursor: MessageCursor = {
      createdAt: '2026-09-01T08:01:00.000Z',
      id: MESSAGE_1_ID,
    };
    const nextConversation = conversation({ id: OTHER_CONVERSATION_ID });
    const nextMessage = message({
      id: MESSAGE_3_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    messages.list
      .mockResolvedValueOnce(page([message({ id: MESSAGE_1_ID })], cursor))
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(page([nextMessage]));
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(nextConversation);
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { conversationId: string }
    >(({ conversationId }) => useConfiguredThread({ conversationId }), {
      initialProps: { conversationId: CONVERSATION_ID },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.loadOlder());
    rerender({ conversationId: OTHER_CONVERSATION_ID });
    await waitFor(() => expect(result.current.items).toEqual([nextMessage]));
    await act(async () => {
      older.resolve(page([message({ id: MESSAGE_0_ID })]));
      await older.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([nextMessage]);
    expect(result.current.loadingOlder).toBe(false);
  });

  it('ignores stale message hydration after the branch changes', async () => {
    const hydrate = deferred<InboxMessage>();
    messages.get.mockReturnValueOnce(hydrate.promise);
    const nextConversation = conversation({ accountId: OTHER_BRANCH_ID });
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(nextConversation);
    messages.list
      .mockResolvedValueOnce(page([message({ id: MESSAGE_1_ID })]))
      .mockResolvedValueOnce(page([]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { accountId: string }
    >(({ accountId }) => useConfiguredThread({ accountId }), {
      initialProps: { accountId: BRANCH_ID },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      })
    );

    rerender({ accountId: OTHER_BRANCH_ID });
    await waitFor(() => expect(result.current.items).toEqual([]));
    await act(async () => {
      hydrate.resolve(message({ id: MESSAGE_0_ID }));
      await hydrate.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
  });

  it('ignores a stale conversation-header refresh after the conversation changes', async () => {
    const header = deferred<InboxConversation>();
    const nextConversation = conversation({ id: OTHER_CONVERSATION_ID });
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockReturnValueOnce(header.promise)
      .mockResolvedValueOnce(nextConversation);
    messages.list
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { conversationId: string }
    >(({ conversationId }) => useConfiguredThread({ conversationId }), {
      initialProps: { conversationId: CONVERSATION_ID },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );

    rerender({ conversationId: OTHER_CONVERSATION_ID });
    await waitFor(() =>
      expect(result.current.conversation).toEqual(nextConversation)
    );
    await act(async () => {
      header.resolve(conversation({ status: 'closed' }));
      await header.promise;
      await Promise.resolve();
    });

    expect(result.current.conversation).toEqual(nextConversation);
  });

  it('ignores a stale unread-clear failure after the conversation changes', async () => {
    const oldClear = deferred<void>();
    const nextConversation = conversation({ id: OTHER_CONVERSATION_ID });
    conversations.markRead
      .mockReturnValueOnce(oldClear.promise)
      .mockResolvedValueOnce(undefined);
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(nextConversation);
    messages.list.mockResolvedValue(page([]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { conversationId: string }
    >(({ conversationId }) => useConfiguredThread({ conversationId }), {
      initialProps: { conversationId: CONVERSATION_ID },
    });
    await waitFor(() =>
      expect(conversations.markRead).toHaveBeenCalledTimes(1)
    );

    rerender({ conversationId: OTHER_CONVERSATION_ID });
    await waitFor(() =>
      expect(result.current.conversation).toEqual(nextConversation)
    );
    await act(async () => {
      oldClear.reject(new Error('Denied'));
      try {
        await oldClear.promise;
      } catch {
        // The hook consumes this failure; the test only settles the deferred.
      }
      await Promise.resolve();
    });

    expect(result.current.unreadWarning).toBeNull();
  });

  it('ignores a stale resync completion after the conversation changes', async () => {
    const resyncConversation = deferred<InboxConversation>();
    const resyncMessages = deferred<MessagePage>();
    const nextConversation = conversation({ id: OTHER_CONVERSATION_ID });
    const nextMessage = message({
      id: MESSAGE_3_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockReturnValueOnce(resyncConversation.promise)
      .mockResolvedValueOnce(nextConversation);
    messages.list
      .mockResolvedValueOnce(page([]))
      .mockReturnValueOnce(resyncMessages.promise)
      .mockResolvedValueOnce(page([nextMessage]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { conversationId: string }
    >(({ conversationId }) => useConfiguredThread({ conversationId }), {
      initialProps: { conversationId: CONVERSATION_ID },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => realtime.emitStatus('connected', 1));
    await waitFor(() => expect(conversations.get).toHaveBeenCalledTimes(2));
    rerender({ conversationId: OTHER_CONVERSATION_ID });
    await waitFor(() =>
      expect(result.current.conversation).toEqual(nextConversation)
    );

    await act(async () => {
      resyncConversation.resolve(conversation({ status: 'closed' }));
      resyncMessages.resolve(page([message({ id: MESSAGE_0_ID })]));
      await Promise.all([resyncConversation.promise, resyncMessages.promise]);
      await Promise.resolve();
    });

    expect(result.current.conversation).toEqual(nextConversation);
    expect(result.current.items).toEqual([nextMessage]);
  });

  it('keeps a realtime delete over a deferred initial snapshot', async () => {
    const initialMessages = deferred<MessagePage>();
    messages.list.mockReturnValueOnce(initialMessages.promise);
    const { result } = renderHook(() => useConfiguredThread());

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );
    await act(async () => {
      initialMessages.resolve(
        page([
          message({ id: MESSAGE_1_ID }),
          message({
            id: MESSAGE_2_ID,
            createdAt: '2026-09-01T08:02:00.000Z',
          }),
        ])
      );
      await initialMessages.promise;
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((item) => item.id)).toEqual([MESSAGE_2_ID]);
  });

  it('keeps a realtime insert over a deferred initial snapshot', async () => {
    const initialMessages = deferred<MessagePage>();
    messages.list.mockReturnValueOnce(initialMessages.promise);
    messages.get.mockResolvedValueOnce(
      message({
        id: MESSAGE_0_ID,
        createdAt: '2026-09-01T08:00:00.000Z',
      })
    );
    const { result } = renderHook(() => useConfiguredThread());

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      })
    );
    await act(async () => {
      initialMessages.resolve(page([message({ id: MESSAGE_1_ID })]));
      await initialMessages.promise;
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_0_ID,
      MESSAGE_1_ID,
    ]);
  });

  it('keeps a realtime delete over a deferred resync snapshot', async () => {
    const resyncMessages = deferred<MessagePage>();
    messages.list
      .mockResolvedValueOnce(
        page([
          message({ id: MESSAGE_1_ID }),
          message({
            id: MESSAGE_2_ID,
            createdAt: '2026-09-01T08:02:00.000Z',
          }),
        ])
      )
      .mockReturnValueOnce(resyncMessages.promise);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => realtime.emitStatus('connected', 1));
    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );
    await act(async () => {
      resyncMessages.resolve(
        page([
          message({ id: MESSAGE_1_ID }),
          message({
            id: MESSAGE_2_ID,
            createdAt: '2026-09-01T08:02:00.000Z',
          }),
        ])
      );
      await resyncMessages.promise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual([MESSAGE_2_ID]);
  });

  it('keeps a realtime insert over a deferred resync snapshot', async () => {
    const resyncMessages = deferred<MessagePage>();
    messages.list
      .mockResolvedValueOnce(page([message({ id: MESSAGE_1_ID })]))
      .mockReturnValueOnce(resyncMessages.promise);
    messages.get.mockResolvedValueOnce(
      message({
        id: MESSAGE_2_ID,
        createdAt: '2026-09-01T08:02:00.000Z',
      })
    );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => realtime.emitStatus('connected', 1));
    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_2_ID,
      })
    );
    await waitFor(() =>
      expect(result.current.items.map((item) => item.id)).toEqual([
        MESSAGE_1_ID,
        MESSAGE_2_ID,
      ])
    );
    await act(async () => {
      resyncMessages.resolve(page([message({ id: MESSAGE_1_ID })]));
      await resyncMessages.promise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_1_ID,
      MESSAGE_2_ID,
    ]);
  });

  it('keeps a realtime delete over a deferred older-page snapshot', async () => {
    const older = deferred<MessagePage>();
    const cursor: MessageCursor = {
      createdAt: '2026-09-01T08:01:00.000Z',
      id: MESSAGE_1_ID,
    };
    messages.list
      .mockResolvedValueOnce(page([message({ id: MESSAGE_1_ID })], cursor))
      .mockReturnValueOnce(older.promise);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.loadOlder());
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );
    await act(async () => {
      older.resolve(
        page([
          message({
            id: MESSAGE_0_ID,
            createdAt: '2026-09-01T08:00:00.000Z',
          }),
          message({ id: MESSAGE_1_ID }),
        ])
      );
      await older.promise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual([MESSAGE_0_ID]);
  });

  it('preserves a realtime update when an older page overlaps its id', async () => {
    const older = deferred<MessagePage>();
    const cursor: MessageCursor = {
      createdAt: '2026-09-01T08:01:00.000Z',
      id: MESSAGE_1_ID,
    };
    messages.list
      .mockResolvedValueOnce(
        page([message({ id: MESSAGE_1_ID, status: 'delivered' })], cursor)
      )
      .mockReturnValueOnce(older.promise);
    messages.get.mockResolvedValueOnce(
      message({ id: MESSAGE_1_ID, senderType: 'agent', status: 'read' })
    );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.loadOlder());
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );
    await waitFor(() => expect(result.current.items[0]?.status).toBe('read'));
    await act(async () => {
      older.resolve(
        page([
          message({
            id: MESSAGE_0_ID,
            createdAt: '2026-09-01T08:00:00.000Z',
          }),
          message({ id: MESSAGE_1_ID, status: 'delivered' }),
        ])
      );
      await older.promise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_0_ID,
      MESSAGE_1_ID,
    ]);
    expect(result.current.items[1]?.status).toBe('read');
  });

  it('invalidates old feed work and refreshes from a higher replacement snapshot', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    await secondFeed.emitStatus('connected', 4);
    const firstConversation = deferred<InboxConversation>();
    const firstMessages = deferred<MessagePage>();
    const freshConversation = conversation({ status: 'pending' });
    const freshMessage = message({ id: MESSAGE_3_ID });
    conversations.get
      .mockReturnValueOnce(firstConversation.promise)
      .mockResolvedValueOnce(freshConversation);
    messages.list
      .mockReturnValueOnce(firstMessages.promise)
      .mockResolvedValueOnce(page([freshMessage]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { realtime: InboxRealtimeFeed }
    >(
      ({ realtime: currentFeed }) =>
        useConfiguredThread({ realtime: currentFeed }),
      {
        initialProps: { realtime: firstFeed },
      }
    );

    rerender({ realtime: secondFeed });
    await act(async () => {
      firstConversation.resolve(conversation());
      firstMessages.resolve(page([message({ id: MESSAGE_1_ID })]));
      await Promise.all([firstConversation.promise, firstMessages.promise]);
    });

    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.conversation).toEqual(freshConversation)
    );
    expect(result.current.items).toEqual([freshMessage]);
    expect(result.current.connection).toBe('connected');
  });

  it('invalidates pagination, hydrate, header, and unread work from a replaced feed', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    const older = deferred<MessagePage>();
    const hydrate = deferred<InboxMessage>();
    const header = deferred<InboxConversation>();
    const clear = deferred<void>();
    const cursor: MessageCursor = {
      createdAt: '2026-09-01T08:01:00.000Z',
      id: MESSAGE_1_ID,
    };
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockReturnValueOnce(header.promise);
    conversations.markRead.mockReturnValueOnce(clear.promise);
    messages.list
      .mockResolvedValueOnce(page([message({ id: MESSAGE_1_ID })], cursor))
      .mockReturnValueOnce(older.promise);
    messages.get.mockReturnValueOnce(hydrate.promise);
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { realtime: InboxRealtimeFeed }
    >(
      ({ realtime: currentFeed }) =>
        useConfiguredThread({ realtime: currentFeed }),
      {
        initialProps: { realtime: firstFeed },
      }
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.loadOlder());
    await act(async () => {
      await firstFeed.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_3_ID,
      });
      await firstFeed.emit({
        table: 'conversations',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      });
    });
    rerender({ realtime: secondFeed });
    await act(async () => {
      older.resolve(page([message({ id: MESSAGE_0_ID })]));
      hydrate.resolve(message({ id: MESSAGE_3_ID }));
      header.resolve(conversation({ status: 'closed' }));
      clear.reject(new Error('Denied'));
      await Promise.all([
        older.promise,
        hydrate.promise,
        header.promise,
        clear.promise.catch(() => undefined),
      ]);
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([message({ id: MESSAGE_1_ID })]);
    expect(result.current.conversation).toEqual(conversation());
    expect(result.current.unreadWarning).toBeNull();
    expect(result.current.loadingOlder).toBe(false);
  });

  it('allows replacement-feed pagination before the invalidated page settles', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    const oldPage = deferred<MessagePage>();
    const freshPage = deferred<MessagePage>();
    const cursor: MessageCursor = {
      createdAt: '2026-09-01T08:01:00.000Z',
      id: MESSAGE_1_ID,
    };
    messages.list
      .mockResolvedValueOnce(page([message({ id: MESSAGE_1_ID })], cursor))
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(freshPage.promise);
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { realtime: InboxRealtimeFeed }
    >(
      ({ realtime: currentFeed }) =>
        useConfiguredThread({ realtime: currentFeed }),
      {
        initialProps: { realtime: firstFeed },
      }
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.loadOlder());
    rerender({ realtime: secondFeed });
    await waitFor(() => expect(result.current.loadingOlder).toBe(false));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(3));

    await act(async () => {
      freshPage.resolve(
        page([
          message({
            id: MESSAGE_0_ID,
            createdAt: '2026-09-01T08:00:00.000Z',
          }),
        ])
      );
      await freshPage.promise;
    });
    await act(async () => {
      oldPage.resolve(page([message({ id: MESSAGE_2_ID })]));
      await oldPage.promise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_0_ID,
      MESSAGE_1_ID,
    ]);
  });

  it('ignores old-feed callbacks fired during replacement render', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    let firedOldCallbacks = false;
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { realtime: InboxRealtimeFeed; fireOldCallbacks: boolean }
    >(
      ({ realtime: currentFeed, fireOldCallbacks }) => {
        const thread = useConfiguredThread({ realtime: currentFeed });
        if (fireOldCallbacks && !firedOldCallbacks) {
          firedOldCallbacks = true;
          void firstFeed.emit({
            table: 'conversations',
            eventType: 'DELETE',
            accountId: BRANCH_ID,
            conversationId: CONVERSATION_ID,
            messageId: null,
          });
          void firstFeed.emit({
            table: 'messages',
            eventType: 'DELETE',
            accountId: BRANCH_ID,
            conversationId: CONVERSATION_ID,
            messageId: MESSAGE_1_ID,
          });
          void firstFeed.emitStatus('disconnected', 99);
        }
        return thread;
      },
      {
        initialProps: { realtime: firstFeed, fireOldCallbacks: false },
      }
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const initialItems = result.current.items;
    messages.list.mockRejectedValueOnce(new Error('stale status refresh'));

    rerender({ realtime: secondFeed, fireOldCallbacks: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.items).toEqual(initialItems);
    expect(result.current.connection).toBe('connected');
    expect(messages.list).toHaveBeenCalledTimes(1);
  });

  it('restarts an interrupted main load after its owner clears during replacement render', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    const oldConversation = deferred<InboxConversation>();
    const oldMessages = deferred<MessagePage>();
    const freshConversation = conversation({ status: 'pending' });
    const freshMessage = message({ id: MESSAGE_3_ID });
    conversations.get
      .mockReturnValueOnce(oldConversation.promise)
      .mockResolvedValueOnce(freshConversation);
    messages.list
      .mockReturnValueOnce(oldMessages.promise)
      .mockResolvedValueOnce(page([freshMessage]));
    const replacementCommit = deferred<void>();
    function SuspenseBoundary({ children }: { children: ReactNode }) {
      return <Suspense fallback={null}>{children}</Suspense>;
    }
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      {
        realtime: InboxRealtimeFeed;
        holdReplacement: boolean;
        renderTick: number;
      }
    >(
      ({ realtime: currentFeed, holdReplacement }) => {
        const thread = useConfiguredThread({ realtime: currentFeed });
        if (holdReplacement) throw replacementCommit.promise;
        return thread;
      },
      {
        initialProps: {
          realtime: firstFeed,
          holdReplacement: false,
          renderTick: 0,
        },
        wrapper: SuspenseBoundary,
      }
    );
    expect(messages.list).toHaveBeenCalledTimes(1);

    rerender({
      realtime: secondFeed,
      holdReplacement: true,
      renderTick: 1,
    });
    await act(async () => {
      oldConversation.resolve(conversation());
      oldMessages.resolve(page([message({ id: MESSAGE_1_ID })]));
      await Promise.all([oldConversation.promise, oldMessages.promise]);
      await Promise.resolve();
    });
    expect(messages.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      replacementCommit.resolve();
      rerender({
        realtime: secondFeed,
        holdReplacement: false,
        renderTick: 2,
      });
      await replacementCommit.promise;
    });

    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.conversation).toEqual(freshConversation);
    expect(result.current.items).toEqual([freshMessage]);

    rerender({
      realtime: secondFeed,
      holdReplacement: false,
      renderTick: 3,
    });
    await act(async () => Promise.resolve());
    expect(messages.list).toHaveBeenCalledTimes(2);
  });

  it('transfers a suspended replacement reload to a newer equal-generation feed', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    const thirdFeed = fakeThreadRealtimeFeed();
    const oldConversation = deferred<InboxConversation>();
    const oldMessages = deferred<MessagePage>();
    const freshConversation = conversation({ status: 'pending' });
    const freshMessage = message({ id: MESSAGE_3_ID });
    conversations.get
      .mockReturnValueOnce(oldConversation.promise)
      .mockResolvedValueOnce(freshConversation);
    messages.list
      .mockReturnValueOnce(oldMessages.promise)
      .mockResolvedValueOnce(page([freshMessage]));
    const suspendedReplacement = deferred<void>();
    function SuspenseBoundary({ children }: { children: ReactNode }) {
      return <Suspense fallback={null}>{children}</Suspense>;
    }
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { realtime: InboxRealtimeFeed; suspend: boolean }
    >(
      ({ realtime: currentFeed, suspend }) => {
        const thread = useConfiguredThread({ realtime: currentFeed });
        if (suspend) throw suspendedReplacement.promise;
        return thread;
      },
      {
        initialProps: { realtime: firstFeed, suspend: false },
        wrapper: SuspenseBoundary,
      }
    );
    expect(messages.list).toHaveBeenCalledTimes(1);

    rerender({ realtime: secondFeed, suspend: true });
    await act(async () => {
      oldConversation.resolve(conversation());
      oldMessages.resolve(page([message({ id: MESSAGE_1_ID })]));
      await Promise.all([oldConversation.promise, oldMessages.promise]);
      await Promise.resolve();
    });
    expect(messages.list).toHaveBeenCalledTimes(1);

    rerender({ realtime: thirdFeed, suspend: false });

    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.conversation).toEqual(freshConversation);
    expect(result.current.items).toEqual([freshMessage]);
  });

  it('transfers reload intent when its replacement effect is disposed before publication', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    const thirdFeed = fakeThreadRealtimeFeed();
    const oldConversation = deferred<InboxConversation>();
    const oldMessages = deferred<MessagePage>();
    const freshConversation = conversation({ status: 'closed' });
    const freshMessage = message({ id: MESSAGE_3_ID });
    conversations.get
      .mockReturnValueOnce(oldConversation.promise)
      .mockResolvedValueOnce(freshConversation);
    messages.list
      .mockReturnValueOnce(oldMessages.promise)
      .mockResolvedValueOnce(page([freshMessage]));
    const suspendedReplacement = deferred<void>();
    function SuspenseBoundary({ children }: { children: ReactNode }) {
      return <Suspense fallback={null}>{children}</Suspense>;
    }
    const { result, rerender } = renderHook<
      { thread: UseMessageThreadResult; realtime: InboxRealtimeFeed },
      {
        requestedFeed: InboxRealtimeFeed;
        suspend: boolean;
        supersede: boolean;
      }
    >(
      ({ requestedFeed, suspend, supersede }) => {
        const [overrideFeed, setOverrideFeed] =
          useState<InboxRealtimeFeed | null>(null);
        const currentFeed = overrideFeed ?? requestedFeed;
        const thread = useConfiguredThread({ realtime: currentFeed });
        useEffect(() => {
          if (supersede && currentFeed === secondFeed) {
            setOverrideFeed(thirdFeed);
          }
        }, [currentFeed, supersede]);
        if (suspend && currentFeed === secondFeed) {
          throw suspendedReplacement.promise;
        }
        return { thread, realtime: currentFeed };
      },
      {
        initialProps: {
          requestedFeed: firstFeed,
          suspend: false,
          supersede: false,
        },
        wrapper: SuspenseBoundary,
      }
    );
    expect(messages.list).toHaveBeenCalledTimes(1);

    rerender({
      requestedFeed: secondFeed,
      suspend: true,
      supersede: false,
    });
    await act(async () => {
      oldConversation.resolve(conversation());
      oldMessages.resolve(page([message({ id: MESSAGE_1_ID })]));
      await Promise.all([oldConversation.promise, oldMessages.promise]);
      await Promise.resolve();
    });
    expect(messages.list).toHaveBeenCalledTimes(1);

    rerender({
      requestedFeed: secondFeed,
      suspend: false,
      supersede: true,
    });

    await waitFor(() => expect(result.current.realtime).toBe(thirdFeed));
    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.thread.status).toBe('ready'));
    expect(result.current.thread.conversation).toEqual(freshConversation);
    expect(result.current.thread.items).toEqual([freshMessage]);
  });

  it('keeps an unacknowledged resync refresh when its observing feed is disposed', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    const thirdFeed = fakeThreadRealtimeFeed();
    await secondFeed.emitStatus('connected', 7);
    await thirdFeed.emitStatus('connected', 7);
    const initialConversation = conversation({ status: 'open' });
    const initialMessage = message({ id: MESSAGE_1_ID });
    const freshConversation = conversation({ status: 'pending' });
    const freshMessage = message({ id: MESSAGE_3_ID });
    conversations.get
      .mockResolvedValueOnce(initialConversation)
      .mockResolvedValueOnce(freshConversation);
    messages.list
      .mockResolvedValueOnce(page([initialMessage]))
      .mockResolvedValueOnce(page([freshMessage]));
    const { result, rerender } = renderHook<
      { thread: UseMessageThreadResult; realtime: InboxRealtimeFeed },
      { requestedFeed: InboxRealtimeFeed; supersede: boolean }
    >(
      ({ requestedFeed, supersede }) => {
        const [overrideFeed, setOverrideFeed] =
          useState<InboxRealtimeFeed | null>(null);
        const currentFeed = overrideFeed ?? requestedFeed;
        const thread = useConfiguredThread({ realtime: currentFeed });
        useEffect(() => {
          if (supersede && currentFeed === secondFeed) {
            setOverrideFeed(thirdFeed);
          }
        }, [currentFeed, supersede]);
        return { thread, realtime: currentFeed };
      },
      {
        initialProps: { requestedFeed: firstFeed, supersede: false },
      }
    );
    await waitFor(() => expect(result.current.thread.status).toBe('ready'));
    expect(result.current.thread.conversation).toEqual(initialConversation);
    expect(messages.list).toHaveBeenCalledTimes(1);

    rerender({ requestedFeed: secondFeed, supersede: true });

    await waitFor(() => expect(result.current.realtime).toBe(thirdFeed));
    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.thread.status).toBe('ready'));
    expect(result.current.thread.conversation).toEqual(freshConversation);
    expect(result.current.thread.items).toEqual([freshMessage]);
  });

  it('lets a simultaneous scope load subsume replacement-feed reload intent', async () => {
    const firstFeed = fakeThreadRealtimeFeed();
    const secondFeed = fakeThreadRealtimeFeed();
    const oldConversation = deferred<InboxConversation>();
    const oldMessages = deferred<MessagePage>();
    const freshConversation = conversation({
      id: OTHER_CONVERSATION_ID,
      accountId: OTHER_BRANCH_ID,
      status: 'pending',
    });
    const freshMessage = message({
      id: MESSAGE_3_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    conversations.get
      .mockReturnValueOnce(oldConversation.promise)
      .mockResolvedValue(freshConversation);
    messages.list
      .mockReturnValueOnce(oldMessages.promise)
      .mockResolvedValue(page([freshMessage]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      {
        accountId: string;
        conversationId: string;
        realtime: InboxRealtimeFeed;
      }
    >(
      ({ accountId, conversationId, realtime: currentFeed }) =>
        useConfiguredThread({
          accountId,
          conversationId,
          realtime: currentFeed,
        }),
      {
        initialProps: {
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
          realtime: firstFeed,
        },
      }
    );
    expect(messages.list).toHaveBeenCalledTimes(1);

    rerender({
      accountId: OTHER_BRANCH_ID,
      conversationId: OTHER_CONVERSATION_ID,
      realtime: secondFeed,
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.conversation).toEqual(freshConversation);
    expect(result.current.items).toEqual([freshMessage]);
    expect(messages.list).toHaveBeenCalledTimes(2);

    await act(async () => {
      oldConversation.resolve(conversation());
      oldMessages.resolve(page([message({ id: MESSAGE_1_ID })]));
      await Promise.all([oldConversation.promise, oldMessages.promise]);
    });
    expect(messages.list).toHaveBeenCalledTimes(2);
  });

  it('lets conversation delete beat a pending header refresh', async () => {
    const header = deferred<InboxConversation>();
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockReturnValueOnce(header.promise);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    await act(async () => {
      header.resolve(conversation({ status: 'closed' }));
      await header.promise;
    });

    expect(result.current.status).toBe('unavailable');
    expect(result.current.conversation).toBeNull();
  });

  it('keeps the newest header refresh when two complete out of order', async () => {
    const firstHeader = deferred<InboxConversation>();
    const secondHeader = deferred<InboxConversation>();
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockReturnValueOnce(firstHeader.promise)
      .mockReturnValueOnce(secondHeader.promise);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const headerEvent: InboxRealtimeEvent = {
      table: 'conversations',
      eventType: 'UPDATE',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: null,
    };

    await act(async () => {
      await realtime.emit(headerEvent);
      await realtime.emit(headerEvent);
    });
    await act(async () => {
      secondHeader.resolve(conversation({ status: 'pending' }));
      await secondHeader.promise;
    });
    await waitFor(() =>
      expect(result.current.conversation?.status).toBe('pending')
    );
    await act(async () => {
      firstHeader.resolve(conversation({ status: 'closed' }));
      await firstHeader.promise;
    });

    expect(result.current.conversation?.status).toBe('pending');
  });

  it('removes both local realtime listeners on cleanup', async () => {
    const { result, unmount } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    unmount();

    expect(realtime.eventCleanup).toHaveBeenCalledTimes(1);
    expect(realtime.statusCleanup).toHaveBeenCalledTimes(1);
  });

  describe('outbound text commands', () => {
    const senderId = '30250c1e-ee34-4af5-8752-2ad170d65713';
    const temporaryId = 'temp:hook-one';
    const createdAt = '2026-09-01T08:03:00.000Z';
    const acknowledgement: MobileSendResult = {
      messageId: MESSAGE_3_ID,
      whatsappMessageId: 'wamid.hook-one',
    };

    function outbound(
      sendMessage: jest.Mock<
        Promise<MobileSendResult>,
        [MobileSendInput, MobileSendDependencies]
      >
    ) {
      return {
        senderId,
        recoverUnauthorizedSession: jest.fn().mockResolvedValue(undefined),
        sendMessage,
        createTemporaryId: () => temporaryId,
        now: () => createdAt,
      };
    }

    it('appends immediately, sends once, and reconciles the acknowledgement', async () => {
      const pending = deferred<MobileSendResult>();
      const sendMessage = jest.fn<
        Promise<MobileSendResult>,
        [MobileSendInput, MobileSendDependencies]
      >(() => pending.promise);
      const dependencies = outbound(sendMessage);
      const { result } = renderHook(() =>
        useConfiguredThread({ outbound: dependencies })
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let attempt!: Promise<{ temporaryId: string; status: 'sent' | 'failed' }>;
      act(() => {
        attempt = result.current.sendText('  See you tomorrow  ');
      });

      expect(result.current.items.at(-1)).toEqual(
        expect.objectContaining({
          id: temporaryId,
          contentText: 'See you tomorrow',
          status: 'sending',
        })
      );
      expect(sendMessage).toHaveBeenCalledWith(
        {
          kind: 'text',
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
          text: 'See you tomorrow',
        },
        {
          recoverUnauthorizedSession: dependencies.recoverUnauthorizedSession,
        }
      );

      await act(async () => {
        pending.resolve(acknowledgement);
        await attempt;
      });
      expect(await attempt).toEqual({ temporaryId, status: 'sent' });
      expect(
        result.current.items.filter((item) => item.id === MESSAGE_3_ID)
      ).toHaveLength(1);
      expect(result.current.items.at(-1)).toEqual(
        expect.objectContaining({
          id: MESSAGE_3_ID,
          providerMessageId: 'wamid.hook-one',
          status: 'sent',
        })
      );
    });

    it('keeps an ambiguous failure visible but refuses to execute Retry', async () => {
      const sendMessage = jest
        .fn<
          Promise<MobileSendResult>,
          [MobileSendInput, MobileSendDependencies]
        >()
        .mockRejectedValue(
          new MobileSendError('network', 'Could not reach the send service.')
        );
      const { result } = renderHook(() =>
        useConfiguredThread({ outbound: outbound(sendMessage) })
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let attempt!: { temporaryId: string; status: 'sent' | 'failed' };
      await act(async () => {
        attempt = await result.current.sendText('Keep this draft');
      });

      expect(attempt).toEqual({
        temporaryId,
        status: 'failed',
        safeToRetry: false,
        message:
          'Could not reach the send service. Delivery could not be confirmed. Check the conversation before sending again.',
      });
      expect(result.current.items.at(-1)).toEqual(
        expect.objectContaining({
          id: temporaryId,
          contentText: 'Keep this draft',
          status: 'failed',
          safeToRetry: false,
        })
      );

      await act(async () => {
        await result.current.retryText(temporaryId);
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('retries a definitely rejected temporary row without appending another row', async () => {
      const retry = deferred<MobileSendResult>();
      const sendMessage = jest
        .fn<
          Promise<MobileSendResult>,
          [MobileSendInput, MobileSendDependencies]
        >()
        .mockRejectedValueOnce(
          new MobileSendError('rate_limited', 'Too many send attempts.')
        )
        .mockReturnValueOnce(retry.promise);
      const { result } = renderHook(() =>
        useConfiguredThread({ outbound: outbound(sendMessage) })
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));
      await act(async () => {
        await result.current.sendText('Retry me');
      });

      let retryAttempt!: Promise<{
        temporaryId: string;
        status: 'sent' | 'failed';
      }>;
      act(() => {
        retryAttempt = result.current.retryText(temporaryId);
      });
      expect(
        result.current.items.filter((item) => item.contentText === 'Retry me')
      ).toHaveLength(1);
      expect(result.current.items.at(-1)?.status).toBe('sending');

      await act(async () => {
        retry.resolve(acknowledgement);
        await retryAttempt;
      });
      expect(await retryAttempt).toEqual({ temporaryId, status: 'sent' });
      expect(
        result.current.items.filter((item) => item.contentText === 'Retry me')
      ).toHaveLength(1);
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    it('reconciles realtime before API acknowledgement and patches the same row', async () => {
      messages.list.mockResolvedValueOnce(page([]));
      const pending = deferred<MobileSendResult>();
      const sendMessage = jest.fn<
        Promise<MobileSendResult>,
        [MobileSendInput, MobileSendDependencies]
      >(() => pending.promise);
      messages.get.mockResolvedValue(
        message({
          id: MESSAGE_3_ID,
          senderType: 'agent',
          senderId,
          contentText: 'Race me',
          providerMessageId: 'wamid.hook-one',
          status: 'delivered',
          createdAt,
        })
      );
      const { result } = renderHook(() =>
        useConfiguredThread({ outbound: outbound(sendMessage) })
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));
      let attempt!: Promise<{ temporaryId: string; status: 'sent' | 'failed' }>;
      act(() => {
        attempt = result.current.sendText('Race me');
      });
      await act(async () =>
        realtime.emit({
          table: 'messages',
          eventType: 'INSERT',
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_3_ID,
        })
      );
      await waitFor(() => expect(result.current.items).toHaveLength(2));

      await act(async () => {
        pending.resolve(acknowledgement);
        await attempt;
      });
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].status).toBe('delivered');

      messages.get.mockResolvedValueOnce(
        message({
          ...result.current.items[0],
          status: 'read',
        })
      );
      await act(async () =>
        realtime.emit({
          table: 'messages',
          eventType: 'UPDATE',
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_3_ID,
        })
      );
      await waitFor(() => expect(result.current.items[0].status).toBe('read'));
      expect(result.current.items).toHaveLength(1);
    });

    it('reconciles API acknowledgement before duplicate realtime inserts', async () => {
      messages.list.mockResolvedValueOnce(page([]));
      const sendMessage = jest
        .fn<
          Promise<MobileSendResult>,
          [MobileSendInput, MobileSendDependencies]
        >()
        .mockResolvedValue(acknowledgement);
      messages.get.mockResolvedValue(
        message({
          id: MESSAGE_3_ID,
          senderType: 'agent',
          senderId,
          contentText: 'API first',
          providerMessageId: 'wamid.hook-one',
          status: 'delivered',
          createdAt,
        })
      );
      const { result } = renderHook(() =>
        useConfiguredThread({ outbound: outbound(sendMessage) })
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));
      await act(async () => {
        await result.current.sendText('API first');
      });

      const insert: InboxRealtimeEvent = {
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_3_ID,
      };
      await act(async () => {
        await realtime.emit(insert);
        await realtime.emit(insert);
      });
      await waitFor(() =>
        expect(result.current.items[0].status).toBe('delivered')
      );
      expect(result.current.items).toHaveLength(1);
    });

    it('admits an update through a noncanonical persisted ID alias', async () => {
      messages.list.mockResolvedValueOnce(page([]));
      messages.get
        .mockResolvedValueOnce(
          message({
            id: MESSAGE_1_ID,
            senderType: 'agent',
            senderId,
            providerMessageId: 'wamid.shared-alias',
            status: 'sent',
          })
        )
        .mockResolvedValueOnce(
          message({
            id: MESSAGE_2_ID,
            senderType: 'agent',
            senderId,
            providerMessageId: 'wamid.shared-alias',
            status: 'delivered',
          })
        )
        .mockResolvedValueOnce(
          message({
            id: MESSAGE_2_ID,
            senderType: 'agent',
            senderId,
            providerMessageId: 'wamid.shared-alias',
            status: 'read',
          })
        );
      const { result } = renderHook(() => useConfiguredThread());
      await waitFor(() => expect(result.current.status).toBe('ready'));

      await act(async () => {
        await realtime.emit({
          table: 'messages',
          eventType: 'INSERT',
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_1_ID,
        });
        await realtime.emit({
          table: 'messages',
          eventType: 'INSERT',
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_2_ID,
        });
      });
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      expect(result.current.items[0].status).toBe('delivered');

      await act(async () =>
        realtime.emit({
          table: 'messages',
          eventType: 'UPDATE',
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_2_ID,
        })
      );

      await waitFor(() => expect(result.current.items[0].status).toBe('read'));
      expect(result.current.items).toHaveLength(1);
      expect(messages.get).toHaveBeenCalledTimes(3);
    });

    it('coalesces overlapping retries for the same temporary row', async () => {
      const retry = deferred<MobileSendResult>();
      const sendMessage = jest
        .fn<
          Promise<MobileSendResult>,
          [MobileSendInput, MobileSendDependencies]
        >()
        .mockRejectedValueOnce(
          new MobileSendError('rate_limited', 'Too many send attempts.')
        )
        .mockReturnValueOnce(retry.promise);
      const { result } = renderHook(() =>
        useConfiguredThread({ outbound: outbound(sendMessage) })
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));
      await act(async () => {
        await result.current.sendText('Retry only once');
      });

      let first!: Promise<{ temporaryId: string; status: 'sent' | 'failed' }>;
      let second!: Promise<{ temporaryId: string; status: 'sent' | 'failed' }>;
      act(() => {
        first = result.current.retryText(temporaryId);
        second = result.current.retryText(temporaryId);
      });

      expect(second).toBe(first);
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(
        result.current.items.filter(
          (item) => item.contentText === 'Retry only once'
        )
      ).toEqual([expect.objectContaining({ status: 'sending' })]);

      await act(async () => {
        retry.resolve(acknowledgement);
        await Promise.all([first, second]);
      });
      expect(
        result.current.items.filter(
          (item) => item.contentText === 'Retry only once'
        )
      ).toEqual([expect.objectContaining({ status: 'sent' })]);
    });

    it('does not let a late rejection downgrade a newer acknowledged attempt', async () => {
      messages.list.mockResolvedValueOnce(page([]));
      const first = deferred<MobileSendResult>();
      const sendMessage = jest
        .fn<
          Promise<MobileSendResult>,
          [MobileSendInput, MobileSendDependencies]
        >()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(acknowledgement);
      const dependencies = outbound(sendMessage);
      const { result } = renderHook(() =>
        useConfiguredThread({ outbound: dependencies })
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let older!: Promise<{ temporaryId: string; status: 'sent' | 'failed' }>;
      act(() => {
        older = result.current.sendText('Same temporary row');
      });
      await act(async () => {
        await result.current.sendText('Same temporary row');
      });
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].status).toBe('sent');

      await act(async () => {
        first.reject(new Error('late network failure'));
        await older;
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].status).toBe('sent');
      expect(result.current.items[0].providerErrorTitle).toBeNull();
    });

    it('does not publish an old branch send completion', async () => {
      messages.list
        .mockResolvedValueOnce(page([]))
        .mockResolvedValueOnce(page([]));
      conversations.get
        .mockResolvedValueOnce(conversation())
        .mockResolvedValueOnce(
          conversation({
            id: OTHER_CONVERSATION_ID,
            accountId: OTHER_BRANCH_ID,
          })
        );
      const pending = deferred<MobileSendResult>();
      const sendMessage = jest.fn<
        Promise<MobileSendResult>,
        [MobileSendInput, MobileSendDependencies]
      >(() => pending.promise);
      const dependencies = outbound(sendMessage);
      const { result, rerender } = renderHook<
        UseMessageThreadResult,
        { accountId: string; conversationId: string }
      >(
        ({ accountId, conversationId }) =>
          useConfiguredThread({
            accountId,
            conversationId,
            outbound: dependencies,
          }),
        {
          initialProps: {
            accountId: BRANCH_ID,
            conversationId: CONVERSATION_ID,
          },
        }
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));
      let attempt!: Promise<{ temporaryId: string; status: 'sent' | 'failed' }>;
      act(() => {
        attempt = result.current.sendText('Old branch');
      });

      rerender({
        accountId: OTHER_BRANCH_ID,
        conversationId: OTHER_CONVERSATION_ID,
      });
      await waitFor(() => expect(result.current.status).toBe('ready'));
      await act(async () => {
        pending.resolve(acknowledgement);
        await attempt;
      });
      expect(result.current.items).toEqual([]);
    });

    it('does not publish a send completion owned by a replaced feed', async () => {
      messages.list.mockResolvedValue(page([]));
      const pending = deferred<MobileSendResult>();
      const sendMessage = jest.fn<
        Promise<MobileSendResult>,
        [MobileSendInput, MobileSendDependencies]
      >(() => pending.promise);
      const dependencies = outbound(sendMessage);
      const firstFeed = realtime;
      const secondFeed = fakeThreadRealtimeFeed();
      const { result, rerender } = renderHook<
        UseMessageThreadResult,
        { currentFeed: InboxRealtimeFeed }
      >(
        ({ currentFeed }) =>
          useConfiguredThread({
            realtime: currentFeed,
            outbound: dependencies,
          }),
        { initialProps: { currentFeed: firstFeed } }
      );
      await waitFor(() => expect(result.current.status).toBe('ready'));
      let attempt!: Promise<{ temporaryId: string; status: 'sent' | 'failed' }>;
      act(() => {
        attempt = result.current.sendText('Old feed');
      });

      rerender({ currentFeed: secondFeed });
      await waitFor(() => expect(firstFeed.eventCleanup).toHaveBeenCalled());
      await act(async () => {
        pending.resolve(acknowledgement);
        await attempt;
      });
      expect(result.current.items).toEqual([
        expect.objectContaining({ id: temporaryId, status: 'sending' }),
      ]);
    });
  });
});
