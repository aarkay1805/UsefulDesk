import crypto from 'node:crypto';

import {
  createClient as createAdminClient,
  type PostgrestError,
} from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { canManageBranchLifecycle, type AccountRole } from '@/lib/auth/roles';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  collectStorageObjectRefs,
  purgeOrganizationStorage,
  type StorageObjectRef,
} from '@/lib/storage/organization-erasure';

interface BranchRow {
  account_id: string;
  account_name: string;
  organization_id: string;
  organization_name: string;
  role: AccountRole;
  branch_status: 'active' | 'read_only' | 'archived';
  is_organization_owner: boolean;
}

interface ErrorLike {
  message: string;
}

interface PageResult<T> {
  data: T[] | null;
  error: ErrorLike | null;
}

async function fetchAllRows<T>(
  load: (from: number, to: number) => Promise<PageResult<T>>
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;

  while (true) {
    const result = await load(rows.length, rows.length + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function createAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );
}

function rpcErrorToResponse(error: PostgrestError, fallback: string) {
  if (error.code === '42501') {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error.code === '22023') {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error.code === '55000') {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  console.error('[branch lifecycle] unexpected RPC error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

async function resolveTarget(accountId: string): Promise<{
  ctx: Awaited<ReturnType<typeof getCurrentAccount>>;
  target: BranchRow;
}> {
  if (!isBranchAccountId(accountId)) {
    throw new ForbiddenError('Invalid branch');
  }

  const ctx = await getCurrentAccount();
  const { data, error } = await ctx.supabase.rpc('my_branch_accounts');
  if (error) throw error;

  const target = ((data ?? []) as BranchRow[]).find(
    (branch) => branch.account_id === accountId
  );
  const organizationRole = target?.is_organization_owner ? 'owner' : null;
  if (
    !target ||
    target.organization_id !== ctx.account.organizationId ||
    !canManageBranchLifecycle(organizationRole, target.role)
  ) {
    throw new ForbiddenError(
      'Only an organization owner who owns the branch can manage it'
    );
  }

  return { ctx, target };
}

async function markDeletionFailed(
  admin: ReturnType<typeof createAdmin>,
  requestId: string,
  stage: string
) {
  await admin
    .from('data_deletion_requests')
    .update({
      status: 'failed',
      details: { failedStage: stage },
    })
    .eq('id', requestId);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const { ctx, target } = await resolveTarget(accountId);
    const limit = checkRateLimit(
      `admin:branch-lifecycle:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      confirm?: unknown;
    } | null;
    const action = body?.action;
    if (action !== 'archive' && action !== 'restore') {
      return NextResponse.json(
        { error: "'action' must be archive or restore" },
        { status: 400 }
      );
    }

    if (action === 'archive' && body?.confirm !== target.account_name) {
      return NextResponse.json(
        {
          error:
            'Confirmation does not match. Type the branch name exactly to archive it.',
        },
        { status: 400 }
      );
    }

    const rpcName = action === 'archive' ? 'archive_branch' : 'restore_branch';
    const { error } = await ctx.supabase.rpc(rpcName, {
      p_account_id: accountId,
    });
    if (error) {
      return rpcErrorToResponse(
        error,
        action === 'archive'
          ? 'Failed to archive the branch.'
          : 'Failed to restore the branch.'
      );
    }

    return NextResponse.json({ success: true, action });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const { ctx, target } = await resolveTarget(accountId);
    const limit = checkRateLimit(
      `admin:delete-branch:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      confirm?: unknown;
    } | null;
    if (body?.confirm !== target.account_name) {
      return NextResponse.json(
        {
          error:
            'Confirmation does not match. Type the branch name exactly to delete it.',
        },
        { status: 400 }
      );
    }

    const admin = createAdmin();
    const { data: organizationAccounts, error: accountsError } = await admin
      .from('accounts')
      .select('id, branch_status')
      .eq('organization_id', target.organization_id);
    if (accountsError) throw accountsError;

    if ((organizationAccounts ?? []).length <= 1) {
      return NextResponse.json(
        {
          error:
            'The final branch cannot be deleted. Delete the organization instead.',
        },
        { status: 409 }
      );
    }
    if (
      !(organizationAccounts ?? []).some(
        (branch) => branch.id !== accountId && branch.branch_status === 'active'
      )
    ) {
      return NextResponse.json(
        { error: 'At least one other active branch must remain.' },
        { status: 409 }
      );
    }

    const confirmationCode = crypto.randomUUID();
    const { data: deletionRequest, error: auditError } = await admin
      .from('data_deletion_requests')
      .insert({
        source: 'branch_erasure',
        organization_id: target.organization_id,
        account_id: accountId,
        confirmation_code: confirmationCode,
        status: 'processing',
        details: {
          branchName: target.account_name,
          previousStatus: target.branch_status,
        },
      })
      .select('id')
      .single();
    if (auditError || !deletionRequest) {
      console.error('[DELETE branch] audit start failed:', auditError);
      return NextResponse.json(
        { error: 'Could not start the branch deletion audit.' },
        { status: 500 }
      );
    }

    const requestId = deletionRequest.id;
    let databaseDeleted = false;
    let stage = 'inventory';
    try {
      const targetMemberships = await fetchAllRows<{ user_id: string }>(
        async (from, to) => {
          const result = await admin
            .from('account_memberships')
            .select('user_id')
            .eq('account_id', accountId)
            .range(from, to);
          return {
            data: result.data as { user_id: string }[] | null,
            error: result.error,
          };
        }
      );
      const userIds = Array.from(
        new Set(targetMemberships.map((membership) => membership.user_id))
      );

      const [otherAccountMemberships, organizationMemberships] =
        userIds.length === 0
          ? [[], []]
          : await Promise.all([
              fetchAllRows<{ user_id: string; account_id: string }>(
                async (from, to) => {
                  const result = await admin
                    .from('account_memberships')
                    .select('user_id, account_id')
                    .in('user_id', userIds)
                    .neq('account_id', accountId)
                    .range(from, to);
                  return {
                    data: result.data as
                      { user_id: string; account_id: string }[] | null,
                    error: result.error,
                  };
                }
              ),
              fetchAllRows<{ user_id: string; organization_id: string }>(
                async (from, to) => {
                  const result = await admin
                    .from('organization_memberships')
                    .select('user_id, organization_id')
                    .in('user_id', userIds)
                    .range(from, to);
                  return {
                    data: result.data as
                      { user_id: string; organization_id: string }[] | null,
                    error: result.error,
                  };
                }
              ),
            ]);

      const usersWithRemainingAccess = new Set([
        ...otherAccountMemberships.map((membership) => membership.user_id),
        ...organizationMemberships.map((membership) => membership.user_id),
      ]);
      const orphanUserIds = userIds.filter(
        (userId) => !usersWithRemainingAccess.has(userId)
      );

      const exactRefs: StorageObjectRef[] = [];
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const contactRows = await fetchAllRows<{ avatar_url: string | null }>(
        async (from, to) => {
          const result = await admin
            .from('contacts')
            .select('avatar_url')
            .eq('account_id', accountId)
            .not('avatar_url', 'is', null)
            .range(from, to);
          return {
            data: result.data as { avatar_url: string | null }[] | null,
            error: result.error,
          };
        }
      );
      for (const contact of contactRows) {
        collectStorageObjectRefs(contact.avatar_url, supabaseUrl, exactRefs);
      }

      const flows = await fetchAllRows<{ id: string }>(async (from, to) => {
        const result = await admin
          .from('flows')
          .select('id')
          .eq('account_id', accountId)
          .range(from, to);
        return {
          data: result.data as { id: string }[] | null,
          error: result.error,
        };
      });
      const flowIds = flows.map((flow) => flow.id);
      if (flowIds.length > 0) {
        const nodeRows = await fetchAllRows<{ config: unknown }>(
          async (from, to) => {
            const result = await admin
              .from('flow_nodes')
              .select('config')
              .in('flow_id', flowIds)
              .range(from, to);
            return {
              data: result.data as { config: unknown }[] | null,
              error: result.error,
            };
          }
        );
        for (const node of nodeRows) {
          collectStorageObjectRefs(node.config, supabaseUrl, exactRefs);
        }
      }

      stage = 'storage';
      const deletedStorageObjects = await purgeOrganizationStorage(
        admin,
        [accountId],
        orphanUserIds,
        exactRefs
      );

      stage = 'database';
      const { data: deletedRows, error: deleteError } = await ctx.supabase.rpc(
        'delete_branch',
        { p_account_id: accountId }
      );
      if (deleteError) throw deleteError;
      databaseDeleted = true;

      const result = (
        deletedRows as
          | {
              next_account_id?: string;
              deleted_account_name?: string;
            }[]
          | null
          | undefined
      )?.[0];

      stage = 'auth_cleanup';
      let deletedUsers = 0;
      const authCleanupFailures: string[] = [];
      for (const userId of orphanUserIds) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) authCleanupFailures.push(userId);
        else deletedUsers += 1;
      }

      await admin
        .from('data_deletion_requests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          details: {
            branchName: result?.deleted_account_name ?? target.account_name,
            storageObjectCount: deletedStorageObjects,
            deletedAuthUserCount: deletedUsers,
            authCleanupFailureCount: authCleanupFailures.length,
          },
        })
        .eq('id', requestId);

      return NextResponse.json({
        success: true,
        nextAccountId: result?.next_account_id ?? null,
        deletedUsers,
        warningCount: authCleanupFailures.length,
      });
    } catch (error) {
      console.error('[DELETE branch] deletion failed:', error);
      await markDeletionFailed(admin, requestId, stage);
      return NextResponse.json(
        databaseDeleted
          ? {
              error:
                'The branch was deleted, but final login cleanup needs administrator attention.',
            }
          : {
              error:
                stage === 'database'
                  ? 'Stored media was removed, but database deletion failed. Retry the branch deletion.'
                  : 'Failed to delete the branch. Database data was not removed.',
            },
        { status: 500 }
      );
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
