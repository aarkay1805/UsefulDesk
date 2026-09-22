import { Building2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CompleteSignupRetryButton } from '@/components/auth/complete-signup-retry-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function CompleteSignupAccessError({
  message,
  retryHref,
  retryCurrent = false,
  actionLabel = 'Retry',
}: {
  message: string;
  retryHref?: string;
  retryCurrent?: boolean;
  actionLabel?: string;
}) {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-muted mb-2 flex size-12 items-center justify-center rounded-xl">
            <Building2 className="text-muted-foreground size-6" />
          </div>
          <CardTitle>Gym setup unavailable</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        {retryHref || retryCurrent ? (
          <CardContent>
            {retryHref ? (
              <Button className="w-full" render={<a href={retryHref} />}>
                {actionLabel}
              </Button>
            ) : (
              <CompleteSignupRetryButton />
            )}
          </CardContent>
        ) : null}
      </Card>
    </main>
  );
}
