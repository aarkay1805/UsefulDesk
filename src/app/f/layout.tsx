// ============================================================
// /f/[token] layout — the public lead capture form shell.
//
// A bare top-level segment, deliberately outside both `(auth)` and
// `(dashboard)`, for the same reason /join has its own: the page must
// render for an anonymous visitor who will never sign in. Routing it
// through `(dashboard)` would bounce them to /login; through `(auth)`
// would bounce a signed-in gym owner previewing their own form.
//
// It needs no change to src/proxy.ts — `protectedPaths` there is an
// explicit prefix allowlist and '/f' is not on it.
//
// Referrer-Policy: no-referrer
//   The form token lives in the URL path. The token grants no read of
//   anything (see migration 064), but leaking it to a third-party font
//   or script via the `Referer` header would still hand a spammer the
//   submit URL. Cheap guard; keep it.
//
// The root layout already sets robots: noindex — a capture form is
// shared deliberately, not crawled.
// ============================================================

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  referrer: 'no-referrer',
};

export default function CaptureFormLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      {children}
    </div>
  );
}
