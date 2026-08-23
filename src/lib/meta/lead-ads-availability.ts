export const META_LEADS_REVIEW_ACCOUNT_ID =
  '24094e14-83b9-4ecb-b6eb-7bafd740196d';

export const META_LEADS_REVIEW_CONFIG_ID = '1039026725782445';

export function resolveMetaLeadsConfigId(
  configuredId: string | undefined,
  accountId: string | null
): string | undefined {
  if (configuredId) return configuredId;

  return accountId === META_LEADS_REVIEW_ACCOUNT_ID
    ? META_LEADS_REVIEW_CONFIG_ID
    : undefined;
}
