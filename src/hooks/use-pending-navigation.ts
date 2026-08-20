'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface PendingNavigationState {
  sourcePathname: string;
  href: string | null;
}

export function usePendingNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<PendingNavigationState>({
    sourcePathname: pathname,
    href: null,
  });

  let pendingHref = state.href;
  if (state.sourcePathname !== pathname) {
    pendingHref = null;
    setState({ sourcePathname: pathname, href: null });
  }

  const startNavigation = useCallback(
    (href: string) => {
      setState({ sourcePathname: pathname, href });
    },
    [pathname]
  );

  const navigate = useCallback(
    (href: string) => {
      startNavigation(href);
      router.push(href);
    },
    [router, startNavigation]
  );

  const isPending = useCallback(
    (href: string) => pendingHref === href,
    [pendingHref]
  );

  return { navigate, startNavigation, isPending };
}
