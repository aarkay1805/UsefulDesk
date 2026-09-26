import { mobileEnvironment } from '../../core/env';
import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import type { MediaKind } from '../../../../../src/lib/storage/media-contract';

export type MobileSendInput =
  | {
      kind: 'text';
      accountId: string;
      conversationId: string;
      text: string;
      replyToMessageId?: string;
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
    }
  | {
      kind: 'media';
      accountId: string;
      conversationId: string;
      mediaKind: MediaKind;
      mediaUrl: string;
      caption?: string;
      filename?: string;
      replyToMessageId?: string;
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
  readonly safeToRetry: boolean;

  constructor(
    readonly category: MobileSendErrorCategory,
    message: string
  ) {
    super(message);
    this.name = 'MobileSendError';
    this.safeToRetry =
      category === 'unauthorized' ||
      category === 'forbidden' ||
      category === 'rate_limited';
  }
}

export interface MobileSendFailure {
  message: string;
  safeToRetry: boolean;
}

export function describeMobileSendFailure(error: unknown): MobileSendFailure {
  const detail =
    error instanceof MobileSendError
      ? error.message
      : 'Something went wrong while sending.';
  const safeToRetry =
    error instanceof MobileSendError && error.safeToRetry === true;
  return {
    safeToRetry,
    message: safeToRetry
      ? detail
      : `${detail} We cannot tell if it was sent. Check the chat before you send it again.`,
  };
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
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  auth?: MobileAuthTransport;
  selectedBranch?: { get(): string | null };
  recoverUnauthorizedSession(): Promise<void>;
}

interface ResolvedMobileSendDependencies {
  apiBaseUrl: string;
  fetch: typeof fetch;
  auth: MobileAuthTransport;
  selectedBranch: { get(): string | null };
  recoverUnauthorizedSession(): Promise<void>;
}

const defaultTransport = {
  apiBaseUrl: mobileEnvironment.apiBaseUrl,
  fetch,
  auth: mobileSupabase.auth,
  selectedBranch: selectedBranchRef,
};

function resolveDependencies(
  dependencies: MobileSendDependencies
): ResolvedMobileSendDependencies {
  return {
    ...defaultTransport,
    ...dependencies,
  };
}

function errorForStatus(status: number): MobileSendError {
  if (status === 401) {
    return new MobileSendError(
      'unauthorized',
      'Your sign-in expired. Sign in again.'
    );
  }
  if (status === 403) {
    return new MobileSendError(
      'forbidden',
      'You do not have permission to send messages in this branch.'
    );
  }
  if (status === 429) {
    return new MobileSendError(
      'rate_limited',
      'Too many messages at once. Wait a minute and try again.'
    );
  }
  return new MobileSendError('provider', 'Something went wrong while sending.');
}

function requestBody(input: MobileSendInput): string {
  if (input.kind === 'text') {
    const text = input.text.trim();
    if (!text) {
      throw new MobileSendError('invalid_response', 'Type a message first.');
    }
    return JSON.stringify({
      conversation_id: input.conversationId,
      message_type: 'text',
      content_text: text,
      reply_to_message_id: input.replyToMessageId,
    });
  }

  if (input.kind === 'media') {
    const mediaUrl = input.mediaUrl.trim();
    const caption = input.caption?.trim() || undefined;
    if (!mediaUrl) {
      throw new MobileSendError(
        'invalid_response',
        'An attachment URL is required.'
      );
    }
    if (caption && caption.length > 1024) {
      throw new MobileSendError(
        'invalid_response',
        'A caption can have up to 1,024 characters.'
      );
    }
    return JSON.stringify({
      conversation_id: input.conversationId,
      message_type: input.mediaKind,
      media_url: mediaUrl,
      content_text: input.mediaKind === 'audio' ? undefined : caption,
      filename:
        input.mediaKind === 'document'
          ? input.filename?.trim() || undefined
          : undefined,
      reply_to_message_id: input.replyToMessageId,
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
      'Something went wrong while sending.'
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
      'Something went wrong while sending.'
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
  dependencies: ResolvedMobileSendDependencies
): Promise<Response> {
  if (dependencies.selectedBranch.get() !== input.accountId) {
    throw new MobileSendError(
      'forbidden',
      'You switched to another branch. Open this chat again.'
    );
  }

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
    throw new MobileSendError(
      'network',
      'Could not connect. Check your internet.'
    );
  }
}

async function sessionToken(
  getSession: MobileAuthTransport['getSession']
): Promise<string> {
  let result: Awaited<ReturnType<MobileAuthTransport['getSession']>>;
  try {
    result = await getSession();
  } catch {
    throw new MobileSendError(
      'unauthorized',
      'Your sign-in expired. Sign in again.'
    );
  }
  if (result.error || !result.data.session?.access_token) {
    throw new MobileSendError(
      'unauthorized',
      'Your sign-in expired. Sign in again.'
    );
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
    throw new MobileSendError(
      'unauthorized',
      'Your sign-in expired. Sign in again.'
    );
  }
  if (result.error || !result.data.session?.access_token) {
    throw new MobileSendError(
      'unauthorized',
      'Your sign-in expired. Sign in again.'
    );
  }
  return result.data.session.access_token;
}

export async function sendConversationMessage(
  input: MobileSendInput,
  options: MobileSendDependencies
): Promise<MobileSendResult> {
  const dependencies = resolveDependencies(options);
  const body = requestBody(input);
  if (dependencies.selectedBranch.get() !== input.accountId) {
    throw new MobileSendError(
      'forbidden',
      'You switched to another branch. Open this chat again.'
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
      'Something went wrong while sending.'
    );
  }
  return decodeSuccess(responseBody);
}
