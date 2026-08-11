import { describe, expect, it } from 'vitest';

import {
  navigateAfterLogin,
  postLoginDestination,
} from './post-login-navigation';

describe('post-login full-page navigation', () => {
  it('loads the dashboard after a normal sign-in', () => {
    const location = { href: 'https://desk.example/login' };
    navigateAfterLogin(null, location);
    expect(location.href).toBe('/dashboard');
  });

  it('preserves and safely encodes the invitation destination', () => {
    const location = { href: 'https://desk.example/login' };
    navigateAfterLogin('token/with spaces', location);
    expect(location.href).toBe('/join/token%2Fwith%20spaces');
    expect(postLoginDestination('invite-123')).toBe('/join/invite-123');
  });
});
