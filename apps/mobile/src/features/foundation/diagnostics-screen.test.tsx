import type { Session } from '@supabase/supabase-js';
import { render, screen } from '@testing-library/react-native';

import type { ReadyAuthContextValue } from '../auth/auth-context';
import type { AccountSummary, BranchAccount } from '../auth/branch-types';
import { DiagnosticsScreen } from './diagnostics-screen';

const mockUseReadyAuth = jest.fn();

jest.mock('../auth/auth-context', () => ({
  useReadyAuth: () => mockUseReadyAuth(),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.1.0',
  nativeBuildVersion: '42',
}));

const BRANCH_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';

function branch(): BranchAccount {
  return {
    account_id: BRANCH_ID,
    account_name: 'Indiranagar',
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    organization_name: 'Useful Fitness',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    legal_entity_name: 'Useful Fitness Private Limited',
    role: 'admin',
    branch_status: 'active',
    readiness_state: 'ready',
    default_currency: 'INR',
    timezone: 'Asia/Kolkata',
    is_organization_owner: false,
    setup_reviewed_at: null,
    setup_reviewed_by: null,
  };
}

function accountSummary(): AccountSummary {
  return {
    id: BRANCH_ID,
    name: 'Indiranagar',
    created_at: '2026-08-01T10:00:00.000Z',
    default_currency: 'INR',
    country_code: 'IN',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    date_order: 'DMY',
    time_format: '12h',
    week_start: 1,
    phone_country_code: '+91',
    measurement_system: 'metric',
    onboarding_dismissed_at: null,
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    branch_status: 'active',
    readiness_state: 'ready',
    setup_reviewed_at: null,
    setup_reviewed_by: null,
  };
}

function readyAuthValue(): ReadyAuthContextValue {
  return {
    state: {
      status: 'ready',
      session: {} as Session,
      profile: {
        id: 'cfaef847-2572-4c92-852e-b62c09eecae4',
        full_name: 'Test Agent',
        email: 'agent@example.test',
        avatar_url: null,
        role: null,
        beta_features: [],
        account_id: BRANCH_ID,
        account_role: 'admin',
      },
      branches: [branch()],
      branch: branch(),
      account: accountSummary(),
    },
    signInWithPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    recoverUnauthorizedSession: jest.fn(),
    selectBranch: jest.fn(),
  };
}

describe('DiagnosticsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseReadyAuth.mockReturnValue(readyAuthValue());
  });

  it('names the environment and push channel this build resolved to', () => {
    render(<DiagnosticsScreen />);

    // jest.setup.ts builds the test binary at EXPO_PUBLIC_APP_ENV=test, which
    // pushes on the development channel.
    expect(screen.getByText('Test')).toBeTruthy();
    expect(screen.getByText('Development')).toBeTruthy();
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('identifies each backend by host alone', () => {
    render(<DiagnosticsScreen />);

    expect(screen.getByText('localhost:3000')).toBeTruthy();
    expect(screen.getByText('example.supabase.co')).toBeTruthy();
  });

  it('never renders the Supabase key', () => {
    render(<DiagnosticsScreen />);

    // The screen is reachable by every signed-in user and is the natural thing
    // to screenshot into a support thread. Identifying a backend needs its
    // host, never its key.
    expect(screen.queryByText(/test-anon-key/)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('test-anon-key');
  });

  it('shows the branch this device is signed in to', () => {
    render(<DiagnosticsScreen />);

    expect(screen.getByText('Indiranagar')).toBeTruthy();
    expect(screen.getByText('Useful Fitness')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
});
