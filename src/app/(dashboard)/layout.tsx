import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
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

  return <DashboardShell>{children}</DashboardShell>;
}
