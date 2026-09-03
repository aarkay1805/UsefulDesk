type Revoker = (accessToken: string) => Promise<void>;

let revoker: Revoker | null = null;

export function registerNotificationRevoker(next: Revoker): () => void {
  revoker = next;
  return () => {
    if (revoker === next) revoker = null;
  };
}

export async function revokeNotificationsBeforeCredentialTeardown(
  accessToken: string
): Promise<void> {
  await revoker?.(accessToken);
}
