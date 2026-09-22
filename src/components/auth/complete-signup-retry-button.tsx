'use client';

import { Button } from '@/components/ui/button';

export function CompleteSignupRetryButton() {
  return (
    <Button className="w-full" onClick={() => window.location.reload()}>
      Retry
    </Button>
  );
}
