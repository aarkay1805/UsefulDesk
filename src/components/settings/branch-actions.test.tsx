// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BranchAccount } from '@/hooks/use-auth';

const auth = vi.hoisted(() => ({
  branches: [] as BranchAccount[],
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => auth,
}));

vi.mock('@/hooks/use-can', () => ({
  useCan: () => false,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { BranchActions } from './branch-actions';

const branch: BranchAccount = {
  account_id: '11111111-1111-4111-8111-111111111111',
  account_name: 'Central',
  organization_id: '22222222-2222-4222-8222-222222222222',
  organization_name: 'Useful Fitness',
  legal_entity_id: '33333333-3333-4333-8333-333333333333',
  legal_entity_name: 'Useful Fitness Pvt Ltd',
  legal_entity_legal_name: 'Useful Fitness Pvt Ltd',
  role: 'owner',
  branch_status: 'active',
  readiness_state: 'ready',
  default_currency: 'INR',
  timezone: 'Asia/Kolkata',
  is_organization_owner: false,
  setup_reviewed_at: null,
  setup_reviewed_by: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function openRenameDialog() {
  screen.getByRole('button', { name: 'Manage Central' }).focus();
  await userEvent.keyboard(' ');
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Rename branch' })
  );
}

describe('BranchActions', () => {
  it('offers rename to the branch owner without organization lifecycle actions', async () => {
    render(<BranchActions branch={branch} selected={false} />);

    await openRenameDialog();

    expect(screen.getByRole('dialog', { name: 'Rename Central' })).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Branch name' }) as HTMLInputElement)
        .value
    ).toBe('Central');
    expect(
      screen.queryByRole('menuitem', { name: 'Archive branch' })
    ).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: 'Delete branch' })
    ).toBeNull();
  });

  it('submits the trimmed name once and marks the save action busy', async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(() => response.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(<BranchActions branch={branch} selected={false} />);
    await openRenameDialog();

    const input = screen.getByRole('textbox', { name: 'Branch name' });
    await userEvent.clear(input);
    await userEvent.type(input, '  South  ');
    const save = screen.getByRole('button', { name: 'Save name' });
    await userEvent.click(save);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      action: 'rename',
      name: 'South',
    });
    expect(save.getAttribute('aria-busy')).toBe('true');

    response.resolve(
      new Response(JSON.stringify({ error: 'Rename unavailable' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await waitFor(() => expect(save.getAttribute('aria-busy')).toBeNull());
  });

  it('allows an 80-character Unicode branch name', async () => {
    const name = '😀'.repeat(80);
    render(<BranchActions branch={branch} selected={false} />);
    await openRenameDialog();

    const input = screen.getByRole('textbox', {
      name: 'Branch name',
    }) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, name);

    expect(input.value).toBe(name);
    expect(
      screen.getByRole('button', { name: 'Save name' }).hasAttribute('disabled')
    ).toBe(false);
  });

  it('explains when a branch name exceeds 80 characters', async () => {
    render(<BranchActions branch={branch} selected={false} />);
    await openRenameDialog();

    const input = screen.getByRole('textbox', { name: 'Branch name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'B'.repeat(81));

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(
      'Branch name must be 80 characters or fewer.'
    );
    expect(
      screen.getByRole('button', { name: 'Save name' }).hasAttribute('disabled')
    ).toBe(true);
  });
});
