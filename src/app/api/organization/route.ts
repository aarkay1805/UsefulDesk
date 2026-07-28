import crypto from 'node:crypto';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { canDeleteOrganization } from '@/lib/auth/roles';
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

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { data: branchRows, error: branchError } =
      await ctx.supabase.rpc('my_branch_accounts');
    if (branchError) throw branchError;

    const current = (
      (branchRows ?? []) as {
        account_id: string;
        organization_id: string;
        organization_name: string;
        is_organization_owner: boolean;
      }[]
    ).find((branch) => branch.account_id === ctx.accountId);
    const organizationRole = current?.is_organization_owner ? 'owner' : null;
    if (
      !current ||
      current.organization_id !== ctx.account.organizationId ||
      !canDeleteOrganization(organizationRole)
    ) {
      throw new ForbiddenError(
        'Only an organization owner can delete the organization'
      );
    }

    const limit = checkRateLimit(
      `admin:delete-organization:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      confirm?: unknown;
    } | null;
    const confirm = typeof body?.confirm === 'string' ? body.confirm : '';
    if (confirm !== current.organization_name) {
      return NextResponse.json(
        {
          error:
            'Confirmation does not match. Type the organization name exactly to delete it.',
        },
        { status: 400 }
      );
    }

    const admin = createAdmin();
    const { data: accounts, error: accountsError } = await admin
      .from('accounts')
      .select('id, branch_status')
      .eq('organization_id', current.organization_id);
    if (accountsError) throw accountsError;
    const accountIds = (accounts ?? []).map((account) => account.id);
    if (accountIds.length === 0) {
      return NextResponse.json(
        { error: 'Organization has no branches to delete.' },
        { status: 409 }
      );
    }

    const confirmationCode = crypto.randomUUID();
    const { data: deletionRequest, error: auditError } = await admin
      .from('data_deletion_requests')
      .insert({
        source: 'organization_erasure',
        organization_id: current.organization_id,
        account_id: ctx.accountId,
        confirmation_code: confirmationCode,
        status: 'processing',
        details: { branchCount: accountIds.length },
      })
      .select('id')
      .single();
    if (auditError || !deletionRequest) {
      console.error(
        '[DELETE /api/organization] audit start failed:',
        auditError
      );
      return NextResponse.json(
        { error: 'Could not start the organization deletion audit.' },
        { status: 500 }
      );
    }

    const requestId = deletionRequest.id;
    let databaseDeleted = false;
    let stage = 'inventory';
    try {
      const [accountMemberships, organizationMemberships] = await Promise.all([
        fetchAllRows<{ user_id: string; account_id: string }>(
          async (from, to) => {
            const result = await admin
              .from('account_memberships')
              .select('user_id, account_id')
              .in('account_id', accountIds)
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
              .eq('organization_id', current.organization_id)
              .range(from, to);
            return {
              data: result.data as
                { user_id: string; organization_id: string }[] | null,
              error: result.error,
            };
          }
        ),
      ]);

      const organizationUserIds = Array.from(
        new Set([
          ...accountMemberships.map((membership) => membership.user_id),
          ...organizationMemberships.map((membership) => membership.user_id),
        ])
      );

      const [allAccountMemberships, allOrganizationMemberships] =
        organizationUserIds.length === 0
          ? [[], []]
          : await Promise.all([
              fetchAllRows<{ user_id: string; account_id: string }>(
                async (from, to) => {
                  const result = await admin
                    .from('account_memberships')
                    .select('user_id, account_id')
                    .in('user_id', organizationUserIds)
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
                    .in('user_id', organizationUserIds)
                    .range(from, to);
                  return {
                    data: result.data as
                      { user_id: string; organization_id: string }[] | null,
                    error: result.error,
                  };
                }
              ),
            ]);

      const accountIdSet = new Set(accountIds);
      const outsideMemberships = allAccountMemberships.filter(
        (membership) => !accountIdSet.has(membership.account_id)
      );
      const outsideOrganizationMemberships = allOrganizationMemberships.filter(
        (membership) => membership.organization_id !== current.organization_id
      );
      const usersWithOutsideAccess = new Set([
        ...outsideMemberships.map((membership) => membership.user_id),
        ...outsideOrganizationMemberships.map(
          (membership) => membership.user_id
        ),
      ]);
      const orphanUserIds = organizationUserIds.filter(
        (userId) => !usersWithOutsideAccess.has(userId)
      );

      const callerOutsideAccountIds = outsideMemberships
        .filter((membership) => membership.user_id === ctx.userId)
        .map((membership) => membership.account_id);
      let nextAccountId: string | null = null;
      if (callerOutsideAccountIds.length > 0) {
        const { data: nextAccounts, error: nextAccountsError } = await admin
          .from('accounts')
          .select('id, branch_status')
          .in('id', callerOutsideAccountIds);
        if (nextAccountsError) throw nextAccountsError;
        nextAccountId =
          nextAccounts?.find((account) => account.branch_status === 'active')
            ?.id ??
          nextAccounts?.find((account) => account.branch_status !== 'archived')
            ?.id ??
          null;
      }

      const exactRefs: StorageObjectRef[] = [];
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const contactRows = await fetchAllRows<{ avatar_url: string | null }>(
        async (from, to) => {
          const result = await admin
            .from('contacts')
            .select('avatar_url')
            .in('account_id', accountIds)
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
          .in('account_id', accountIds)
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
        accountIds,
        orphanUserIds,
        exactRefs
      );

      stage = 'database';
      const { data: deletedRows, error: deleteError } = await ctx.supabase.rpc(
        'delete_organization',
        { p_organization_id: current.organization_id }
      );
      if (deleteError) throw deleteError;
      databaseDeleted = true;
      const deletedBranches =
        (
          deletedRows as { deleted_account_count?: number }[] | null | undefined
        )?.[0]?.deleted_account_count ?? accountIds.length;

      stage = 'auth_cleanup';
      let deletedUsers = 0;
      const authCleanupFailures: string[] = [];
      const orderedOrphanIds = [
        ...orphanUserIds.filter((userId) => userId !== ctx.userId),
        ...orphanUserIds.filter((userId) => userId === ctx.userId),
      ];
      for (const userId of orderedOrphanIds) {
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
            branchCount: deletedBranches,
            storageObjectCount: deletedStorageObjects,
            deletedAuthUserCount: deletedUsers,
            authCleanupFailureCount: authCleanupFailures.length,
          },
        })
        .eq('id', requestId);

      return NextResponse.json({
        success: true,
        deletedBranches,
        deletedUsers,
        nextAccountId,
        warningCount: authCleanupFailures.length,
      });
    } catch (error) {
      console.error('[DELETE /api/organization] deletion failed:', error);
      await markDeletionFailed(admin, requestId, stage);
      return NextResponse.json(
        databaseDeleted
          ? {
              error:
                'Organization data was deleted, but final login cleanup needs administrator attention.',
            }
          : {
              error:
                stage === 'database'
                  ? 'Stored media was removed, but database deletion failed. Retry the organization deletion.'
                  : 'Failed to delete the organization. Database data was not removed.',
            },
        { status: 500 }
      );
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
