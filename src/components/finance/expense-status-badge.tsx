import { Badge } from '@/components/ui/badge';
import type { ExpenseStatus } from '@/types';

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return (
    <Badge variant={status === 'posted' ? 'success' : 'danger'}>
      {status === 'posted' ? 'Posted' : 'Voided'}
    </Badge>
  );
}
