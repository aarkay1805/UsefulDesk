export type AccountStatus = 'loading' | 'ready' | 'unlinked' | 'error';

interface ProfileLookupResult<T, E> {
  data: T | null;
  error: E | null;
}

interface RetryProfileLookupOptions<E> {
  onError?: (error: E, attempt: number) => void;
  wait?: (milliseconds: number) => Promise<void>;
}

const PROFILE_FETCH_RETRY_MS = 1500;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/** Retry one failed profile lookup before exposing a broken auth context. */
export async function retryProfileLookup<T, E>(
  lookup: () => Promise<ProfileLookupResult<T, E>>,
  options: RetryProfileLookupOptions<E> = {}
): Promise<ProfileLookupResult<T, E>> {
  const waitForRetry = options.wait ?? wait;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await lookup();
    if (!result.error) return result;

    options.onError?.(result.error, attempt);
    if (attempt === 1) await waitForRetry(PROFILE_FETCH_RETRY_MS);
    else return result;
  }

  throw new Error('Profile lookup retry exhausted without a result');
}

export function resolveAccountStatus({
  signedIn,
  profileLoading,
  hasProfile,
  hasAccount,
  accountId,
  accountRole,
}: {
  signedIn: boolean;
  profileLoading: boolean;
  hasProfile: boolean;
  hasAccount: boolean;
  accountId: string | null;
  accountRole: string | null;
}): AccountStatus {
  if (!signedIn || profileLoading) return 'loading';
  if (!hasProfile) return 'error';
  if (!accountId || !accountRole) return 'unlinked';
  return hasAccount ? 'ready' : 'error';
}
