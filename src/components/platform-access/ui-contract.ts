import type {
  AccessAction,
  AccessStatus,
  OrganizationAccess,
} from '@/lib/platform-access/model';

export function availableAccessActions(
  access: OrganizationAccess,
  status: AccessStatus
): AccessAction[] {
  if (access.suspended_at || status === 'suspended') return ['restore'];
  return access.mode === 'trial'
    ? ['extend_trial', 'activate', 'suspend']
    : ['activate', 'suspend'];
}
export function validAccessReason(reason: string): boolean {
  const length = reason.trim().length;
  return length >= 3 && length <= 1000;
}
export function accessSupportMessage(
  organizationName: string,
  reference: string
): string {
  return `Please help with UsefulDesk access for ${organizationName}. Support reference: ${reference}.`;
}
export function accessSupportWhatsApp(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}
