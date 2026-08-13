import { Badge } from '@/components/ui/badge';
import type { BranchReadinessState } from '@/lib/branches/setup';

export function BranchSetupStatusBadge({
  readinessState,
  setupReviewedAt,
}: {
  readinessState: BranchReadinessState;
  setupReviewedAt: string | null;
}) {
  if (readinessState === 'setup') {
    return <Badge variant="neutral">Setup</Badge>;
  }

  if (readinessState === 'ready' && setupReviewedAt) {
    return <Badge variant="success">Configuration reviewed</Badge>;
  }

  return <Badge variant="warning">Review needed</Badge>;
}
