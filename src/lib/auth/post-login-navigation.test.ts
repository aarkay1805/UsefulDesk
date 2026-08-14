import { describe, expect, it } from 'vitest';

import {
  navigateAfterLogin,
  postLoginDestination,
} from './post-login-navigation';

describe('post-login full-page navigation', () => {
  const inviteToken = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

  it('loads the dashboard after a normal sign-in', () => {
    const location = { href: 'https://desk.example/login' };
    navigateAfterLogin(null, location);
    expect(location.href).toBe('/dashboard');
  });

  it('preserves a validated invitation destination', () => {
    const location = { href: 'https://desk.example/login' };
    navigateAfterLogin(inviteToken, location);
    expect(location.href).toBe(`/join/${inviteToken}`);
    expect(postLoginDestination(inviteToken)).toBe(`/join/${inviteToken}`);
  });

  it('does not turn an untrusted value into a return destination', () => {
    expect(postLoginDestination('//evil.example')).toBe('/dashboard');
    expect(postLoginDestination('token/with spaces')).toBe('/dashboard');
  });
});
