import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import type { AuthContextValue } from '../auth/auth-context';
import type { NotificationSnapshot } from './notification-types';
import {
  NotificationsProvider,
  type NotificationsContextValue,
  useNotifications,
} from './notifications-context';

const mocks = {
  auth: { state: { status: 'booting' } } as AuthContextValue,
};

jest.mock('../../native/notifications', () => ({ nativeNotifications: {} }));
jest.mock('../auth/auth-context', () => ({
  useAuth: () => mocks.auth,
}));

function readyAuth(): AuthContextValue {
  return {
    state: {
      status: 'ready',
      session: {
        access_token: 'access-1',
        user: { id: 'user-1' },
      } as never,
      profile: {} as never,
      branches: [{ account_id: 'branch-1' }] as never,
      branch: { account_id: 'branch-1' } as never,
      account: {} as never,
    },
    signInWithPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    recoverUnauthorizedSession: jest.fn(),
    selectBranch: jest.fn(),
  };
}

function createSetup() {
  let snapshot: NotificationSnapshot = {
    status: 'checking',
    canRequest: false,
    shouldExplain: false,
    message: 'Checking notification access…',
    recoveryAction: null,
  };
  const subscribers = new Set<() => void>();
  const coordinator = {
    start: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    requestPermission: jest.fn().mockResolvedValue(undefined),
    revoke: jest.fn().mockResolvedValue(undefined),
    openSettings: jest.fn().mockResolvedValue(undefined),
    markExplanationShown: jest.fn().mockResolvedValue(undefined),
    getSnapshot: jest.fn(() => snapshot),
    subscribe: jest.fn((listener: () => void) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    }),
    whenIdle: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
  };
  let appStateListener: ((state: string) => void) | null = null;
  const removeAppState = jest.fn();
  const appState = {
    addEventListener: jest.fn(
      (_event: 'change', listener: (state: string) => void) => {
        appStateListener = listener;
        return { remove: removeAppState };
      }
    ),
  };
  let promptActions: { onNotNow(): void; onContinue(): void } | undefined;
  const prompt = {
    show: jest.fn((actions: typeof promptActions) => {
      promptActions = actions;
    }),
  };
  return {
    dependencies: { coordinator, appState, prompt },
    coordinator,
    prompt,
    removeAppState,
    publish(next: NotificationSnapshot) {
      snapshot = next;
      for (const subscriber of subscribers) subscriber();
    },
    emitAppState(state: string) {
      appStateListener?.(state);
    },
    getPromptActions: () => promptActions,
  };
}

let latest: NotificationsContextValue | undefined;
function Probe() {
  const value = useNotifications();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}

describe('NotificationsProvider', () => {
  beforeEach(() => {
    latest = undefined;
    mocks.auth = { state: { status: 'booting' } } as AuthContextValue;
  });

  it('waits for ready auth, explains once, and requests only on Continue', async () => {
    const setup = createSetup();
    const view = render(
      <NotificationsProvider dependencies={setup.dependencies}>
        <Probe />
      </NotificationsProvider>
    );
    expect(setup.coordinator.start).not.toHaveBeenCalled();
    expect(setup.prompt.show).not.toHaveBeenCalled();

    mocks.auth = readyAuth();
    view.rerender(
      <NotificationsProvider dependencies={setup.dependencies}>
        <Probe />
      </NotificationsProvider>
    );
    await waitFor(() => expect(setup.coordinator.start).toHaveBeenCalled());
    act(() =>
      setup.publish({
        status: 'requestable',
        canRequest: true,
        shouldExplain: true,
        message: 'Get notified.',
        recoveryAction: 'request',
      })
    );
    await waitFor(() => expect(setup.prompt.show).toHaveBeenCalledTimes(1));

    await act(async () => setup.getPromptActions()?.onContinue());
    expect(setup.coordinator.markExplanationShown).toHaveBeenCalledTimes(1);
    expect(setup.coordinator.requestPermission).toHaveBeenCalledWith({
      accessToken: 'access-1',
      userId: 'user-1',
    });
  });

  it('records Not now without requesting or blocking Inbox', async () => {
    const setup = createSetup();
    mocks.auth = readyAuth();
    render(
      <NotificationsProvider dependencies={setup.dependencies}>
        <Probe />
      </NotificationsProvider>
    );
    act(() =>
      setup.publish({
        status: 'requestable',
        canRequest: true,
        shouldExplain: true,
        message: 'Get notified.',
        recoveryAction: 'request',
      })
    );
    await waitFor(() => expect(setup.prompt.show).toHaveBeenCalledTimes(1));

    await act(async () => setup.getPromptActions()?.onNotNow());
    expect(setup.coordinator.markExplanationShown).toHaveBeenCalledTimes(1);
    expect(setup.coordinator.requestPermission).not.toHaveBeenCalled();
    expect(latest?.status).toBe('requestable');
  });

  it('refreshes on foreground and tears down every listener', async () => {
    const setup = createSetup();
    mocks.auth = readyAuth();
    const view = render(
      <NotificationsProvider dependencies={setup.dependencies}>
        <Probe />
      </NotificationsProvider>
    );
    await waitFor(() => expect(setup.coordinator.start).toHaveBeenCalled());

    act(() => setup.emitAppState('active'));
    await waitFor(() =>
      expect(setup.coordinator.refresh).toHaveBeenCalledWith({
        accessToken: 'access-1',
        userId: 'user-1',
      })
    );
    view.unmount();

    expect(setup.coordinator.stop).toHaveBeenCalledTimes(1);
    expect(setup.removeAppState).toHaveBeenCalledTimes(1);
  });
});
