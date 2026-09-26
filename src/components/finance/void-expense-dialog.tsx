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
      toast.error('Write why you are cancelling it');
      return;
    }
    setSaving(true);
    try {
      const { error } = await createClient().rpc('void_expense', {
        p_expense_id: activeExpense.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success('Expense cancelled. Totals updated.');
      onOpenChange(false);
      onVoided();
    } catch (reason) {
      toast.error(getErrorMessage(reason, 'Could not cancel the expense'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel this expense?</DialogTitle>
          <DialogDescription>
            This removes the{' '}
            <span className="tabular-nums">{fmt.money(expense.amount)}</span>{' '}
            expense for {activeExpense.description} from your totals. It stays
            in history with its receipt.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="void-expense-reason">Reason</Label>
          <Input
            id="void-expense-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Example: Added twice by mistake"
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
            Cancel expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
