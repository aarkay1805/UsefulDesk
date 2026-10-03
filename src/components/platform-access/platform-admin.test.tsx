// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  rpc: vi.fn(),
  refresh: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: api.refresh, replace: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: api.rpc, auth: { mfa: api } }),
}));
import { PlatformAdmin } from './platform-admin';
afterEach(cleanup);
describe('Platform administrator MFA boundary', () => {
  it('keeps organizations unmounted until the existing authenticator is verified', async () => {
    api.listFactors.mockResolvedValue({
      data: { totp: [{ id: 'factor-1', status: 'verified' }] },
      error: null,
    });
    api.challengeAndVerify.mockResolvedValue({ error: null });
    render(<PlatformAdmin mfaRequired />);
    expect(api.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Continue with authenticator'));
    const code = await screen.findByLabelText('Authenticator code');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Verify'));
    await waitFor(() => expect(api.refresh).toHaveBeenCalled());
    expect(api.challengeAndVerify).toHaveBeenCalledWith({
      factorId: 'factor-1',
      code: '123456',
    });
    expect(api.enroll).not.toHaveBeenCalled();
    expect(api.unenroll).not.toHaveBeenCalled();
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it('replaces unfinished setup and renders the real SDK SVG payload safely', async () => {
    api.listFactors.mockResolvedValue({
      data: {
        totp: [],
        all: [
          {
            id: 'legacy',
            factor_type: 'totp',
            status: 'unverified',
            friendly_name: '',
          },
          {
            id: 'retry',
            factor_type: 'totp',
            status: 'unverified',
            friendly_name: 'UsefulDesk platform administration',
          },
          {
            id: 'other',
            factor_type: 'totp',
            status: 'unverified',
            friendly_name: 'Another app',
          },
          { id: 'phone', factor_type: 'phone', status: 'unverified' },
        ],
      },
      error: null,
    });
    api.unenroll.mockResolvedValue({ error: null });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg">\n<path fill="#000" d="M0 0"/>\n</svg>\n';
    api.enroll.mockResolvedValue({
      data: {
        id: 'new-factor',
        totp: { qr_code: `data:image/svg+xml;utf-8,${svg}` },
      },
      error: null,
    });
    render(<PlatformAdmin mfaRequired />);
    fireEvent.click(screen.getByText('Continue with authenticator'));
    const qr = await screen.findByAltText('Authenticator enrollment QR code');
    expect(qr.getAttribute('src')).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    );
    expect(api.unenroll.mock.calls).toEqual([
      [{ factorId: 'legacy' }],
      [{ factorId: 'retry' }],
    ]);
    expect(api.enroll).toHaveBeenCalledWith({
      factorType: 'totp',
      friendlyName: 'UsefulDesk platform administration',
    });
    expect(screen.getByLabelText('Authenticator code')).toBeTruthy();
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it('does not create another factor when unfinished setup cannot be cleared', async () => {
    api.listFactors.mockResolvedValue({
      data: {
        totp: [],
        all: [
          {
            id: 'legacy',
            factor_type: 'totp',
            status: 'unverified',
            friendly_name: '',
          },
        ],
      },
      error: null,
    });
    api.unenroll.mockResolvedValue({
      error: { message: 'Could not restart setup' },
    });
    render(<PlatformAdmin mfaRequired />);
    fireEvent.click(screen.getByText('Continue with authenticator'));
    expect(await screen.findByText('Could not restart setup')).toBeTruthy();
    expect(api.enroll).not.toHaveBeenCalled();
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it('never opens organization queries when verification is rejected', async () => {
    api.listFactors.mockResolvedValue({
      data: { totp: [{ id: 'factor-1', status: 'verified' }] },
      error: null,
    });
    api.challengeAndVerify.mockResolvedValue({
      error: { message: 'Invalid authenticator code' },
    });
    render(<PlatformAdmin mfaRequired />);
    fireEvent.click(screen.getByText('Continue with authenticator'));
    fireEvent.change(await screen.findByLabelText('Authenticator code'), {
      target: { value: '111111' },
    });
    fireEvent.click(screen.getByText('Verify'));
    expect(await screen.findByText('Invalid authenticator code')).toBeTruthy();
    expect(api.rpc).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();
  });
});

describe('Monthly preparation organization selection', () => {
  it('mounts monthly preparation only after an organization is explicitly selected', async () => {
    api.rpc.mockImplementation(async (name: string) => {
      if (name === 'platform_admin_organizations')
        return {
          data: {
            items: [
              {
                organization_id: 'gym-1',
                name: 'Selected gym',
                owner_email: 'owner@example.invalid',
                status: 'trial',
                access: {
                  mode: 'trial',
                  version: 1,
                  trial_ends_at: '2026-10-20T00:00:00Z',
                  suspended_at: null,
                },
              },
            ],
            total: 1,
          },
          error: null,
        };
      if (name === 'platform_admin_starter_signup_queue')
        return { data: { items: [], total: 0 }, error: null };
      if (name === 'platform_admin_monthly_offer_context')
        return {
          data: {
            branches: [],
            missing_facts: ['billing_branch'],
            snapshot_token: 'source-1',
          },
          error: null,
        };
      return { data: [], error: null };
    });
    render(<PlatformAdmin mfaRequired={false} />);
    await screen.findByText('Selected gym');
    expect(
      api.rpc.mock.calls.some(
        ([name]) => name === 'platform_admin_monthly_offer_context'
      )
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Manage access' }));
    expect(
      await screen.findByRole('heading', { name: 'Prepare monthly offers' })
    ).toBeTruthy();
    await waitFor(() =>
      expect(api.rpc).toHaveBeenCalledWith(
        'platform_admin_monthly_offer_context',
        { p_organization_id: 'gym-1', p_billing_account_id: null }
      )
    );
    expect(
      api.rpc.mock.calls.some(
        ([name]) => name === 'platform_admin_prepare_monthly_offers'
      )
    ).toBe(false);
  });
});
