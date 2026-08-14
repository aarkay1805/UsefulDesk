import { describe, expect, it } from 'vitest';
import { oauthCallbackUrl } from './oauth';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

describe('OAuth callback URL', () => {
  it('defaults ordinary sign-in to the dashboard', () => {
    const callback = new URL(oauthCallbackUrl('https://desk.example', null));

    expect(callback.origin).toBe('https://desk.example');
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe('/dashboard');
  });

  it('retains only a validated invitation destination', () => {
    const invited = new URL(
      oauthCallbackUrl('https://desk.example', INVITE_TOKEN)
    );
    const invalid = new URL(
      oauthCallbackUrl('https://desk.example', '//evil.example')
    );

    expect(invited.searchParams.get('next')).toBe(`/join/${INVITE_TOKEN}`);
    expect(invalid.searchParams.get('next')).toBe('/dashboard');
  });
});
