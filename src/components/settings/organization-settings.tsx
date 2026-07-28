'use client';

import { Check, Building2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AccountDangerZone } from './account-danger-zone';
import { OrganizationDangerZone } from './organization-danger-zone';
import { SettingsPanelHead } from './settings-panel-head';

function branchStatusVariant(
  status: 'active' | 'read_only' | 'archived'
): 'success' | 'warning' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'read_only') return 'warning';
  return 'neutral';
}

function branchStatusLabel(
  status: 'active' | 'read_only' | 'archived'
): string {
  if (status === 'read_only') return 'Read only';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function OrganizationSettings() {
  const { account, branches, isOrganizationOwner } = useAuth();
  if (!account) return null;

  const current = branches.find((branch) => branch.account_id === account.id);
  const organizationName = current?.organization_name ?? 'Organization';

  return (
    <section>
      <SettingsPanelHead
        title="Organization & branches"
        description="Review branch access and manage irreversible organization lifecycle actions."
      />

      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="bg-muted flex size-9 items-center justify-center rounded-lg">
              <Building2 className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {organizationName}
              </p>
              <p className="text-muted-foreground text-xs">
                {branches.length} branch{branches.length === 1 ? '' : 'es'}
              </p>
            </div>
          </div>

          <div className="border-border mt-4 divide-y border-y">
            {branches.map((branch) => {
              const selected = branch.account_id === account.id;
              return (
                <div
                  key={branch.account_id}
                  className="flex items-center gap-3 py-3"
                >
                  <Building2 className="text-muted-foreground size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {branch.account_name}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {branch.legal_entity_name} · {branch.role}
                    </p>
                  </div>
                  <Badge variant={branchStatusVariant(branch.branch_status)}>
                    {branchStatusLabel(branch.branch_status)}
                  </Badge>
                  {selected ? (
                    <Check
                      className="text-primary-text size-4 shrink-0"
                      aria-label="Current branch"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="text-muted-foreground mt-3 text-xs">
            Add or switch branches from the branch selector in the sidebar.
          </p>
        </CardContent>
      </Card>

      {isOrganizationOwner ? (
        <div className="mt-6 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Danger zone</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Archive only the current branch, or permanently erase the entire
              organization.
            </p>
          </div>
          <AccountDangerZone />
          <OrganizationDangerZone />
        </div>
      ) : null}
    </section>
  );
}
