import { MemberPurchasePage } from './member-purchase-page';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PurchasePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const membershipId =
    typeof query.membership === 'string' ? query.membership : null;
  const returnTo = typeof query.returnTo === 'string' ? query.returnTo : null;

  return <MemberPurchasePage membershipId={membershipId} returnTo={returnTo} />;
}
