'use client';

import { useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { currencySymbol } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import { isChargeableAmount } from '@/lib/memberships/periods';
import {
  deleteAccountMedia,
  uploadPrivateAccountMedia,
} from '@/lib/storage/upload-media';
import { createClient } from '@/lib/supabase/client';
import type { ExpenseCategory, ExpenseKind, PaymentMethod } from '@/types';

const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const EXPENSE_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

export function AddExpenseDialog({
  open,
  onOpenChange,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ExpenseCategory[];
  onSaved: () => void;
}) {
  const { defaultCurrency } = useAuth();
  const { fmt, locale } = useLocale();
  const [description, setDescription] = useState('');
  const [occurredOn, setOccurredOn] = useState(fmt.today());
  const [categoryId, setCategoryId] = useState(() => categories[0]?.id ?? '');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [expenseKind, setExpenseKind] = useState<ExpenseKind>('one_time');
  const [amount, setAmount] = useState('');
  const [receipt, setReceipt] = useState<{
    name: string;
    path: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function removeReceipt() {
    if (!receipt) return;
    const path = receipt.path;
    setReceipt(null);
    deleteAccountMedia('expense-receipts', path).catch(() => {});
  }

  function closeDialog() {
    if (receipt) {
      deleteAccountMedia('expense-receipts', receipt.path).catch(() => {});
      setReceipt(null);
    }
    onOpenChange(false);
  }

  async function uploadReceipt(file: File) {
    if (file.size > RECEIPT_MAX_BYTES) {
      toast.error('Receipt must be 5 MB or smaller');
      return;
    }
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(
        file.type
      )
    ) {
      toast.error('Upload a PNG, JPG, WebP, or PDF receipt');
      return;
    }
    setUploading(true);
    try {
      if (receipt) {
        await deleteAccountMedia('expense-receipts', receipt.path).catch(
          () => {}
        );
      }
      const uploaded = await uploadPrivateAccountMedia(
        'expense-receipts',
        file
      );
      setReceipt({ name: file.name, path: uploaded.path });
    } catch (reason) {
      toast.error(getErrorMessage(reason, 'Receipt upload failed'));
    } finally {
      setUploading(false);
    }
  }

  async function saveExpense() {
    const numericAmount = Number(amount);
    if (!description.trim()) {
      toast.error('Enter an expense description');
      return;
    }
    if (!categoryId) {
      toast.error('Select an expense category');
      return;
    }
    if (!isChargeableAmount(numericAmount)) {
      toast.error('Enter an amount of at least 0.50');
      return;
    }
    if (occurredOn > fmt.today()) {
      toast.error('The expense date cannot be in the future');
      return;
    }

    setSaving(true);
    try {
      const { error } = await createClient().rpc('record_expense', {
        p_occurred_on: occurredOn,
        p_amount: numericAmount,
        p_description: description.trim(),
        p_category_id: categoryId,
        p_method: method,
        p_expense_kind: expenseKind,
        p_receipt_path: receipt?.path ?? null,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;

      setReceipt(null);
      onOpenChange(false);
      toast.success('Expense recorded');
      onSaved();
    } catch (reason) {
      toast.error(getErrorMessage(reason, 'Could not record expense'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else closeDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          <DialogDescription>
            Record a business cash-out entry. Corrections are voided rather than
            deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="expense-description">Description</Label>
            <Input
              id="expense-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="July studio rent"
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="expense-date">Date</Label>
              <DatePicker
                id="expense-date"
                value={occurredOn}
                onChange={setOccurredOn}
                max={fmt.today()}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="expense-category">Category</Label>
              <Select
                value={categoryId || undefined}
                onValueChange={(value) => value && setCategoryId(value)}
              >
                <SelectTrigger id="expense-category" className="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="expense-method">Payment method</Label>
              <Select
                value={method}
                onValueChange={(value) =>
                  value && setMethod(value as PaymentMethod)
                }
              >
                <SelectTrigger id="expense-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_METHODS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="expense-amount">Amount</Label>
              <CurrencyInput
                id="expense-amount"
                symbol={currencySymbol(defaultCurrency)}
                groupLocale={locale.locale}
                value={amount}
                onValueChange={setAmount}
                placeholder="0"
                aria-invalid={
                  amount !== '' && !isChargeableAmount(Number(amount))
                }
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Expense type</Label>
            <ChipGroup<ExpenseKind>
              selectionMode="single"
              value={[expenseKind]}
              onValueChange={(values) => {
                if (values[0]) setExpenseKind(values[0]);
              }}
              aria-label="Expense type"
              className="flex-none"
            >
              <Chip value="recurring">Recurring</Chip>
              <Chip value="one_time">One-time</Chip>
            </ChipGroup>
            <p className="text-muted-foreground text-xs">
              Use recurring for regular costs such as rent or salaries.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>Receipt (optional)</Label>
            {receipt ? (
              <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2">
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {receipt.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove receipt"
                  onClick={() => void removeReceipt()}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <label>
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadReceipt(file);
                    event.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  nativeButton={false}
                  disabled={uploading}
                  render={<span />}
                >
                  {uploading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Upload />
                  )}
                  {uploading ? 'Uploading…' : 'Upload receipt'}
                </Button>
              </label>
            )}
            <p className="text-muted-foreground text-xs">
              PNG, JPG, WebP, or PDF up to 5 MB. Receipts stay private.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={closeDialog}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void saveExpense()}
            disabled={
              saving ||
              uploading ||
              !description.trim() ||
              !categoryId ||
              !isChargeableAmount(Number(amount))
            }
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            {saving ? 'Recording…' : 'Record expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
