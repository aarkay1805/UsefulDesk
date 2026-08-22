export interface MetaLeadPageHealthFields {
  status: string;
  health_lease_until: string | null;
  health_checked_at: string | null;
  last_healthy_at: string | null;
  last_repair_at: string | null;
  health_error_code: string | null;
  health_error_resolution: string | null;
  consecutive_health_failures: number;
}

export interface MetaLeadPageDisplay {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  reconnect: boolean;
  detail: string | null;
}

const RECONNECT_CODES = new Set([
  'token_invalid',
  'page_access_lost',
  'meta_access_error',
  'local_encryption_key_mismatch',
]);

export function resolveMetaLeadPageDisplay(
  page: MetaLeadPageHealthFields,
  now = new Date()
): MetaLeadPageDisplay {
  if (
    page.health_lease_until &&
    new Date(page.health_lease_until).getTime() > now.getTime()
  ) {
    return {
      label: 'Checking',
      variant: 'info',
      reconnect: false,
      detail: 'UsefulDesk is checking this connection.',
    };
  }
  if (page.health_error_code && RECONNECT_CODES.has(page.health_error_code)) {
    return {
      label: 'Reconnect required',
      variant: 'danger',
      reconnect: true,
      detail: page.health_error_resolution,
    };
  }
  if (
    page.status === 'error' ||
    page.consecutive_health_failures >= 3 ||
    page.health_error_code
  ) {
    return {
      label: 'Needs attention',
      variant: 'warning',
      reconnect: false,
      detail: page.health_error_resolution,
    };
  }
  if (
    page.last_repair_at &&
    page.health_checked_at &&
    Math.abs(
      new Date(page.last_repair_at).getTime() -
        new Date(page.health_checked_at).getTime()
    ) < 60_000
  ) {
    return {
      label: 'Repaired',
      variant: 'success',
      reconnect: false,
      detail: 'UsefulDesk restored the Lead Ads subscription.',
    };
  }
  if (page.last_healthy_at) {
    return {
      label: 'Healthy',
      variant: 'success',
      reconnect: false,
      detail: null,
    };
  }
  return {
    label: 'Connected',
    variant: 'neutral',
    reconnect: false,
    detail: 'The first automatic health check is pending.',
  };
}
