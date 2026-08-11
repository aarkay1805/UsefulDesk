import { describe, expect, it, vi } from 'vitest';
import { resolveAccountStatus, retryProfileLookup } from './account-recovery';

describe('retryProfileLookup', () => {
  it('recovers from one transient profile lookup failure', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('offline') })
      .mockResolvedValueOnce({ data: { id: 'profile-1' }, error: null });
    const wait = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    await expect(
      retryProfileLookup(lookup, { wait, onError })
    ).resolves.toEqual({ data: { id: 'profile-1' }, error: null });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1500);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('returns the second failure without retrying forever', async () => {
    const finalError = new Error('still offline');
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('offline') })
      .mockResolvedValueOnce({ data: null, error: finalError });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(retryProfileLookup(lookup, { wait })).resolves.toEqual({
      data: null,
      error: finalError,
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});

describe('resolveAccountStatus', () => {
  it('treats a resolved viewer as ready', () => {
    expect(
      resolveAccountStatus({
        signedIn: true,
        profileLoading: false,
        hasProfile: true,
        accountId: 'account-1',
        accountRole: 'viewer',
      })
    ).toBe('ready');
  });

  it('distinguishes loading, lookup failure, and an unlinked profile', () => {
    expect(
      resolveAccountStatus({
        signedIn: true,
        profileLoading: true,
        hasProfile: false,
        accountId: null,
        accountRole: null,
      })
    ).toBe('loading');
    expect(
      resolveAccountStatus({
        signedIn: true,
        profileLoading: false,
        hasProfile: false,
        accountId: null,
        accountRole: null,
      })
    ).toBe('error');
    expect(
      resolveAccountStatus({
        signedIn: true,
        profileLoading: false,
        hasProfile: true,
        accountId: null,
        accountRole: null,
      })
    ).toBe('unlinked');
  });
});
