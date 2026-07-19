'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { OnboardingProvider } from '@/hooks/use-onboarding-status';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AccountAppearanceSync } from '@/components/layout/account-appearance-sync';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { cn } from '@/lib/utils';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isLeadsPage = pathname.startsWith('/leads');
  const contentPaddingTop = isLeadsPage
    ? 'pt-6'
    : pathname === '/members'
      ? 'pt-6'
      : 'pt-3';

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      {/* Replaces the browser cache with this user's saved profile
          preference as soon as authentication/profile loading settles. */}
      <AccountAppearanceSync />
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Leads and Members use a roomier 24px separation below their
            tabbed headers; other routes retain the standard 12px gap. */}
        <main
          className={cn(
            'flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6',
            contentPaddingTop
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {/* Needs useAuth, so it sits inside AuthProvider. Shares the Get
          Started completion state between the sidebar and the page. */}
      <OnboardingProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </OnboardingProvider>
    </AuthProvider>
  );
}
