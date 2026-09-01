import { mobileEnvironment } from '../../core/env';
import { mobileSupabase, selectedBranchRef } from '../../data/supabase';

export type MobileSendInput =
  | {
      kind: 'text';
      accountId: string;
      conversationId: string;
      text: string;
    }
  | {
      kind: 'template';
      accountId: string;
      conversationId: string;
      templateName: string;
      templateLanguage: string;
      templateParams: string[];
      templateMessageParams: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      };
    };

export type MobileSendResult = {
  messageId: string;
  whatsappMessageId: string | null;
};

export type MobileSendErrorCategory =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'provider'
  | 'network'
  | 'invalid_response';

export class MobileSendError extends Error {
  constructor(
    readonly category: MobileSendErrorCategory,
    message: string
  ) {
    super(message);
    this.name = 'MobileSendError';
  }
}

type MobileSession = { access_token: string };

interface MobileAuthTransport {
  getSession(): Promise<{
    data: { session: MobileSession | null };
    error: unknown;
  }>;
  refreshSession(): Promise<{
    data: { session: MobileSession | null };
    error: unknown;
  }>;
}

export interface MobileSendDependencies {
  apiBaseUrl: string;
  fetch: typeof fetch;
  auth: MobileAuthTransport;
  selectedBranch: { get(): string | null };
  recoverUnauthorizedSession(): Promise<void>;
}

const defaultDependencies: MobileSendDependencies = {
  apiBaseUrl: mobileEnvironment.apiBaseUrl,
  fetch,
  auth: mobileSupabase.auth,
  selectedBranch: selectedBranchRef,
  // The transport is consumed through an AuthProvider. Callers supply that
  // provider's guarded recovery callback when wiring a composer.
  async recoverUnauthorizedSession() {},
};

function errorForStatus(status: number): MobileSendError {
  if (status === 401) {
    return new MobileSendError('unauthorized', 'Your session has expired.');
  }
  if (status === 403) {
    return new MobileSendError(
      'forbidden',
      'You cannot send from this branch.'
    );
  }
  if (status === 429) {
    return new MobileSendError('rate_limited', 'Too many send attempts.');
  }
  return new MobileSendError('provider', 'Message delivery is unavailable.');
}

function requestBody(input: MobileSendInput): string {
  if (input.kind === 'text') {
    const text = input.text.trim();
    if (!text) {
      throw new MobileSendError(
        'invalid_response',
        'A message cannot be empty.'
      );
    }
    return JSON.stringify({
      conversation_id: input.conversationId,
      message_type: 'text',
      content_text: text,
    });
  }

  return JSON.stringify({
    conversation_id: input.conversationId,
    message_type: 'template',
    template_name: input.templateName,
    template_language: input.templateLanguage,
    template_params: input.templateParams,
    template_message_params: input.templateMessageParams,
  });
}

function decodeSuccess(body: string): MobileSendResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    throw new MobileSendError(
      'invalid_response',
      'The send service returned an invalid response.'
    );
  }
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    !('message_id' in decoded) ||
    typeof decoded.message_id !== 'string' ||
    !decoded.message_id ||
    !('whatsapp_message_id' in decoded) ||
    (decoded.whatsapp_message_id !== null &&
      typeof decoded.whatsapp_message_id !== 'string')
  ) {
    throw new MobileSendError(
      'invalid_response',
      'The send service returned an invalid response.'
    );
  }
  return {
    messageId: decoded.message_id,
    whatsappMessageId: decoded.whatsapp_message_id,
  };
}

async function sendWithToken(
  input: MobileSendInput,
  token: string,
  body: string,
  dependencies: MobileSendDependencies
): Promise<Response> {
  try {
    return await dependencies.fetch(
      `${dependencies.apiBaseUrl}/api/whatsapp/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-usefuldesk-account-id': input.accountId,
        },
        body,
      }
    );
  } catch {
    throw new MobileSendError('network', 'Could not reach the send service.');
  }
}

async function sessionToken(
  getSession: MobileAuthTransport['getSession']
): Promise<string> {
  let result: Awaited<ReturnType<MobileAuthTransport['getSession']>>;
  try {
    result = await getSession();
  } catch {
    throw new MobileSendError('unauthorized', 'Your session has expired.');
  }
  if (result.error || !result.data.session?.access_token) {
    throw new MobileSendError('unauthorized', 'Your session has expired.');
  }
  return result.data.session.access_token;
}

async function refreshedToken(
  refreshSession: MobileAuthTransport['refreshSession']
): Promise<string> {
  let result: Awaited<ReturnType<MobileAuthTransport['refreshSession']>>;
  try {
    result = await refreshSession();
  } catch {
    throw new MobileSendError('unauthorized', 'Your session has expired.');
  }
  if (result.error || !result.data.session?.access_token) {
    throw new MobileSendError('unauthorized', 'Your session has expired.');
  }
  return result.data.session.access_token;
}

export async function sendConversationMessage(
  input: MobileSendInput,
  dependencies: MobileSendDependencies = defaultDependencies
): Promise<MobileSendResult> {
  const body = requestBody(input);
  if (dependencies.selectedBranch.get() !== input.accountId) {
    throw new MobileSendError(
      'forbidden',
      'This branch is no longer selected.'
    );
  }

  const token = await sessionToken(
    dependencies.auth.getSession.bind(dependencies.auth)
  );
  let response = await sendWithToken(input, token, body, dependencies);
  if (response.status === 401) {
    const freshToken = await refreshedToken(
      dependencies.auth.refreshSession.bind(dependencies.auth)
    );
    response = await sendWithToken(input, freshToken, body, dependencies);
    if (response.status === 401) {
      try {
        await dependencies.recoverUnauthorizedSession();
      } catch {
        // The authenticated context owns recovery outcomes; the send caller
        // still receives a typed failure for its optimistic message.
      }
      throw errorForStatus(response.status);
    }
  }
  if (!response.ok) throw errorForStatus(response.status);

  let responseBody: string;
  try {
    responseBody = await response.text();
  } catch {
    throw new MobileSendError(
      'invalid_response',
      'The send service returned an invalid response.'
    );
  }
  return decodeSuccess(responseBody);
}
