import {
  MobileSendError,
  sendConversationMessage,
  type MobileSendDependencies,
  type MobileSendInput,
} from './send-message-client';

const ACCOUNT_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const CONVERSATION_ID = '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141';
const API_BASE = 'https://api.usefuldesk.test';

const textInput: MobileSendInput = {
  kind: 'text',
  accountId: ACCOUNT_ID,
  conversationId: CONVERSATION_ID,
  text: 'Hello',
};
const productionOptions: MobileSendDependencies = {
  recoverUnauthorizedSession: async () => undefined,
};

if (false) {
  void sendConversationMessage(textInput, productionOptions);
  // @ts-expect-error Production sends must supply AuthProvider recovery.
  void sendConversationMessage(textInput);
}

function response(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function dependencies(options?: {
  sessionToken?: string | null;
  branchId?: string | null;
}) {
  const fetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
  const recoverUnauthorizedSession = jest.fn().mockResolvedValue(undefined);
  const getSession = jest.fn().mockResolvedValue({
    data: {
      session:
        options?.sessionToken === null
          ? null
          : { access_token: options?.sessionToken ?? 'current-token' },
    },
    error: null,
  });
  const refreshSession = jest.fn();
  const result: MobileSendDependencies = {
    apiBaseUrl: API_BASE,
    fetch,
    auth: { getSession, refreshSession },
    selectedBranch: { get: jest.fn(() => options?.branchId ?? ACCOUNT_ID) },
    recoverUnauthorizedSession,
  };
  return {
    result,
    fetch,
    getSession,
    refreshSession,
    recoverUnauthorizedSession,
  };
}

describe('sendConversationMessage', () => {
  it('gets the current token at send time and posts a trimmed text payload', async () => {
    const setup = dependencies();
    setup.fetch.mockResolvedValueOnce(
      response(
        200,
        '{"message_id":"message-1","whatsapp_message_id":"wamid.1"}'
      )
    );

    await expect(
      sendConversationMessage(
        {
          kind: 'text',
          accountId: ACCOUNT_ID,
          conversationId: CONVERSATION_ID,
          text: '  I can help with your renewal.  ',
        },
        setup.result
      )
    ).resolves.toEqual({
      messageId: 'message-1',
      whatsappMessageId: 'wamid.1',
    });

    expect(setup.getSession).toHaveBeenCalledTimes(1);
    expect(setup.fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/whatsapp/send`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer current-token',
          'x-usefuldesk-account-id': ACCOUNT_ID,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          conversation_id: CONVERSATION_ID,
          message_type: 'text',
          content_text: 'I can help with your renewal.',
        }),
      })
    );
  });

  it('posts the complete template route payload', async () => {
    const setup = dependencies();
    setup.fetch.mockResolvedValueOnce(
      response(200, '{"message_id":"message-2","whatsapp_message_id":null}')
    );

    await sendConversationMessage(
      {
        kind: 'template',
        accountId: ACCOUNT_ID,
        conversationId: CONVERSATION_ID,
        templateName: 'gym_membership_renewal',
        templateLanguage: 'en',
        templateParams: ['Asha', 'Gold'],
        templateMessageParams: {
          body: ['Asha', 'Gold'],
          headerText: 'Membership renewal',
          buttonParams: { 0: 'https://pay.example.test/renewal' },
        },
      },
      setup.result
    );

    expect(setup.fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/whatsapp/send`,
      expect.objectContaining({
        body: JSON.stringify({
          conversation_id: CONVERSATION_ID,
          message_type: 'template',
          template_name: 'gym_membership_renewal',
          template_language: 'en',
          template_params: ['Asha', 'Gold'],
          template_message_params: {
            body: ['Asha', 'Gold'],
            headerText: 'Membership renewal',
            buttonParams: { 0: 'https://pay.example.test/renewal' },
          },
        }),
      })
    );
  });

  it.each([
    ['non-JSON', 'not json'],
    ['missing message id', '{"success":true}'],
    [
      'invalid WhatsApp id',
      '{"message_id":"message-1","whatsapp_message_id":4}',
    ],
  ])('rejects a %s success response', async (_name, body) => {
    const setup = dependencies();
    setup.fetch.mockResolvedValueOnce(response(200, body));

    await expect(
      sendConversationMessage(
        {
          kind: 'text',
          accountId: ACCOUNT_ID,
          conversationId: CONVERSATION_ID,
          text: 'Hello',
        },
        setup.result
      )
    ).rejects.toMatchObject<Partial<MobileSendError>>({
      category: 'invalid_response',
      safeToRetry: false,
    });
  });

  it('does not refresh a terminal forbidden response', async () => {
    const setup = dependencies();
    setup.fetch.mockResolvedValueOnce(response(403, '{"error":"Forbidden"}'));

    await expect(
      sendConversationMessage(
        {
          kind: 'text',
          accountId: ACCOUNT_ID,
          conversationId: CONVERSATION_ID,
          text: 'Hello',
        },
        setup.result
      )
    ).rejects.toMatchObject<Partial<MobileSendError>>({
      category: 'forbidden',
      safeToRetry: true,
    });
    expect(setup.refreshSession).not.toHaveBeenCalled();
    expect(setup.recoverUnauthorizedSession).not.toHaveBeenCalled();
  });

  it('classifies rate limits, provider failures, and fetch failures without recovery', async () => {
    const cases = [
      {
        response: response(429, '{"error":"Slow down"}'),
        category: 'rate_limited',
        safeToRetry: true,
      },
      {
        response: response(500, '{"error":"Meta unavailable"}'),
        category: 'provider',
        safeToRetry: false,
      },
      {
        response: new Error('offline'),
        category: 'network',
        safeToRetry: false,
      },
    ] as const;

    for (const item of cases) {
      const setup = dependencies();
      if (item.response instanceof Error)
        setup.fetch.mockRejectedValueOnce(item.response);
      else setup.fetch.mockResolvedValueOnce(item.response);
      await expect(
        sendConversationMessage(
          {
            kind: 'text',
            accountId: ACCOUNT_ID,
            conversationId: CONVERSATION_ID,
            text: 'Hello',
          },
          setup.result
        )
      ).rejects.toMatchObject<Partial<MobileSendError>>({
        category: item.category,
        safeToRetry: item.safeToRetry,
      });
      expect(setup.refreshSession).not.toHaveBeenCalled();
      expect(setup.recoverUnauthorizedSession).not.toHaveBeenCalled();
    }
  });

  it('refreshes once after a first 401 and retries with the new token', async () => {
    const setup = dependencies();
    setup.fetch
      .mockResolvedValueOnce(response(401, '{"error":"Expired"}'))
      .mockResolvedValueOnce(
        response(
          200,
          '{"message_id":"message-3","whatsapp_message_id":"wamid.3"}'
        )
      );
    setup.refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: 'fresh-token' } },
      error: null,
    });

    await expect(
      sendConversationMessage(
        {
          kind: 'text',
          accountId: ACCOUNT_ID,
          conversationId: CONVERSATION_ID,
          text: 'Hello',
        },
        setup.result
      )
    ).resolves.toEqual({
      messageId: 'message-3',
      whatsappMessageId: 'wamid.3',
    });
    expect(setup.refreshSession).toHaveBeenCalledTimes(1);
    expect(setup.fetch).toHaveBeenLastCalledWith(
      `${API_BASE}/api/whatsapp/send`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fresh-token',
          'x-usefuldesk-account-id': ACCOUNT_ID,
        }),
      })
    );
  });

  it('uses secure recovery once after the retry is also unauthorized', async () => {
    const setup = dependencies();
    setup.fetch
      .mockResolvedValueOnce(response(401, '{"error":"Expired"}'))
      .mockResolvedValueOnce(response(401, '{"error":"Expired again"}'));
    setup.refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: 'fresh-token' } },
      error: null,
    });

    await expect(
      sendConversationMessage(
        {
          kind: 'text',
          accountId: ACCOUNT_ID,
          conversationId: CONVERSATION_ID,
          text: 'Hello',
        },
        setup.result
      )
    ).rejects.toMatchObject<Partial<MobileSendError>>({
      category: 'unauthorized',
      safeToRetry: true,
    });
    expect(setup.refreshSession).toHaveBeenCalledTimes(1);
    expect(setup.recoverUnauthorizedSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'an empty text draft',
      {
        kind: 'text',
        accountId: ACCOUNT_ID,
        conversationId: CONVERSATION_ID,
        text: '  ',
      },
    ],
    [
      'a missing session',
      {
        kind: 'text',
        accountId: ACCOUNT_ID,
        conversationId: CONVERSATION_ID,
        text: 'Hello',
      },
    ],
    [
      'a branch different from the target account',
      {
        kind: 'text',
        accountId: ACCOUNT_ID,
        conversationId: CONVERSATION_ID,
        text: 'Hello',
      },
    ],
  ] as const)('rejects before fetch for %s', async (name, input) => {
    const setup = dependencies(
      name === 'a missing session'
        ? { sessionToken: null }
        : name === 'a branch different from the target account'
          ? { branchId: 'ab92ad08-3808-4a3e-8d50-7a5fa2a6a770' }
          : undefined
    );

    await expect(
      sendConversationMessage(input, setup.result)
    ).rejects.toBeInstanceOf(MobileSendError);
    expect(setup.fetch).not.toHaveBeenCalled();
  });
});
