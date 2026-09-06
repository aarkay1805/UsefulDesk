import { canManagePlatformAccess } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import {
  PlatformAdmin,
  PlatformAdminSignIn,
} from '@/components/platform-access/platform-admin';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
export const metadata = { title: 'Platform administration' };
export default async function PlatformAdminPage() {
  const supabase = await createClient(null);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <PlatformAdminSignIn />;
  const { data, error } = await supabase.rpc('platform_admin_status');
  if (error || !data?.is_admin)
    return (
      <main className="mx-auto max-w-xl p-6">
        <Alert>
          <AlertTitle>Access unavailable</AlertTitle>
          <AlertDescription>
            This page is available only to provisioned platform administrators.
          </AlertDescription>
        </Alert>
      </main>
    );
  return (
    <PlatformAdmin
      mfaRequired={
        !canManagePlatformAccess(
          data.is_admin === true,
          data.mfa_required === false ? 'aal2' : 'aal1'
        )
      }
    />
  );
}
