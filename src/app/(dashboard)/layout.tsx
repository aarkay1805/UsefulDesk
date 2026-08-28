import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { UnauthorizedError } from '@/lib/auth/account';
import { getDashboardRequestContext } from '@/lib/auth/dashboard-request-context';
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
  let context;
  try {
    context = await getDashboardRequestContext();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect('/login');
    throw error;
  }

  return (
    <DashboardShell
      initialUser={context.user}
      initialBootstrap={context.bootstrap}
    >
      {children}
    </DashboardShell>
  );
}
