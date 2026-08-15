'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canOverrideSalePrice } from '@/lib/auth/roles';
import { currencySymbol } from '@/lib/currency';
import { createClient } from '@/lib/supabase/client';
import {
  configuredSelectionPrice,
  serviceEndDate,
} from '@/lib/products-services';
import { durationLabel } from '@/lib/memberships/pricing';
import type {
  CatalogItem,
  CatalogOption,
  CheckoutSelection,
  Trainer,
  TrainerRate,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface OptionChoice extends CatalogOption {
  item: CatalogItem;
  trainer_rates: TrainerRate[];
}

export function ProductsServicesPicker({
  value,
  onChange,
  membershipEnd,
  defaultStartDate,
  title = 'Products & services',
  description = "Optional. Items added here share this checkout's invoice.",
}: {
  value: CheckoutSelection[];
  onChange: (value: CheckoutSelection[]) => void;
  membershipEnd?: string | null;
  defaultStartDate: string;
  title?: string;
  description?: string;
}) {
  const fieldId = useId();
  const supabase = createClient();
  const { accountId, accountRole } = useAuth();
  const { fmt, locale } = useLocale();
  const [choices, setChoices] = useState<OptionChoice[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [trainerId, setTrainerId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [overridePrice, setOverridePrice] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      const [itemsResult, trainersResult] = await Promise.all([
        supabase
          .from('catalog_items')
          .select('*, catalog_options(*, trainer_rates(*))')
          .eq('is_active', true),
        supabase
          .from('trainers')
          .select('*')
          .eq('is_active', true)
          .order('display_name'),
      ]);
      if (cancelled) return;
      if (itemsResult.error || trainersResult.error) {
        setLoadError(
          "Couldn't load products and services. Close this dialog and try again."
        );
        setLoading(false);
        return;
      }
      const flattened: OptionChoice[] = [];
      for (const item of (itemsResult.data as (CatalogItem & {
        catalog_options: (CatalogOption & { trainer_rates: TrainerRate[] })[];
      })[]) ?? []) {
        for (const option of item.catalog_options.filter(
          (candidate) => candidate.is_active
        )) {
          flattened.push({
            ...option,
            item,
            trainer_rates: option.trainer_rates ?? [],
          });
        }
      }
      setChoices(flattened);
      setTrainers((trainersResult.data as Trainer[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const selected = choices.find((choice) => choice.id === optionId) ?? null;
  const configuredPrice = selected
    ? configuredSelectionPrice(
        selected.item,
        selected,
        trainerId,
        selected.trainer_rates
      )
    : null;
  const availableTrainers = selected?.item.requires_trainer
    ? trainers.filter((trainer) =>
        selected.trainer_rates.some(
          (rate) => rate.trainer_id === trainer.id && rate.is_active
        )
      )
    : [];
  const canOverride = accountRole ? canOverrideSalePrice(accountRole) : false;

  const pricedSelections = useMemo(
    () =>
      value.map((selection) => ({
        selection,
        choice:
          choices.find((choice) => choice.id === selection.option_id) ?? null,
      })),
    [choices, value]
  );

  function add() {
    if (!selected || configuredPrice == null) return;
    const parsedQuantity =
      selected.item.kind === 'merchandise' ? Number(quantity) : 1;
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) return;
    const parsedOverride = overridePrice.trim()
      ? Number(overridePrice)
      : configuredPrice;
    if (!Number.isFinite(parsedOverride) || parsedOverride < 0) return;
    if (parsedOverride !== configuredPrice && !overrideReason.trim()) return;
    onChange([
      ...value,
      {
        item_id: selected.item.id,
        option_id: selected.id,
        trainer_id: selected.item.requires_trainer ? trainerId : null,
        quantity: parsedQuantity,
        start_date:
          selected.item.kind === 'service'
            ? startDate || defaultStartDate
            : undefined,
        unit_amount: parsedOverride,
        override_reason:
          parsedOverride !== configuredPrice
            ? overrideReason.trim()
            : undefined,
      },
    ]);
    setOptionId(null);
    setTrainerId(null);
    setQuantity('1');
    setOverridePrice('');
    setOverrideReason('');
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading catalogue…
          </p>
        ) : loadError ? (
          <p
            className="text-destructive flex items-start gap-2 text-sm"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {loadError}
          </p>
        ) : choices.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No active catalogue options. Add them in Settings → Products &amp;
            services.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${fieldId}-item`}>Product or service</Label>
              <Select
                value={optionId}
                onValueChange={(next) => {
                  setOptionId(next);
                  setTrainerId(null);
                  setOverridePrice('');
                }}
              >
                <SelectTrigger id={`${fieldId}-item`} className="w-full">
                  <SelectValue placeholder="Select a product or service" />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((choice) => (
                    <SelectItem key={choice.id} value={choice.id}>
                      {choice.item.name}
                      {choice.duration_count && choice.duration_unit
                        ? ` · ${durationLabel(choice.duration_count, choice.duration_unit)}`
                        : ''}
                      {!choice.item.requires_trainer &&
                      choice.standard_price != null
                        ? ` · ${fmt.money(choice.standard_price)}`
                        : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selected?.item.requires_trainer ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${fieldId}-trainer`}>Trainer</Label>
                <Select value={trainerId} onValueChange={setTrainerId}>
                  <SelectTrigger id={`${fieldId}-trainer`} className="w-full">
                    <SelectValue placeholder="Select a trainer" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTrainers.map((trainer) => {
                      const rate = selected.trainer_rates.find(
                        (candidate) =>
                          candidate.trainer_id === trainer.id &&
                          candidate.is_active
                      );
                      return (
                        <SelectItem key={trainer.id} value={trainer.id}>
                          {trainer.display_name}
                          {trainer.title ? ` · ${trainer.title}` : ''} ·{' '}
                          {fmt.money(rate?.price ?? 0)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {availableTrainers.length === 0 ? (
                  <p className="text-amber-foreground flex items-center gap-1.5 text-xs">
                    <AlertTriangle className="size-3.5" />
                    No trainer has a rate for this duration.
                  </p>
                ) : null}
              </div>
            ) : null}

            {selected?.item.kind === 'service' ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-starts`}>Starts</Label>
                <DatePicker
                  id={`${fieldId}-starts`}
                  value={startDate}
                  onChange={setStartDate}
                />
              </div>
            ) : selected ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-quantity`}>Quantity</Label>
                <Input
                  id={`${fieldId}-quantity`}
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
            ) : null}

            {selected && configuredPrice != null ? (
              <div className="space-y-1.5">
                <Label>Configured price</Label>
                <div className="flex min-h-9 items-center">
                  <span className="text-sm font-medium tabular-nums">
                    {fmt.money(configuredPrice)}
                  </span>
                </div>
              </div>
            ) : null}

            {selected && configuredPrice != null && canOverride ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-override-price`}>
                    Override price
                  </Label>
                  <CurrencyInput
                    id={`${fieldId}-override-price`}
                    symbol={currencySymbol(locale.currency)}
                    groupLocale={locale.locale}
                    placeholder="Use configured price"
                    value={overridePrice}
                    onValueChange={setOverridePrice}
                  />
                </div>
                {overridePrice.trim() &&
                Number(overridePrice) !== configuredPrice ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${fieldId}-override-reason`}>
                      Override reason
                    </Label>
                    <Input
                      id={`${fieldId}-override-reason`}
                      value={overrideReason}
                      onChange={(event) =>
                        setOverrideReason(event.target.value)
                      }
                      placeholder="Required for audit"
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {selected ? (
              <div className="flex items-end sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={add}
                  disabled={
                    configuredPrice == null ||
                    (selected.item.requires_trainer && !trainerId) ||
                    (!!overridePrice.trim() &&
                      Number(overridePrice) !== configuredPrice &&
                      !overrideReason.trim())
                  }
                >
                  <Plus className="size-4" />
                  Add to checkout
                </Button>
              </div>
            ) : null}
          </div>
        )}

        {pricedSelections.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {pricedSelections.map(({ selection, choice }, index) => {
              const unit =
                selection.unit_amount ??
                (choice
                  ? configuredSelectionPrice(
                      choice.item,
                      choice,
                      selection.trainer_id ?? null,
                      choice.trainer_rates
                    )
                  : 0) ??
                0;
              const endIso =
                choice?.item.kind === 'service' && selection.start_date
                  ? serviceEndDate(selection.start_date, choice)
                  : null;
              return (
                <div
                  key={`${selection.option_id}:${index}`}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {choice?.item.name ?? 'Catalogue item'}
                      {(selection.quantity ?? 1) > 1
                        ? ` × ${selection.quantity}`
                        : ''}
                    </p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {fmt.money(unit * (selection.quantity ?? 1))}
                      {endIso
                        ? ` · ${fmt.date(selection.start_date!)}–${fmt.date(endIso)}`
                        : ''}
                    </p>
                    {membershipEnd && endIso && endIso > membershipEnd ? (
                      <p className="text-amber-foreground mt-1 flex items-center gap-1 text-xs">
                        <AlertTriangle className="size-3" />
                        Service runs beyond membership expiry (
                        {fmt.date(membershipEnd)}).
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove item"
                    onClick={() =>
                      onChange(value.filter((_, current) => current !== index))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
