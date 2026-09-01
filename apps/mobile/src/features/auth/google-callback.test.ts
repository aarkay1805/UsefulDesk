import { authorizationCodeFromCallback } from './google-callback';

describe('authorizationCodeFromCallback', () => {
  it('returns the code from the exact UsefulDesk callback route', () => {
    expect(
      authorizationCodeFromCallback(
        'usefuldesk-agent://auth/callback?code=one-time-code'
      )
    ).toEqual({ status: 'code', code: 'one-time-code' });
  });

  it('rejects the callback when its code is missing', () => {
    expect(
      authorizationCodeFromCallback('usefuldesk-agent://auth/callback')
    ).toEqual({
      status: 'error',
      message: 'Google sign-in did not return an authorization code.',
    });
  });

  it('returns a safe error for an OAuth error query', () => {
    expect(
      authorizationCodeFromCallback(
        'usefuldesk-agent://auth/callback?error=access_denied&error_description=provider%20secret'
      )
    ).toEqual({
      status: 'error',
      message: 'Google sign-in was not completed.',
    });
  });

  it.each([
    'https://auth/callback?code=stolen-code',
    'usefuldesk-agent://other/callback?code=stolen-code',
    'usefuldesk-agent://auth/not-callback?code=stolen-code',
  ])('rejects an unrelated callback route: %s', (url) => {
    expect(authorizationCodeFromCallback(url)).toEqual({
      status: 'error',
      message: 'Google sign-in returned an invalid callback.',
    });
  });

  it.each([
    'usefuldesk-agent://user@auth/callback?code=stolen-code',
    'usefuldesk-agent://user:password@auth/callback?code=stolen-code',
    'usefuldesk-agent://auth:443/callback?code=stolen-code',
  ])('rejects callback authority credentials or a port: %s', (url) => {
    expect(authorizationCodeFromCallback(url)).toEqual({
      status: 'error',
      message: 'Google sign-in returned an invalid callback.',
    });
  });

  it.each([
    'usefuldesk-agent://auth/callback#access_token=fragment-token',
    'usefuldesk-agent://auth/callback?code=query-code#refresh_token=fragment-token',
  ])('rejects fragment credentials: %s', (url) => {
    expect(authorizationCodeFromCallback(url)).toEqual({
      status: 'error',
      message: 'Google sign-in returned an invalid callback.',
    });
  });

  it('rejects a malformed callback without throwing', () => {
    expect(authorizationCodeFromCallback('not a url')).toEqual({
      status: 'error',
      message: 'Google sign-in returned an invalid callback.',
    });
  });

  it.each([
    'usefuldesk-agent://auth/callback?code=first&code=second',
    'usefuldesk-agent://auth/callback?code=one-time-code&state=unexpected',
  ])('rejects duplicate or extra callback query data: %s', (url) => {
    expect(authorizationCodeFromCallback(url)).toEqual({
      status: 'error',
      message: 'Google sign-in did not return an authorization code.',
    });
  });

  it('decodes the one authorization-code value exactly once', () => {
    expect(
      authorizationCodeFromCallback(
        'usefuldesk-agent://auth/callback?code=one%2Btwo%2Fthree%3D'
      )
    ).toEqual({ status: 'code', code: 'one+two/three=' });
  });

  it.each([
    'usefuldesk-agent://auth//callback?code=stolen-code',
    'usefuldesk-agent://auth/callback/?code=stolen-code',
    'usefuldesk-agent://auth/%63allback?code=stolen-code',
    'usefuldesk-agent:auth/callback?code=stolen-code',
    'usefuldesk-agent://user%40example.com@auth/callback?code=stolen-code',
  ])('rejects non-exact authority and path combinations: %s', (url) => {
    expect(authorizationCodeFromCallback(url)).toEqual({
      status: 'error',
      message: 'Google sign-in returned an invalid callback.',
    });
  });
});
