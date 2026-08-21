'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { branchHref } from '@/lib/auth/branch-context';

type BranchLinkProps = ComponentProps<typeof Link>;

/** Internal Link that keeps the currently selected branch in the URL. */
export function BranchLink({ href, ...props }: BranchLinkProps) {
  const { accountId } = useAuth();
  const scopedHref =
    typeof href === 'string' ? branchHref(href, accountId) : href;

  return <Link {...props} href={scopedHref} />;
}
