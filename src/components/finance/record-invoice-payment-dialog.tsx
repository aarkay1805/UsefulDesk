'use client';

import { useEffect, useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
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
import { useLocale } from '@/hooks/use-locale';
import { currencySymbol } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import { dateAtNoonInTz } from '@/lib/locale/format';
import { isChargeableAmount } from '@/lib/memberships/periods';
import { validatePaymentAmount } from '@/lib/payments/validation';
import {
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
  uploadPrivateAccountMedia,
} from '@/lib/storage/upload-media';
import { createClient } from '@/lib/supabase/client';
import type { PaymentMethod } from '@/types';
import type { InvoiceDetail } from './invoice-detail-dialog';

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

function halfAmount(balance: number): number {
  return Math.round((balance / 2) * 100) / 100;
}

export function RecordInvoicePaymentDialog({
  invoice,
  open,
  onOpenChange,
  onSaved,
  onCancelled,
}: {
  invoice: InvoiceDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onCancelled?: () => void;
}) {
  const { fmt, locale } = useLocale();
  const balance = Number(invoice.balance);
  const half = halfAmount(balance);
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(fmt.today());
  const [note, setNote] = useState('');
  const [shot, setShot] = useState<{ url: string; path: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setAmount(isChargeableAmount(balance) ? String(balance) : '');
      setMethod('cash');
      setPaidOn(fmt.today());
      setNote('');
      setShot(null);
      setIdempotencyKey(crypto.randomUUID());
    })();
  }, [balance, fmt, invoice.id, open]);

  async function handleUpload(file: File) {
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error('Screenshot must be 5 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const result = await uploadPrivateAccountMedia('payment-receipts', file);
      setShot({ url: result.signedUrl, path: result.path });
    } catch (error) {
      toast.error(getErrorMessage(error, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  }

  async function removeShot() {
    if (!shot) return;
    const path = shot.path;
    setShot(null);
    deleteAccountMedia('payment-receipts', path).catch(() => {});
  }

  function closeDialog() {
    if (shot) {
      deleteAccountMedia('payment-receipts', shot.path).catch(() => {});
      setShot(null);
    }
    onOpenChange(false);
    onCancelled?.();
  }

  async function save() {
    const parsed = Number(amount);
    const validation = validatePaymentAmount(parsed, balance);
    if (validation === 'invalid' || validation === 'not_positive') {
      toast.error('Enter an amount greater than zero');
      return;
    }
    if (validation === 'exceeds_balance') {
      toast.error(`Amount cannot exceed ${fmt.money(balance)}`);
      return;
    }
    if (paidOn > fmt.today()) {
      toast.error('The payment date cannot be in the future');
      return;
    }

    setSaving(true);
    try {
      const paidAt = (
        dateAtNoonInTz(paidOn, locale.timeZone) ?? new Date()
      ).toISOString();
      const { error } = await createClient().rpc('record_invoice_payment', {
        p_invoice_id: invoice.id,
        p_amount: parsed,
        p_method: method,
        p_paid_at: paidAt,
        p_note: note.trim(),
        p_receipt_path: shot?.path ?? null,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;

      const settled = !isChargeableAmount(balance - parsed);
      toast.success(settled ? 'Payment recorded' : 'Partial payment recorded');
      setShot(null);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to record payment'));
    } finally {
      setSaving(false);
    }
  }

  const amountValidation = validatePaymentAmount(Number(amount), balance);
  const amountError =
    amount !== '' && amountValidation === 'exceeds_balance'
      ? `Amount cannot exceed ${fmt.money(balance)}`
      : amount !== '' &&
          (amountValidation === 'invalid' ||
            amountValidation === 'not_positive')
        ? 'Enter an amount greater than zero'
        : null;
  const selectedPreset =
    Number(amount) === balance
      ? ['full']
      : Number(amount) === half
        ? ['half']
        : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else closeDialog();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record invoice payment</DialogTitle>
          <DialogDescription>
            {invoice.reference} · {fmt.money(balance)} outstanding
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Balance due</span>
            <span className="text-amber-foreground font-medium tabular-nums">
              {fmt.money(balance)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-payment-amount">Amount</Label>
              <CurrencyInput
                id="invoice-payment-amount"
                symbol={currencySymbol(locale.currency)}
                groupLocale={locale.locale}
                value={amount}
                onValueChange={setAmount}
                aria-invalid={!!amountError}
                aria-describedby={
                  amountError ? 'invoice-payment-amount-error' : undefined
                }
              />
              {amountError ? (
                <p
                  id="invoice-payment-amount-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  {amountError}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-payment-method">Method</Label>
              <Select
                value={method}
                onValueChange={(value) =>
                  value && setMethod(value as PaymentMethod)
                }
              >
                <SelectTrigger id="invoice-payment-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
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
              if (values[0] === 'full') setAmount(String(balance));
              if (values[0] === 'half') setAmount(String(half));
            }}
          >
            <Chip value="full">Full {fmt.moneyShort(balance)}</Chip>
            <Chip value="half">Half {fmt.moneyShort(half)}</Chip>
          </ChipGroup>

          {amountValidation === 'valid' ? (
            <p className="text-muted-foreground text-xs">
              {Number(amount) >= balance ? (
                'This payment settles the invoice.'
              ) : (
                <>
                  Remaining after this payment:{' '}
                  <span className="text-foreground font-medium tabular-nums">
                    {fmt.money(balance - Number(amount))}
                  </span>
                </>
              )}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="invoice-payment-date">Paid on</Label>
            <DatePicker
              id="invoice-payment-date"
              value={paidOn}
              max={fmt.today()}
              onChange={setPaidOn}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Screenshot (optional)</Label>
            {shot ? (
              <div className="border-border bg-muted/40 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.url}
                  alt="Payment proof"
                  className="size-10 rounded object-cover"
                />
                <span className="text-muted-foreground flex-1 truncate">
                  Screenshot attached
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={removeShot}
                  aria-label="Remove payment proof"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <label className="border-border bg-muted/40 text-muted-foreground hover:bg-muted flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-2.5 py-3 text-xs">
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="size-4" /> Upload UPI/receipt screenshot
                  </>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleUpload(file);
                    event.target.value = '';
                  }}
                />
              </label>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invoice-payment-note">Note</Label>
            <Input
              id="invoice-payment-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional"
            />
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
            onClick={save}
            disabled={
              saving ||
              uploading ||
              !isChargeableAmount(balance) ||
              amountValidation !== 'valid'
            }
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
