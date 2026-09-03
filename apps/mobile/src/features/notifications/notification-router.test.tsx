import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';

import type { AuthState } from '../auth/auth-context';
import {
  NotificationRouter,
  createNotificationResponseRouter,
} from './notification-router';

const destination = {
  version: 1 as const,
  accountId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  deliveryId: '44444444-4444-4444-8444-444444444444',
};

const response = (data = destination) => ({
  notification: { request: { content: { data } } },
});

function ready(
  accountId = destination.accountId
): Extract<AuthState, { status: 'ready' }> {
  return {
    status: 'ready',
    session: {} as never,
    profile: {} as never,
    account: {} as never,
    branch: { account_id: accountId } as never,
    branches: [
      { account_id: destination.accountId, branch_status: 'active' },
      {
        account_id: '55555555-5555-4555-8555-555555555555',
        branch_status: 'active',
      },
    ] as never,
  };
}

function setup() {
  const deps = {
    selectBranch: jest.fn().mockResolvedValue(undefined),
    getConversation: jest
      .fn()
      .mockResolvedValue({ id: destination.conversationId }),
    replaceInbox: jest.fn(),
    openConversation: jest.fn(),
    showUnavailable: jest.fn(),
    timeoutMs: 50,
  };
  return { deps, router: createNotificationResponseRouter(deps) };
}

describe('notification response router', () => {
  it('waits for auth and opens the exact conversation in the selected branch', async () => {
    const { deps, router } = setup();
    router.enqueue(response());

    await router.reconcile({ status: 'booting' });
    expect(deps.getConversation).not.toHaveBeenCalled();

    await router.reconcile(ready());
    expect(deps.getConversation).toHaveBeenCalledWith(
      destination.accountId,
      destination.conversationId
    );
    expect(deps.replaceInbox).toHaveBeenCalledTimes(1);
    expect(deps.openConversation).toHaveBeenCalledWith(
      destination.conversationId
    );
  });

  it('switches branch and waits for fresh ready auth before reading', async () => {
    const { deps, router } = setup();
    router.enqueue(response());

    await router.reconcile(ready('55555555-5555-4555-8555-555555555555'));

    expect(deps.selectBranch).toHaveBeenCalledWith(destination.accountId);
    expect(deps.getConversation).not.toHaveBeenCalled();

    await router.reconcile(ready());
    expect(deps.getConversation).toHaveBeenCalledTimes(1);
  });

  it('keeps at most the latest pending destination and deduplicates delivery ids', async () => {
    const { deps, router } = setup();
    const later = {
      ...destination,
      conversationId: '66666666-6666-4666-8666-666666666666',
      deliveryId: '77777777-7777-4777-8777-777777777777',
    };
    router.enqueue(response());
    router.enqueue(response(later));
    await router.reconcile(ready());
    router.enqueue(response(later));
    await router.reconcile(ready());

    expect(deps.openConversation).toHaveBeenCalledTimes(1);
    expect(deps.openConversation).toHaveBeenCalledWith(later.conversationId);
  });

  it.each(['archived branch', 'unreadable conversation', 'timeout'])(
    'fails closed to Inbox for %s',
    async (scenario) => {
      jest.useFakeTimers();
      const { deps, router } = setup();
      router.enqueue(response());
      let state = ready();
      if (scenario === 'archived branch') {
        state = {
          ...state,
          branches: [
            { account_id: destination.accountId, branch_status: 'archived' },
          ] as never,
        };
      } else if (scenario === 'unreadable conversation') {
        deps.getConversation.mockRejectedValueOnce(new Error('RLS details'));
      } else {
        deps.getConversation.mockReturnValueOnce(new Promise(() => {}));
      }

      const reconciling = router.reconcile(state);
      await jest.advanceTimersByTimeAsync(51);
      await reconciling;

      expect(deps.openConversation).not.toHaveBeenCalled();
      expect(deps.replaceInbox).toHaveBeenCalledTimes(1);
      expect(deps.showUnavailable).toHaveBeenCalledWith(
        'This conversation is no longer available.'
      );
      jest.useRealTimers();
    }
  );
});

const mocks = {
  auth: { state: { status: 'booting' } as AuthState, selectBranch: jest.fn() },
  push: jest.fn(),
  replace: jest.fn(),
  responseListener: null as null | ((value: unknown) => void),
  remove: jest.fn(),
  lastResponse: null as unknown,
};

jest.mock('../auth/auth-context', () => ({
  useAuth: () => mocks.auth,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
jest.mock('../../native/notifications', () => ({
  nativeNotifications: {
    addNotificationResponseListener: (listener: (value: unknown) => void) => {
      mocks.responseListener = listener;
      return { remove: mocks.remove };
    },
    getLastNotificationResponse: async () => mocks.lastResponse,
  },
}));
jest.mock('../inbox/conversation-repository', () => ({
  mobileConversationRepository: { get: jest.fn().mockResolvedValue({}) },
}));

describe('NotificationRouter component', () => {
  it('subscribes to foreground/background and cold-start responses and cleans up', async () => {
    mocks.lastResponse = response();
    const view = render(
      <View>
        <NotificationRouter />
      </View>
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.responseListener).not.toBeNull();
    await act(async () => {
      mocks.responseListener?.(response());
    });
    view.unmount();

    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
