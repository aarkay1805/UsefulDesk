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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Chip, ChipGroup } from '@/components/ui/chip';
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
import { Separator } from '@/components/ui/separator';
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
  const parsedCollectAmount = Number(collectAmount);
  const collectAmountError =
    collectAmount.trim() !== '' &&
    (!Number.isFinite(parsedCollectAmount) || parsedCollectAmount < 0)
      ? 'Enter a valid amount to collect'
      : collectAmount.trim() !== '' && parsedCollectAmount > cashDue
        ? `Amount cannot exceed ${fmt.money(cashDue)}`
        : null;
  const validCollectAmount = collectAmountError
    ? 0
    : collectAmount.trim() === ''
      ? 0
      : parsedCollectAmount;
  const amountRemaining = Math.max(cashDue - validCollectAmount, 0);
  const selectedPreset =
    cashDue === 0
      ? []
      : validCollectAmount === cashDue
        ? ['full']
        : validCollectAmount === 0
          ? ['due']
          : [];

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
    if (collectAmountError) return toast.error(collectAmountError);
    const amount = validCollectAmount;
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving || next) onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[min(92vh,780px)] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {mode === 'service_renewal' ? 'Renew service' : 'Add purchase'}
          </DialogTitle>
          <DialogDescription>
            Add products or services and choose what to collect. Member credit
            is applied automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void checkout();
          }}
        >
          <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1">
            <ProductsServicesPicker
              value={selections}
              onChange={setSelections}
              membershipEnd={membership.end_date}
              defaultStartDate={fmt.today()}
              title="Invoice items"
              description="Add one or more products or services to this invoice."
            />
            {selections.length > 0 ? (
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Payment</CardTitle>
                  <CardDescription>
                    Choose what to collect now. Any remainder stays due.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        Invoice total
                      </span>
                      <span className="font-medium tabular-nums">
                        {fmt.money(total)}
                      </span>
                    </div>
                    {creditApplied > 0 ? (
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          Member credit
                        </span>
                        <span className="tabular-nums">
                          −{fmt.money(creditApplied)}
                        </span>
                      </div>
                    ) : null}
                    <Separator />
                    <div className="flex items-center justify-between gap-4 font-medium">
                      <span>Due after credit</span>
                      <span className="tabular-nums">{fmt.money(cashDue)}</span>
                    </div>
                  </div>

                  {cashDue > 0 ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="purchase-collect-amount">
                            Collect now
                          </Label>
                          <CurrencyInput
                            id="purchase-collect-amount"
                            symbol={currencySymbol(locale.currency)}
                            groupLocale={locale.locale}
                            value={collectAmount}
                            onValueChange={setCollectAmount}
                            placeholder="0"
                            aria-invalid={!!collectAmountError}
                            aria-describedby={
                              collectAmountError
                                ? 'purchase-collect-amount-error'
                                : undefined
                            }
                          />
                          {collectAmountError ? (
                            <p
                              id="purchase-collect-amount-error"
                              className="text-destructive text-xs"
                              role="alert"
                            >
                              {collectAmountError}
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="purchase-payment-method">
                            Payment method
                          </Label>
                          <Select
                            value={method}
                            disabled={validCollectAmount <= 0}
                            onValueChange={(value) =>
                              value && setMethod(value as PaymentMethod)
                            }
                          >
                            <SelectTrigger
                              id="purchase-payment-method"
                              className="w-full"
                            >
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
                      <ChipGroup
                        selectionMode="single"
                        value={selectedPreset}
                        onValueChange={(values) => {
                          if (values[0] === 'full') {
                            setCollectAmount(String(cashDue));
                          }
                          if (values[0] === 'due') setCollectAmount('');
                        }}
                      >
                        <Chip value="full">Full {fmt.moneyShort(cashDue)}</Chip>
                        <Chip value="due">Leave due</Chip>
                      </ChipGroup>
                      <p className="text-muted-foreground text-xs">
                        {amountRemaining > 0 ? (
                          <>
                            Remaining after this collection:{' '}
                            <span className="text-foreground font-medium tabular-nums">
                              {fmt.money(amountRemaining)}
                            </span>
                          </>
                        ) : (
                          'This collection settles the invoice.'
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Member credit covers this invoice. No payment is needed
                      today.
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>
          <DialogFooter showCloseButton>
            <Button
              type="submit"
              disabled={
                saving || selections.length === 0 || !!collectAmountError
              }
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving ? 'Creating invoice…' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
