import { describe, expect, it, vi } from 'vitest';

import { createMobileOperationalAccess } from './mobile-operational-access';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

type RowResult = { data: unknown; error: unknown };

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/whatsapp/send', {
    headers,
  });
}

function rlsClient(rows: Record<string, RowResult>) {
  const calls: Array<{ table: string; filters: [string, unknown][] }> = [];
  const from = vi.fn((table: string) => {
    const call = { table, filters: [] as [string, unknown][] };
    calls.push(call);
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((field: string, value: unknown) => {
        call.filters.push([field, value]);
        return builder;
      }),
      maybeSingle: vi.fn(
        async () => rows[table] ?? { data: null, error: null }
      ),
    };
    return builder;
  });

  return { client: { from }, calls };
}

function accessFor(options: {
  user?: { id: string } | null;
  userError?: unknown;
  rows?: Record<string, RowResult>;
}) {
  const auth = {
    getUser: vi.fn(async () => ({
      data: {
        user: options.user === undefined ? { id: USER_ID } : options.user,
      },
      error: options.userError ?? null,
    })),
  };
  const rls = rlsClient(
    options.rows ?? {
      profiles: { data: { user_id: USER_ID }, error: null },
      account_memberships: { data: { role: 'agent' }, error: null },
      accounts: {
        data: {
          id: ACCOUNT_ID,
          name: 'Main branch',
          organization_id: 'org-1',
          legal_entity_id: 'entity-1',
          branch_status: 'active',
          readiness_state: 'ready',
        },
        error: null,
      },
    }
  );
  const createSupabaseClient = vi
    .fn()
    .mockReturnValueOnce({ auth })
    .mockReturnValueOnce(rls.client);
  const access = createMobileOperationalAccess({
    createSupabaseClient: createSupabaseClient as never,
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
  });

  return { access, auth, rls, createSupabaseClient };
}

describe('mobile operational access', () => {
  it.each([
    ['lowercase scheme', 'bearer access-token'],
    ['bare token', 'access-token'],
    ['extra whitespace', 'Bearer  access-token'],
  ])(
    'rejects %s bearer authorization before database access',
    async (_name, authorization) => {
      const { access, auth, createSupabaseClient } = accessFor({});

      await expect(
        access.requireMobileOperationalAccess(
          request({ authorization, 'x-usefuldesk-account-id': ACCOUNT_ID })
        )
      ).rejects.toMatchObject({ status: 401 });

      expect(auth.getUser).not.toHaveBeenCalled();
      expect(createSupabaseClient).not.toHaveBeenCalled();
    }
  );

  it('requires an explicit selected branch before database access', async () => {
    const { access, auth, createSupabaseClient } = accessFor({});

    await expect(
      access.requireMobileOperationalAccess(
        request({ authorization: 'Bearer access-token' })
      )
    ).rejects.toMatchObject({ status: 403 });

    expect(auth.getUser).not.toHaveBeenCalled();
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it('rejects an access token that Supabase cannot validate', async () => {
    const { access, auth, createSupabaseClient } = accessFor({
      user: null,
      userError: { message: 'JWT expired' },
    });

    await expect(
      access.requireMobileOperationalAccess(
        request({
          authorization: 'Bearer access-token',
          'x-usefuldesk-account-id': ACCOUNT_ID,
        })
      )
    ).rejects.toMatchObject({ status: 401 });

    expect(auth.getUser).toHaveBeenCalledWith('access-token');
    expect(createSupabaseClient).toHaveBeenCalledTimes(1);
  });

  it('rejects an archived branch before operational access is granted', async () => {
    const { access } = accessFor({
      rows: {
        profiles: { data: { user_id: USER_ID }, error: null },
        account_memberships: { data: { role: 'agent' }, error: null },
        accounts: {
          data: {
            id: ACCOUNT_ID,
            name: 'Archived branch',
            organization_id: 'org-1',
            legal_entity_id: 'entity-1',
            branch_status: 'archived',
            readiness_state: 'attention',
          },
          error: null,
        },
      },
    });

    await expect(
      access.requireMobileOperationalAccess(
        request({
          authorization: 'Bearer access-token',
          'x-usefuldesk-account-id': ACCOUNT_ID,
        })
      )
    ).rejects.toMatchObject({
      status: 403,
      message: 'This branch is not active',
    });
  });

  it('rejects a user without an active selected-branch membership', async () => {
    const { access, rls } = accessFor({
      rows: {
        profiles: { data: { user_id: USER_ID }, error: null },
        account_memberships: { data: null, error: null },
      },
    });

    await expect(
      access.requireMobileOperationalAccess(
        request({
          authorization: 'Bearer access-token',
          'x-usefuldesk-account-id': ACCOUNT_ID,
        })
      )
    ).rejects.toMatchObject({
      status: 403,
      message: 'You do not have access to this branch',
    });

    expect(rls.calls.map((call) => call.table)).toEqual([
      'profiles',
      'account_memberships',
    ]);
  });

  it('rejects a viewer before granting mobile send access', async () => {
    const { access } = accessFor({
      rows: {
        profiles: { data: { user_id: USER_ID }, error: null },
        account_memberships: { data: { role: 'viewer' }, error: null },
        accounts: {
          data: {
            id: ACCOUNT_ID,
            name: 'Main branch',
            organization_id: 'org-1',
            legal_entity_id: 'entity-1',
            branch_status: 'active',
            readiness_state: 'ready',
          },
          error: null,
        },
      },
    });

    await expect(
      access.requireMobileOperationalAccess(
        request({
          authorization: 'Bearer access-token',
          'x-usefuldesk-account-id': ACCOUNT_ID,
        })
      )
    ).rejects.toMatchObject({
      status: 403,
      message: 'This action requires operational access',
    });
  });

  it('authorizes only an active agent in the explicit selected branch', async () => {
    const { access, createSupabaseClient, rls } = accessFor({});

    const result = await access.requireMobileOperationalAccess(
      request({
        authorization: 'Bearer access-token',
        'x-usefuldesk-account-id': ACCOUNT_ID,
      })
    );

    expect(result.userId).toBe(USER_ID);
    expect(result.accountId).toBe(ACCOUNT_ID);
    expect(result.role).toBe('agent');
    expect(createSupabaseClient).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co',
      'anon-key',
      {
        global: {
          headers: {
            Authorization: 'Bearer access-token',
            'x-usefuldesk-account-id': ACCOUNT_ID,
          },
        },
      }
    );
    expect(rls.calls).toEqual([
      { table: 'profiles', filters: [['user_id', USER_ID]] },
      {
        table: 'account_memberships',
        filters: [
          ['account_id', ACCOUNT_ID],
          ['user_id', USER_ID],
        ],
      },
      { table: 'accounts', filters: [['id', ACCOUNT_ID]] },
    ]);
  });
});
