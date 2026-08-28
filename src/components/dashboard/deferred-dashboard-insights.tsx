'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton';

function DashboardInsightsPlaceholder() {
  return (
    <div
      role="status"
      aria-label="Dashboard insights loading"
      className="space-y-8"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

const DashboardInsights = dynamic(
  () =>
    import('@/components/dashboard/dashboard-insights').then(
      (module) => module.DashboardInsights
    ),
  { loading: DashboardInsightsPlaceholder }
);

export function DeferredDashboardInsights() {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(
    () => typeof IntersectionObserver === 'undefined'
  );

  useEffect(() => {
    if (active || !boundaryRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setActive(true);
        observer.disconnect();
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(boundaryRef.current);
    return () => observer.disconnect();
  }, [active]);

  return (
    <div ref={boundaryRef}>
      {active ? <DashboardInsights /> : <DashboardInsightsPlaceholder />}
    </div>
  );
}
