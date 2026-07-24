'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import type { FinanceExpenseRow } from '@/lib/finance/expenses';
import { createClient } from '@/lib/supabase/client';

export function VoidExpenseDialog({
  expense,
  open,
  onOpenChange,
  onVoided,
}: {
  expense: FinanceExpenseRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVoided: () => void;
}) {
  const { fmt } = useLocale();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!expense) return null;
  const activeExpense = expense;

  async function voidExpense() {
    if (!reason.trim()) {
      toast.error('Enter a reason for the correction');
      return;
    }
    setSaving(true);
    try {
      const { error } = await createClient().rpc('void_expense', {
        p_expense_id: activeExpense.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success('Expense voided; Finance totals were recalculated');
      onOpenChange(false);
      onVoided();
    } catch (reason) {
      toast.error(getErrorMessage(reason, 'Could not void expense'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Void expense?</DialogTitle>
          <DialogDescription>
            Reverse the{' '}
            <span className="tabular-nums">{fmt.money(expense.amount)}</span>{' '}
            entry for {activeExpense.description}. The ledger row and receipt
            remain in audit history.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="void-expense-reason">Reason</Label>
          <Input
            id="void-expense-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Duplicate or incorrectly recorded expense"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void voidExpense()}
            disabled={saving || !reason.trim()}
          >
            {saving ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Void expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
