// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BranchCreationDialog } from './branch-creation-dialog';
import type {
  BranchSetupCreationResult,
  BranchSetupPreview,
} from '@/lib/branches/setup';

const auth = vi.hoisted(() => ({
  switchBranch: vi.fn(),
  account: {
    id: '11111111-1111-4111-8111-111111111111',
    legal_entity_id: '22222222-2222-4222-8222-222222222222',
  },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => auth,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const sourceAccountId = '33333333-3333-4333-8333-333333333333';
const legalEntityId = '22222222-2222-4222-8222-222222222222';

const branchesPayload = {
  selectedAccountId: auth.account.id,
  legalEntities: [
    {
      id: legalEntityId,
      name: 'Useful Fitness Pvt Ltd',
      defaultCurrency: 'INR',
    },
  ],
  branches: [
    {
      account_id: sourceAccountId,
      account_name: 'Indiranagar',
      organization_id: '44444444-4444-4444-8444-444444444444',
      organization_name: 'Useful Fitness',
      legal_entity_id: legalEntityId,
      legal_entity_name: 'Useful Fitness Pvt Ltd',
      role: 'owner',
      branch_status: 'active',
      readiness_state: 'ready',
      default_currency: 'INR',
      timezone: 'Asia/Kolkata',
      is_organization_owner: true,
      setup_reviewed_at: '2026-08-12T00:00:00.000Z',
      setup_reviewed_by: '55555555-5555-4555-8555-555555555555',
    },
  ],
};

function preview(totalRows: number): BranchSetupPreview {
  return {
    startMode: 'copy',
    packs: [
      'membership_catalog',
      'lead_setup',
      'reminders',
      'automations',
      'flows',
    ],
    eligible: true,
    reasonCodes: [],
    source: {
      accountId: sourceAccountId,
      currency: 'INR',
      branchStatus: 'active',
      readinessState: 'ready',
      setupReviewedAt: '2026-08-12T00:00:00.000Z',
    },
    targetCurrency: 'INR',
    packEligibility: {
      membership_catalog: { eligible: true },
      lead_setup: { eligible: true },
      reminders: { eligible: true },
      automations: { eligible: true },
      flows: { eligible: true },
    },
    copied: {
      totalRows,
      breakdown: {
        membershipPlans: 1,
        planPricingOptions: 1,
        catalogItems: 1,
        catalogOptions: 1,
        leadFieldOptions: 1,
        tags: 1,
        customFields: 1,
        leadForms: 1,
        reminderSettings: 1,
        automations: 1,
        automationSteps: 1,
        flows: 1,
        flowNodes: 1,
      },
    },
    warnings: [],
    exclusions: ['Members', 'Credentials', 'Provider connections'],
  };
}

function creationResult(replayed: boolean): BranchSetupCreationResult {
  return {
    accountId: '66666666-6666-4666-8666-666666666666',
    readinessState: 'setup',
    replayed,
    setupReviewedAt: null,
    setup: {
      startMode: 'copy',
      sourceAccountId,
      packs: ['membership_catalog'],
    },
    copied: preview(2).copied,
    systemSeeded: { expenseCategories: 4 },
    warnings: [],
    credentialsCloned: false,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function reachSetupPacks(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText('Branch name');
  await user.type(screen.getByLabelText('Branch name'), 'HSR Layout');
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await user.click(screen.getByRole('radio', { name: /Copy reviewed setup/ }));
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByRole('checkbox', { name: /Reminder timing/ });
}

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await reachSetupPacks(user);
  await screen.findByText(/configuration rows ready/);
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByText('Configuration only');
}

beforeEach(() => {
  auth.switchBranch.mockReset();
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: vi.fn(() => '77777777-7777-4777-8777-777777777777'),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BranchCreationDialog', () => {
  it('starts a new request UUID only after an abandoned attempt is closed', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === '/api/branches') {
          return Promise.resolve(jsonResponse(branchesPayload));
        }
        if (url.includes('/setup-preview')) {
          return Promise.resolve(
            jsonResponse({ ...preview(0), startMode: 'blank', packs: [] })
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open wizard
          </button>
          <BranchCreationDialog open={open} onOpenChange={setOpen} />
        </>
      );
    }

    render(<Harness />);
    await screen.findByLabelText('Branch name');
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Open wizard' }));
    await screen.findByLabelText('Branch name');
    expect(crypto.randomUUID).toHaveBeenCalledTimes(2);
  });

  it('keeps membership setup unselected when source and target currencies differ', async () => {
    const user = userEvent.setup();
    const copyUrls: string[] = [];
    const currencyPayload = {
      ...branchesPayload,
      branches: [
        {
          ...branchesPayload.branches[0],
          default_currency: 'USD',
        },
      ],
    };
    const currencyPreview: BranchSetupPreview = {
      ...preview(9),
      source: { ...preview(9).source!, currency: 'USD' },
      packEligibility: {
        ...preview(9).packEligibility,
        membership_catalog: {
          eligible: false,
          reasonCode: 'CURRENCY_MISMATCH',
        },
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === '/api/branches') {
          return Promise.resolve(jsonResponse(currencyPayload));
        }
        if (url.includes('/setup-preview') && url.includes('startMode=copy')) {
          copyUrls.push(url);
          return Promise.resolve(jsonResponse(currencyPreview));
        }
        if (url.includes('/setup-preview')) {
          return Promise.resolve(
            jsonResponse({ ...preview(0), startMode: 'blank', packs: [] })
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    render(<BranchCreationDialog open onOpenChange={vi.fn()} />);
    await reachSetupPacks(user);
    await waitFor(() => expect(copyUrls.length).toBeGreaterThan(0));

    const membership = screen.getByRole('checkbox', {
      name: /Memberships & products/,
    });
    expect(membership.outerHTML).toContain('disabled');
    expect(membership.getAttribute('aria-checked')).toBe('false');
    expect(copyUrls[0]).not.toContain('pack=membership_catalog');
  });

  it('ignores a stale authoritative preview that resolves after the latest one', async () => {
    const user = userEvent.setup();
    const stale = deferred<Response>();
    const latest = deferred<Response>();
    let copyPreviewCalls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === '/api/branches') {
          return Promise.resolve(jsonResponse(branchesPayload));
        }
        if (url.includes('/setup-preview') && url.includes('startMode=blank')) {
          return Promise.resolve(
            jsonResponse({ ...preview(0), startMode: 'blank', packs: [] })
          );
        }
        if (url.includes('/setup-preview')) {
          copyPreviewCalls += 1;
          if (copyPreviewCalls === 1) {
            return Promise.resolve(jsonResponse(preview(13)));
          }
          if (copyPreviewCalls === 2) return stale.promise;
          if (copyPreviewCalls === 3) return latest.promise;
          return Promise.resolve(jsonResponse(preview(2)));
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    render(<BranchCreationDialog open onOpenChange={vi.fn()} />);
    await reachSetupPacks(user);
    await screen.findByText('13 configuration rows ready');

    await user.click(screen.getByRole('checkbox', { name: /Reminder timing/ }));
    await waitFor(() => expect(copyPreviewCalls).toBe(2));
    await user.click(
      screen.getByRole('checkbox', { name: /Memberships & products/ })
    );
    await waitFor(() => expect(copyPreviewCalls).toBe(3));

    await act(async () => latest.resolve(jsonResponse(preview(2))));
    await screen.findByText('2 configuration rows ready');
    await act(async () => stale.resolve(jsonResponse(preview(99))));

    await waitFor(() => {
      expect(screen.getByText('2 configuration rows ready')).toBeTruthy();
      expect(screen.queryByText('99 configuration rows ready')).toBeNull();
    });
  });

  it('guards double-submit, accepts a replay, and retries switching without another POST', async () => {
    const user = userEvent.setup();
    const post = deferred<Response>();
    let postCalls = 0;
    auth.switchBranch.mockRejectedValueOnce(new Error('navigation failed'));

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/branches' && init?.method === 'POST') {
          postCalls += 1;
          return post.promise;
        }
        if (url === '/api/branches') {
          return Promise.resolve(jsonResponse(branchesPayload));
        }
        if (url.includes('/setup-preview')) {
          return Promise.resolve(jsonResponse(preview(13)));
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    render(<BranchCreationDialog open onOpenChange={vi.fn()} />);
    await reachReview(user);

    const create = screen.getByRole('button', { name: 'Create branch' });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(postCalls).toBe(1);

    await act(async () =>
      post.resolve(jsonResponse(creationResult(true), 200))
    );
    await screen.findByText('Branch creation recovered');
    const retry = await screen.findByRole('button', { name: 'Retry switch' });
    expect(auth.switchBranch).toHaveBeenCalledTimes(1);

    auth.switchBranch.mockResolvedValueOnce(undefined);
    await user.click(retry);
    await waitFor(() => expect(auth.switchBranch).toHaveBeenCalledTimes(2));
    expect(postCalls).toBe(1);
  });
});
