import { createClient } from '@supabase/supabase-js';

import { UnauthorizedError } from '@/lib/auth/account';

export interface MobileUserAccessDependencies {
  createSupabaseClient: typeof createClient;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function bearerToken(authorization: string | null): string {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
  if (!match) throw new UnauthorizedError();
  return match[1];
}

export function createMobileUserAccess(
  dependencies: MobileUserAccessDependencies = {
    createSupabaseClient: createClient,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
) {
  async function requireMobileUser(request: Request): Promise<{
    userId: string;
    accessToken: string;
  }> {
    const accessToken = bearerToken(request.headers.get('authorization'));
    const authClient = dependencies.createSupabaseClient(
      dependencies.supabaseUrl,
      dependencies.supabaseAnonKey
    );
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser(accessToken);
    if (error || !user) throw new UnauthorizedError();
    return { userId: user.id, accessToken };
  }

  return { requireMobileUser };
}

export const { requireMobileUser } = createMobileUserAccess();
