import { mobileEnvironment } from '../../core/env';
import { mobileSupabase, selectedBranchRef } from '../../data/supabase';

export type MobileReactionErrorCategory =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'provider'
  | 'network'
  | 'invalid_response';

export class MobileReactionError extends Error {
  constructor(
    readonly category: MobileReactionErrorCategory,
    message: string
  ) {
    super(message);
    this.name = 'MobileReactionError';
  }
}

export interface SetMessageReactionInput {
  accountId: string;
  messageId: string;
  emoji: string;
}

type MobileSession = { access_token: string };

interface ReactionAuthTransport {
  getSession(): Promise<{
    data: { session: MobileSession | null };
    error: unknown;
  }>;
  refreshSession(): Promise<{
    data: { session: MobileSession | null };
    error: unknown;
  }>;
}

export interface MobileReactionDependencies {
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  auth?: ReactionAuthTransport;
  selectedBranch?: { get(): string | null };
  recoverUnauthorizedSession(): Promise<void>;
}

interface ResolvedDependencies {
  apiBaseUrl: string;
  fetch: typeof fetch;
  auth: ReactionAuthTransport;
  selectedBranch: { get(): string | null };
  recoverUnauthorizedSession(): Promise<void>;
}

const defaults = {
  apiBaseUrl: mobileEnvironment.apiBaseUrl,
  fetch,
  auth: mobileSupabase.auth,
  selectedBranch: selectedBranchRef,
};

function resolveDependencies(
  dependencies: MobileReactionDependencies
): ResolvedDependencies {
  return { ...defaults, ...dependencies };
}

function responseError(status: number): MobileReactionError {
  if (status === 401) {
    return new MobileReactionError('unauthorized', 'Your session has expired.');
  }
  if (status === 403) {
    return new MobileReactionError(
      'forbidden',
      'You cannot react from this branch.'
    );
  }
  if (status === 429) {
    return new MobileReactionError(
      'rate_limited',
      'Too many reaction attempts.'
    );
  }
  return new MobileReactionError(
    'provider',
    'WhatsApp reactions are unavailable.'
  );
}

async function tokenFrom(
  read: ReactionAuthTransport['getSession']
): Promise<string> {
  let result: Awaited<ReturnType<ReactionAuthTransport['getSession']>>;
  try {
    result = await read();
  } catch {
    throw responseError(401);
  }
  if (result.error || !result.data.session?.access_token) {
    throw responseError(401);
  }
  return result.data.session.access_token;
}

async function postReaction(
  input: SetMessageReactionInput,
  token: string,
  dependencies: ResolvedDependencies
): Promise<Response> {
  if (dependencies.selectedBranch.get() !== input.accountId) {
    throw new MobileReactionError(
      'forbidden',
      'This branch is no longer selected.'
    );
  }
  try {
    return await dependencies.fetch(
      `${dependencies.apiBaseUrl}/api/whatsapp/react`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-usefuldesk-account-id': input.accountId,
        },
        body: JSON.stringify({
          message_id: input.messageId,
          emoji: input.emoji,
        }),
      }
    );
  } catch {
    throw new MobileReactionError(
      'network',
      'Could not reach the reaction service.'
    );
  }
}

export async function setMessageReaction(
  input: SetMessageReactionInput,
  options: MobileReactionDependencies
): Promise<void> {
  const dependencies = resolveDependencies(options);
  if (dependencies.selectedBranch.get() !== input.accountId) {
    throw new MobileReactionError(
      'forbidden',
      'This branch is no longer selected.'
    );
  }

  const token = await tokenFrom(
    dependencies.auth.getSession.bind(dependencies.auth)
  );
  let response = await postReaction(input, token, dependencies);
  if (response.status === 401) {
    const freshToken = await tokenFrom(
      dependencies.auth.refreshSession.bind(dependencies.auth)
    );
    response = await postReaction(input, freshToken, dependencies);
    if (response.status === 401) {
      try {
        await dependencies.recoverUnauthorizedSession();
      } catch {
        // Auth context owns the recovery result; this call still fails closed.
      }
      throw responseError(401);
    }
  }
  if (!response.ok) throw responseError(response.status);

  let decoded: unknown;
  try {
    decoded = JSON.parse(await response.text());
  } catch {
    throw new MobileReactionError(
      'invalid_response',
      'The reaction service returned an invalid response.'
    );
  }
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    !('success' in decoded) ||
    decoded.success !== true
  ) {
    throw new MobileReactionError(
      'invalid_response',
      'The reaction service returned an invalid response.'
    );
  }
}
