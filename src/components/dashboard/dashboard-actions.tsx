'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { DashboardActionSnapshot } from '@/lib/dashboard/action-snapshot';

interface DashboardActionsContextValue {
  snapshot: DashboardActionSnapshot | null;
  failed: boolean;
  refresh: () => void;
}

const DashboardActionsContext =
  createContext<DashboardActionsContextValue | null>(null);

async function loadDashboardActions(): Promise<DashboardActionSnapshot> {
  const response = await fetch('/api/dashboard/actions', { cache: 'no-store' });
  const body = (await response.json()) as DashboardActionSnapshot & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error ?? 'Could not load dashboard actions');
  }
  return body;
}

export function DashboardActionsProvider({
  children,
  initialSnapshot = null,
  autoLoad = true,
}: {
  children: React.ReactNode;
  initialSnapshot?: DashboardActionSnapshot | null;
  autoLoad?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<DashboardActionSnapshot | null>(
    initialSnapshot
  );
  const [failed, setFailed] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState<number | null>(
    initialSnapshot || !autoLoad ? null : 0
  );
  const snapshotRef = useRef<DashboardActionSnapshot | null>(initialSnapshot);

  useEffect(() => {
    if (refreshVersion === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadDashboardActions();
        if (!cancelled) {
          snapshotRef.current = next;
          setSnapshot(next);
          setFailed(false);
        }
      } catch (error) {
        console.error('[dashboard] action snapshot failed:', error);
        if (!cancelled && snapshotRef.current === null) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshVersion]);

  const refresh = useCallback(
    () => setRefreshVersion((value) => (value === null ? 0 : value + 1)),
    []
  );
  const value = useMemo(
    () => ({ snapshot, failed, refresh }),
    [failed, refresh, snapshot]
  );

  return (
    <DashboardActionsContext.Provider value={value}>
      {children}
    </DashboardActionsContext.Provider>
  );
}

export function useDashboardActions(): DashboardActionsContextValue {
  const context = useContext(DashboardActionsContext);
  if (!context) {
    throw new Error(
      'useDashboardActions must be used inside DashboardActionsProvider'
    );
  }
  return context;
}
