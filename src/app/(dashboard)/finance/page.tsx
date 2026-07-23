import { FinanceMasterView } from '@/components/finance/finance-master-view';
import {
  parseFinanceCollectionView,
  parseFinanceView,
} from '@/lib/finance/views';

type FinanceSearchParams = Promise<{
  view?: string | string[];
  table?: string | string[];
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: FinanceSearchParams;
}) {
  const params = await searchParams;

  return (
    <FinanceMasterView
      view={parseFinanceView(first(params.view))}
      collectionView={parseFinanceCollectionView(first(params.table))}
    />
  );
}
