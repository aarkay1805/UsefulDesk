'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { OnboardingProvider } from '@/hooks/use-onboarding-status';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AccountAppearanceSync } from '@/components/layout/account-appearance-sync';
import { AccountAccessAlert } from '@/components/layout/account-access-alert';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { useNotificationAudio } from '@/hooks/use-notification-audio';
import { useFollowUpReminderRingtone } from '@/hooks/use-follow-up-reminder-ringtone';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const {
    user,
    loading,
    accountStatus,
    branchAccessError,
    branches,
    switchBranch,
    refreshProfile,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const hasRoomyContentTop =
    pathname.startsWith('/leads') || pathname === '/members';
  const contentPaddingTop = hasRoomyContentTop
    ? 'pt-6'
    : pathname === '/finance' || pathname === '/dashboard'
      ? 'pt-5'
      : 'pt-3';

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [retryingBranchAccess, setRetryingBranchAccess] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const retryBranchAccess = async () => {
    setRetryingBranchAccess(true);
    try {
      await refreshProfile();
    } finally {
      setRetryingBranchAccess(false);
    }
  };

  // Browser audio is armed only after interaction. The reminder listener is
  // dashboard-wide so it survives navigation and stops on realtime read_at.
  useNotificationAudio(Boolean(user));
  useFollowUpReminderRingtone(Boolean(user));

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

  // Keep the fail-closed screen mounted while an in-place retry is loading.
  // Otherwise profileLoading would briefly reveal the dashboard underneath.
  if (branchAccessError) {
    const fallbackBranch = branches.find(
      (branch) => branch.branch_status !== 'archived'
    );
    return (
      <div className="bg-background flex h-screen items-center justify-center px-4">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <BuildingBranchError />
          <div>
            <h1 className="text-foreground text-lg font-semibold">
              Branch unavailable
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {branchAccessError}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {fallbackBranch ? (
              <Button
                onClick={() => void switchBranch(fallbackBranch.account_id)}
              >
                Open {fallbackBranch.account_name}
              </Button>
            ) : null}
            <Button
              variant={fallbackBranch ? 'outline' : 'default'}
              onClick={() => void retryBranchAccess()}
              disabled={retryingBranchAccess}
            >
              {retryingBranchAccess ? 'Retrying...' : 'Retry'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Account-scoped components capture locale-bound dates and currencies on
  // mount. Keep them unmounted until the selected account row is authoritative
  // so a slow or failed hydration cannot seed persisted state with defaults.
  if (accountStatus === 'loading') {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (accountStatus !== 'ready') {
    return (
      <div className="bg-background flex h-screen items-center justify-center px-4">
        <div className="w-full max-w-xl">
          <AccountAccessAlert />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      {/* Replaces the browser cache with this user's saved profile
          preference as soon as authentication/profile loading settles. */}
      <AccountAppearanceSync />
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Leads and Members use a roomier 24px separation below their
            headers. Business matches its 20px section rhythm; other routes
            retain the standard 12px gap. */}
        <main
          className={cn(
            'min-w-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6',
            contentPaddingTop
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function BuildingBranchError() {
  return (
    <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-xl">
      <span aria-hidden className="text-xl">
        ×
      </span>
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
