import { describe, expect, it } from 'vitest';

import {
  invitationDestinationOr,
  invitationJoinPath,
  invitationTokenFromPath,
  normalizeInvitationToken,
  withInvitation,
} from './invitation-continuation';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

describe('invitation auth continuation', () => {
  it('round-trips a current UsefulDesk invitation token', () => {
    const path = invitationJoinPath(INVITE_TOKEN);

    expect(path).toBe(`/join/${INVITE_TOKEN}`);
    expect(invitationTokenFromPath(path)).toBe(INVITE_TOKEN);
    expect(withInvitation('/login', INVITE_TOKEN)).toBe(
      `/login?invite=${INVITE_TOKEN}`
    );
  });

  it('rejects arbitrary paths, encoded separators, and malformed tokens', () => {
    for (const value of [
      '/dashboard',
      '//evil.example',
      '/join/token%2Fdashboard',
      '/join/short',
      `/join/${INVITE_TOKEN}?next=//evil.example`,
    ]) {
      expect(invitationTokenFromPath(value)).toBeNull();
      expect(invitationDestinationOr(value, '/dashboard')).toBe('/dashboard');
    }

    expect(normalizeInvitationToken('../dashboard')).toBeNull();
    expect(withInvitation('/login', '//evil.example')).toBe('/login');
  });
});
