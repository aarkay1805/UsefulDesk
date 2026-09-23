'use client';

import { Building2, Check } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { BranchActions } from './branch-actions';
import { OrganizationDangerZone } from './organization-danger-zone';
import { ROLE_META } from './role-meta';
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
  if (status === 'read_only') return 'View only';
  if (status === 'archived') return 'Closed';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function OrganizationSettings() {
  const { account, branches, isOrganizationOwner } = useAuth();
  if (!account) return null;

  const current = branches.find((branch) => branch.account_id === account.id);
  const organizationName = current?.organization_name ?? 'Organization';

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200 motion-reduce:animate-none">
      <SettingsPanelHead
        title="Branches"
        description="See the branches you can use and manage your gym group."
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="text-primary-text size-4" />
            <span className="truncate">{organizationName}</span>
          </CardTitle>
          <CardDescription>
            {branches.length} branch{branches.length === 1 ? '' : 'es'} you can
            use
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <ul className="divide-border divide-y">
            {branches.map((branch) => {
              const selected = branch.account_id === account.id;
              return (
                <li
                  key={branch.account_id}
                  className={
                    selected
                      ? 'bg-primary/5 flex items-start gap-3 px-4 py-3.5 sm:items-center'
                      : 'flex items-start gap-3 px-4 py-3.5 sm:items-center'
                  }
                >
                  <span className="bg-muted mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg sm:mt-0">
                    <Building2 className="text-muted-foreground size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {branch.account_name}
                      </p>
                      {selected ? (
                        <span className="text-primary-text hidden shrink-0 items-center gap-1 text-xs font-medium sm:inline-flex">
                          <Check className="size-3.5" />
                          Current
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {branch.legal_entity_name} ·{' '}
                      {ROLE_META[branch.role].label}
                    </p>
                    <div className="mt-2 flex items-center gap-2 sm:hidden">
                      <Badge
                        variant={branchStatusVariant(branch.branch_status)}
                      >
                        {branchStatusLabel(branch.branch_status)}
                      </Badge>
                      {selected ? (
                        <span className="text-primary-text inline-flex items-center gap-1 text-xs font-medium">
                          <Check className="size-3.5" />
                          Current branch
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="hidden sm:block">
                      <Badge
                        variant={branchStatusVariant(branch.branch_status)}
                      >
                        {branchStatusLabel(branch.branch_status)}
                      </Badge>
                    </div>
                    <BranchActions branch={branch} selected={selected} />
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>

        <CardFooter>
          <p className="text-muted-foreground text-xs">
            Use the branch menu on the left to add or switch branches.
          </p>
        </CardFooter>
      </Card>

      {isOrganizationOwner ? (
        <div className="mt-6 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Delete gym group</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Delete this gym group and every branch in it. This cannot be
              undone.
            </p>
          </div>
          <OrganizationDangerZone />
        </div>
      ) : null}
    </section>
  );
}
