import { redirect } from 'next/navigation';

import { branchHref } from '@/lib/auth/branch-context';
import { financeHref } from '@/lib/finance/views';

type ReportsSearchParams = Promise<{
  branch?: string | string[];
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: ReportsSearchParams;
}) {
  const params = await searchParams;
  redirect(
    branchHref(financeHref('performance'), first(params.branch) ?? null)
  );
}
