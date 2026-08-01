'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import { currencySymbol } from '@/lib/currency';
import { createClient } from '@/lib/supabase/client';
import type {
  CheckoutMode,
  CheckoutSelection,
  Membership,
  PaymentMethod,
} from '@/types';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProductsServicesPicker } from './products-services-picker';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

export function ProductServiceSaleDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
  mode = 'sale',
  initialSelections = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: Membership;
  onSaved: () => void;
  mode?: Extract<CheckoutMode, 'sale' | 'service_renewal'>;
  initialSelections?: CheckoutSelection[];
}) {
  const { fmt, locale } = useLocale();
  const supabase = createClient();
  const [selections, setSelections] =
    useState<CheckoutSelection[]>(initialSelections);
  const [collectAmount, setCollectAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [saving, setSaving] = useState(false);
  const [creditBalance, setCreditBalance] = useState(0);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const total = selections.reduce(
    (sum, selection) =>
      sum + Number(selection.unit_amount ?? 0) * (selection.quantity ?? 1),
    0
  );
  const creditApplied = Math.min(creditBalance, total);
  const cashDue = Math.max(total - creditApplied, 0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('member_credit_balances')
        .select('balance')
        .eq('membership_id', membership.id);
      if (!cancelled) {
        setCreditBalance(
          (data ?? []).reduce(
            (sum, entry) => sum + Number(entry.balance ?? 0),
            0
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [membership.id, open, supabase]);

  async function checkout() {
    if (selections.length === 0)
      return toast.error('Add at least one product or service');
    const amount = collectAmount.trim() === '' ? 0 : Number(collectAmount);
    if (!Number.isFinite(amount) || amount < 0 || amount > cashDue) {
      return toast.error('Enter a valid amount to collect');
    }
    setSaving(true);
    try {
      const response = await fetch('/api/member-checkouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          contact_id: membership.contact_id,
          membership_id: membership.id,
          selections,
          collection: {
            amount,
            method,
            paid_at: new Date().toISOString(),
          },
          idempotency_key: idempotencyKey,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        credit_applied?: number;
        balance?: number;
      };
      if (!response.ok) throw new Error(result.error || 'Checkout failed');
      const credit = Number(result.credit_applied ?? 0);
      const balance = Number(result.balance ?? 0);
      toast.success(
        balance > 0
          ? `Sale saved · ${fmt.money(balance)} remains due`
          : credit > 0
            ? `Sale saved · ${fmt.money(credit)} credit applied`
            : 'Sale paid in full'
      );
      setSelections([]);
      setCollectAmount('');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Checkout failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'service_renewal' ? 'Renew service' : 'Add purchase'}
          </DialogTitle>
          <DialogDescription>
            Creates a new invoice. Available member credit is applied before
            cash.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <ProductsServicesPicker
            value={selections}
            onChange={setSelections}
            membershipEnd={membership.end_date}
            defaultStartDate={fmt.today()}
          />
          {selections.length > 0 ? (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between font-medium">
                <span>Invoice total</span>
                <span className="tabular-nums">{fmt.money(total)}</span>
              </div>
              {creditApplied > 0 ? (
                <div className="text-muted-foreground flex items-center justify-between text-sm">
                  <span>Member credit applied first</span>
                  <span className="tabular-nums">
                    −{fmt.money(creditApplied)}
                  </span>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Collect now</Label>
                  <CurrencyInput
                    symbol={currencySymbol(locale.currency)}
                    groupLocale={locale.locale}
                    value={collectAmount}
                    onValueChange={setCollectAmount}
                    placeholder="0 — leave due"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Payment method</Label>
                  <Select
                    value={method}
                    onValueChange={(value) => setMethod(value as PaymentMethod)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCollectAmount(String(cashDue))}
                >
                  Pay in full
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCollectAmount('')}
                >
                  Leave due
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter showCloseButton>
          <Button
            onClick={checkout}
            disabled={saving || selections.length === 0}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
