import { MobileReactionError, setMessageReaction } from './reaction-client';
import {
  BRANCH_ID,
  MESSAGE_1_ID,
  OTHER_BRANCH_ID,
} from './inbox-test-fixtures';

function response(status: number, body = '{}') {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function dependencies(
  options: {
    selectedBranch?: string | null;
    responses?: Response[];
  } = {}
) {
  const fetch = jest.fn();
  for (const item of options.responses ?? [response(200, '{"success":true}')]) {
    fetch.mockResolvedValueOnce(item);
  }
  const auth = {
    getSession: jest.fn().mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
      error: null,
    }),
    refreshSession: jest.fn().mockResolvedValue({
      data: { session: { access_token: 'fresh-token' } },
      error: null,
    }),
  };
  const recoverUnauthorizedSession = jest.fn().mockResolvedValue(undefined);
  return {
    value: {
      apiBaseUrl: 'https://app.example.test',
      fetch,
      auth,
      selectedBranch: {
        get: jest.fn(() =>
          options.selectedBranch === undefined
            ? BRANCH_ID
            : options.selectedBranch
        ),
      },
      recoverUnauthorizedSession,
    },
    auth,
    fetch,
    recoverUnauthorizedSession,
  };
}

describe('setMessageReaction', () => {
  it('posts one bearer-authenticated branch-scoped reaction to the shared route', async () => {
    const deps = dependencies();

    await expect(
      setMessageReaction(
        { accountId: BRANCH_ID, messageId: MESSAGE_1_ID, emoji: '👍' },
        deps.value
      )
    ).resolves.toBeUndefined();

    expect(deps.fetch).toHaveBeenCalledWith(
      'https://app.example.test/api/whatsapp/react',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
          'x-usefuldesk-account-id': BRANCH_ID,
        },
        body: JSON.stringify({ message_id: MESSAGE_1_ID, emoji: '👍' }),
      }
    );
  });

  it('fails closed before auth when the selected branch changed', async () => {
    const deps = dependencies({ selectedBranch: OTHER_BRANCH_ID });

    await expect(
      setMessageReaction(
        { accountId: BRANCH_ID, messageId: MESSAGE_1_ID, emoji: '👍' },
        deps.value
      )
    ).rejects.toMatchObject({
      category: 'forbidden',
      message: 'This branch is no longer selected.',
    });

    expect(deps.auth.getSession).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('refreshes once on 401 and recovers auth after a second 401', async () => {
    const deps = dependencies({
      responses: [response(401), response(401)],
    });

    await expect(
      setMessageReaction(
        { accountId: BRANCH_ID, messageId: MESSAGE_1_ID, emoji: '' },
        deps.value
      )
    ).rejects.toEqual(
      new MobileReactionError('unauthorized', 'Your session has expired.')
    );

    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.fetch.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer fresh-token' })
    );
    expect(deps.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(deps.recoverUnauthorizedSession).toHaveBeenCalledTimes(1);
  });

  it('does not retry into a branch selected while auth refreshes', async () => {
    let selectedBranch = BRANCH_ID;
    const deps = dependencies({ responses: [response(401)] });
    deps.value.selectedBranch.get.mockImplementation(() => selectedBranch);
    deps.auth.refreshSession.mockImplementation(async () => {
      selectedBranch = OTHER_BRANCH_ID;
      return {
        data: { session: { access_token: 'fresh-token' } },
        error: null,
      };
    });

    await expect(
      setMessageReaction(
        { accountId: BRANCH_ID, messageId: MESSAGE_1_ID, emoji: '👍' },
        deps.value
      )
    ).rejects.toMatchObject({
      category: 'forbidden',
      message: 'This branch is no longer selected.',
    });

    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'forbidden', 'You cannot react from this branch.'],
    [429, 'rate_limited', 'Too many reaction attempts.'],
    [502, 'provider', 'WhatsApp reactions are unavailable.'],
  ] as const)(
    'maps HTTP %i to %s without claiming delivery',
    async (status, category, message) => {
      const deps = dependencies({ responses: [response(status)] });

      await expect(
        setMessageReaction(
          { accountId: BRANCH_ID, messageId: MESSAGE_1_ID, emoji: '👍' },
          deps.value
        )
      ).rejects.toMatchObject({ category, message });
    }
  );

  it('rejects a malformed success body', async () => {
    const deps = dependencies({
      responses: [response(200, '{"success":false}')],
    });

    await expect(
      setMessageReaction(
        { accountId: BRANCH_ID, messageId: MESSAGE_1_ID, emoji: '👍' },
        deps.value
      )
    ).rejects.toMatchObject({
      category: 'invalid_response',
      message: 'The reaction service returned an invalid response.',
    });
  });
});
