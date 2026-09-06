import { Badge } from '@/components/ui/badge';
import type { AccessStatus } from '@/lib/platform-access/model';
const states = {
  trial: ['Trial', 'info'],
  active: ['Active', 'success'],
  complimentary: ['Complimentary', 'neutral'],
  expired: ['Expired', 'warning'],
  suspended: ['Suspended', 'danger'],
  pending: ['Pending', 'neutral'],
} as const;
export function AccessStatusBadge({ status }: { status: AccessStatus }) {
  const [label, variant] = states[status];
  return <Badge variant={variant}>{label}</Badge>;
}
