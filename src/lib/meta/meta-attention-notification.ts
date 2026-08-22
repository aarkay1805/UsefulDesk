import { branchHref } from '@/lib/auth/branch-context';

export function notificationDestination(notification: {
  type: string;
  account_id: string;
}): string | null {
  if (notification.type !== 'meta_leads_attention') return null;
  return branchHref('/settings?tab=capture', notification.account_id);
}
