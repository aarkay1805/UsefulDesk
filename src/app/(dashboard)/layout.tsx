import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BRANCH_HEADER } from '@/lib/auth/branch-context';
import { loadDashboardAuthBootstrap } from '@/lib/auth/dashboard-bootstrap';
import { DashboardShell } from './dashboard-shell';

// Server layout for the authenticated app. The proxy provides the fast redirect,
// but this boundary independently verifies the user before any dashboard shell
// or page renders. Metadata remains a crawler-level belt-and-suspenders guard.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const requestHeaders = await headers();
  const bootstrap = await loadDashboardAuthBootstrap(
    supabase,
    user.id,
    requestHeaders.get(BRANCH_HEADER)
  );

  return (
    <DashboardShell initialUser={user} initialBootstrap={bootstrap}>
      {children}
    </DashboardShell>
  );
}
