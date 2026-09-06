export type AccessMode = 'trial' | 'manual' | 'complimentary';
export type AccessStatus =
  'trial' | 'active' | 'complimentary' | 'expired' | 'suspended' | 'pending';
export interface OrganizationAccess {
  organization_id: string;
  mode: AccessMode;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  access_starts_at: string | null;
  access_ends_at: string | null;
  suspended_at: string | null;
  version: number;
}
export interface ProductAccessSnapshot {
  access: OrganizationAccess;
  status: AccessStatus;
  allowed: boolean;
  enforcement_enabled: boolean;
  support_email: string | null;
  support_whatsapp: string | null;
}
export type AccessAction = 'extend_trial' | 'activate' | 'suspend' | 'restore';
export function resolveProductAccess(
  access: OrganizationAccess,
  now: number
): { status: AccessStatus; allowed: boolean } {
  if (access.suspended_at) return { status: 'suspended', allowed: false };
  if (access.mode === 'complimentary')
    return { status: 'complimentary', allowed: true };
  const start =
    access.mode === 'trial' ? access.trial_started_at : access.access_starts_at;
  const end =
    access.mode === 'trial' ? access.trial_ends_at : access.access_ends_at;
  if (
    !start ||
    !end ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end))
  )
    return { status: 'pending', allowed: false };
  if (now < Date.parse(start)) return { status: 'pending', allowed: false };
  if (now >= Date.parse(end)) return { status: 'expired', allowed: false };
  return {
    status: access.mode === 'trial' ? 'trial' : 'active',
    allowed: true,
  };
}

/** Validate the RPC protocol before any client or server treats it as a grant. */
export function isProductAccessSnapshot(
  value: unknown,
  expectedOrganizationId?: string
): value is ProductAccessSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.allowed !== 'boolean' ||
    typeof snapshot.enforcement_enabled !== 'boolean' ||
    typeof snapshot.status !== 'string' ||
    ![
      'trial',
      'active',
      'complimentary',
      'expired',
      'suspended',
      'pending',
    ].includes(snapshot.status)
  )
    return false;
  for (const key of ['support_email', 'support_whatsapp']) {
    if (snapshot[key] !== null && typeof snapshot[key] !== 'string')
      return false;
  }
  if (
    !snapshot.access ||
    typeof snapshot.access !== 'object' ||
    Array.isArray(snapshot.access)
  )
    return false;
  const access = snapshot.access as Record<string, unknown>;
  if (
    typeof access.organization_id !== 'string' ||
    !access.organization_id.trim() ||
    (expectedOrganizationId !== undefined &&
      access.organization_id !== expectedOrganizationId) ||
    typeof access.mode !== 'string' ||
    !['trial', 'manual', 'complimentary'].includes(access.mode) ||
    typeof access.version !== 'number' ||
    !Number.isSafeInteger(access.version) ||
    access.version < 1
  )
    return false;
  for (const key of [
    'trial_started_at',
    'trial_ends_at',
    'access_starts_at',
    'access_ends_at',
    'suspended_at',
  ]) {
    const timestamp = access[key];
    if (
      timestamp !== null &&
      (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)))
    )
      return false;
  }
  return true;
}
