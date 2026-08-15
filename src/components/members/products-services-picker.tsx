'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

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
import { Collapse } from '@/components/ui/collapse';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from '@/components/ui/toolbar';

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
  presentation = 'builder',
}: {
  value: CheckoutSelection[];
  onChange: (value: CheckoutSelection[]) => void;
  membershipEnd?: string | null;
  defaultStartDate: string;
  title?: string;
  description?: string;
  presentation?: 'builder' | 'catalogue';
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
  const [trainerByOption, setTrainerByOption] = useState<
    Record<string, string | null>
  >({});
  const [adjustingOptionId, setAdjustingOptionId] = useState<string | null>(
    null
  );
  const [adjustedPrice, setAdjustedPrice] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

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

  function selectionIndex(choice: OptionChoice) {
    return value.findIndex((selection) => selection.option_id === choice.id);
  }

  function availableTrainersFor(choice: OptionChoice) {
    return choice.item.requires_trainer
      ? trainers.filter((trainer) =>
          choice.trainer_rates.some(
            (rate) => rate.trainer_id === trainer.id && rate.is_active
          )
        )
      : [];
  }

  function updateSelection(
    index: number,
    update: (selection: CheckoutSelection) => CheckoutSelection
  ) {
    onChange(
      value.map((selection, current) =>
        current === index ? update(selection) : selection
      )
    );
  }

  function changeCatalogueQuantity(choice: OptionChoice, delta: -1 | 1) {
    const index = selectionIndex(choice);
    const selection = index >= 0 ? value[index] : null;
    const currentQuantity = selection?.quantity ?? 0;
    const nextQuantity = Math.max(
      0,
      choice.item.kind === 'service'
        ? Math.min(1, currentQuantity + delta)
        : currentQuantity + delta
    );

    if (nextQuantity === 0) {
      if (index >= 0) {
        onChange(value.filter((_, current) => current !== index));
        if (adjustingOptionId === choice.id) setAdjustingOptionId(null);
      }
      return;
    }

    const trainerId = choice.item.requires_trainer
      ? (selection?.trainer_id ??
        trainerByOption[choice.id] ??
        availableTrainersFor(choice)[0]?.id ??
        null)
      : null;
    const configuredPrice = configuredSelectionPrice(
      choice.item,
      choice,
      trainerId,
      choice.trainer_rates
    );
    if (configuredPrice == null) return;

    if (selection && index >= 0) {
      updateSelection(index, (current) => ({
        ...current,
        quantity: nextQuantity,
      }));
      return;
    }

    onChange([
      ...value,
      {
        item_id: choice.item.id,
        option_id: choice.id,
        trainer_id: choice.item.requires_trainer ? trainerId : null,
        quantity: nextQuantity,
        start_date:
          choice.item.kind === 'service' ? defaultStartDate : undefined,
        unit_amount: configuredPrice,
      },
    ]);
  }

  function changeCatalogueTrainer(
    choice: OptionChoice,
    nextTrainerId: string | null
  ) {
    setTrainerByOption((current) => ({
      ...current,
      [choice.id]: nextTrainerId,
    }));
    const index = selectionIndex(choice);
    if (index < 0 || !nextTrainerId) return;
    const nextPrice = configuredSelectionPrice(
      choice.item,
      choice,
      nextTrainerId,
      choice.trainer_rates
    );
    if (nextPrice == null) return;
    updateSelection(index, (current) => ({
      ...current,
      trainer_id: nextTrainerId,
      unit_amount: nextPrice,
      override_reason: undefined,
    }));
    if (adjustingOptionId === choice.id) setAdjustingOptionId(null);
  }

  function beginPriceAdjustment(
    choice: OptionChoice,
    selection: CheckoutSelection,
    configuredPrice: number
  ) {
    setAdjustingOptionId(choice.id);
    setAdjustedPrice(String(selection.unit_amount ?? configuredPrice));
    setAdjustReason(selection.override_reason ?? '');
  }

  function applyPriceAdjustment(choice: OptionChoice, configuredPrice: number) {
    const index = selectionIndex(choice);
    const parsedPrice = Number(adjustedPrice);
    if (
      index < 0 ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice < 0 ||
      (parsedPrice !== configuredPrice && !adjustReason.trim())
    ) {
      return;
    }
    updateSelection(index, (current) => ({
      ...current,
      unit_amount: parsedPrice,
      override_reason:
        parsedPrice === configuredPrice ? undefined : adjustReason.trim(),
    }));
    setAdjustingOptionId(null);
  }

  if (presentation === 'catalogue') {
    return (
      <div className="min-w-0">
        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading catalogue…
          </p>
        ) : loadError ? (
          <p
            className="text-destructive flex items-start gap-2 py-6 text-sm"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {loadError}
          </p>
        ) : choices.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">
            No active catalogue options. Add them in Settings → Products &amp;
            services.
          </p>
        ) : (
          <div
            data-testid="catalogue-table"
            className="overflow-hidden rounded-lg border"
          >
            <div className="text-muted-foreground bg-muted/40 hidden grid-cols-[minmax(0,1fr)_11rem_8rem] gap-3 border-b px-3 py-2 text-xs font-medium md:grid">
              <span>Item</span>
              <span>Price</span>
              <span className="text-center">Quantity</span>
            </div>
            <div className="divide-y">
              {choices.map((choice) => {
                const index = selectionIndex(choice);
                const selection = index >= 0 ? value[index] : null;
                const quantity = selection ? (selection.quantity ?? 1) : 0;
                const availableChoiceTrainers = availableTrainersFor(choice);
                const activeTrainerId = choice.item.requires_trainer
                  ? (selection?.trainer_id ??
                    trainerByOption[choice.id] ??
                    availableChoiceTrainers[0]?.id ??
                    null)
                  : null;
                const cataloguePrice = configuredSelectionPrice(
                  choice.item,
                  choice,
                  activeTrainerId,
                  choice.trainer_rates
                );
                const unitPrice = selection?.unit_amount ?? cataloguePrice;
                const duration =
                  choice.duration_count && choice.duration_unit
                    ? durationLabel(choice.duration_count, choice.duration_unit)
                    : null;
                const optionLabel = duration
                  ? `${choice.item.name}, ${duration}`
                  : choice.item.name;
                const endIso =
                  selection?.start_date && choice.item.kind === 'service'
                    ? serviceEndDate(selection.start_date, choice)
                    : null;
                const adjusted =
                  selection &&
                  cataloguePrice != null &&
                  (selection.unit_amount ?? cataloguePrice) !== cataloguePrice;
                const priceDraft = Number(adjustedPrice);
                const adjustmentInvalid =
                  adjustedPrice.trim() === '' ||
                  !Number.isFinite(priceDraft) ||
                  priceDraft < 0 ||
                  (priceDraft !== cataloguePrice && !adjustReason.trim());

                return (
                  <div key={choice.id} className="px-3 py-3">
                    <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_11rem_8rem] md:items-center">
                      <div className="min-w-0">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {choice.item.name}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {choice.item.kind === 'service'
                              ? `Service${duration ? ` · ${duration}` : ''}`
                              : 'Product'}
                            {choice.item.description
                              ? ` · ${choice.item.description}`
                              : ''}
                          </span>
                        </span>
                      </div>

                      <div className="col-start-1 md:col-start-2 md:row-start-1">
                        <div className="flex items-center gap-1">
                          {choice.item.requires_trainer ? (
                            <Select
                              value={activeTrainerId}
                              disabled={availableChoiceTrainers.length === 0}
                              onValueChange={(next) =>
                                changeCatalogueTrainer(choice, next)
                              }
                            >
                              <SelectTrigger
                                id={`${fieldId}-${choice.id}-trainer`}
                                aria-label={`Trainer for ${optionLabel}`}
                                className="min-w-0 flex-1"
                              >
                                <SelectValue placeholder="Choose trainer" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableChoiceTrainers.map((trainer) => {
                                  const rate = choice.trainer_rates.find(
                                    (candidate) =>
                                      candidate.trainer_id === trainer.id &&
                                      candidate.is_active
                                  );
                                  return (
                                    <SelectItem
                                      key={trainer.id}
                                      value={trainer.id}
                                    >
                                      {trainer.display_name}
                                      {trainer.title
                                        ? ` · ${trainer.title}`
                                        : ''}{' '}
                                      · {fmt.money(rate?.price ?? 0)}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          ) : unitPrice != null ? (
                            <>
                              <span className="sr-only md:hidden">Price: </span>
                              <span className="text-sm font-medium tabular-nums">
                                {fmt.money(unitPrice)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span
                                aria-hidden="true"
                                className="text-muted-foreground text-sm"
                              >
                                —
                              </span>
                              <span className="sr-only">
                                Price available after choosing a trainer
                              </span>
                            </>
                          )}
                          {selection &&
                          canOverride &&
                          cataloguePrice != null ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`${adjusted ? 'Edit adjusted' : 'Adjust'} price for ${optionLabel}`}
                              onClick={() =>
                                beginPriceAdjustment(
                                  choice,
                                  selection,
                                  cataloguePrice
                                )
                              }
                            >
                              <Pencil className="size-3" />
                            </Button>
                          ) : null}
                        </div>
                        {choice.item.requires_trainer &&
                        availableChoiceTrainers.length === 0 ? (
                          <p className="text-amber-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                            <AlertTriangle className="size-3.5" />
                            Trainer fee not set
                          </p>
                        ) : null}
                        {adjusted && cataloguePrice != null ? (
                          <span className="text-muted-foreground block text-xs tabular-nums">
                            Usually {fmt.money(cataloguePrice)}
                          </span>
                        ) : null}
                      </div>

                      <div className="col-start-1 w-28 self-center justify-self-end md:col-start-3 md:row-start-1">
                        {quantity === 0 ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            aria-label={`Add ${optionLabel}`}
                            disabled={cataloguePrice == null}
                            onClick={() => changeCatalogueQuantity(choice, 1)}
                          >
                            <Plus className="size-4" />
                            Add
                          </Button>
                        ) : (
                          <Toolbar
                            aria-label={`${optionLabel} quantity`}
                            className="w-full justify-center"
                          >
                            <ToolbarButton
                              type="button"
                              aria-label={`Decrease ${optionLabel} quantity`}
                              onClick={() =>
                                changeCatalogueQuantity(choice, -1)
                              }
                            >
                              <Minus className="size-4" />
                            </ToolbarButton>
                            <ToolbarSeparator orientation="vertical" />
                            <output
                              aria-live="polite"
                              aria-label={`${optionLabel} quantity: ${quantity}`}
                              className="flex min-w-8 items-center justify-center px-2 text-sm font-medium tabular-nums"
                            >
                              {quantity}
                            </output>
                            <ToolbarSeparator orientation="vertical" />
                            <ToolbarButton
                              type="button"
                              aria-label={`Increase ${optionLabel} quantity`}
                              disabled={choice.item.kind === 'service'}
                              onClick={() => changeCatalogueQuantity(choice, 1)}
                            >
                              <Plus className="size-4" />
                            </ToolbarButton>
                          </Toolbar>
                        )}
                      </div>

                      {selection &&
                      (choice.item.kind === 'service' ||
                        adjustingOptionId === choice.id) ? (
                        <div className="mt-1 border-t pt-3 md:col-span-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                            {choice.item.kind === 'service' ? (
                              <div className="w-full space-y-1.5 sm:max-w-56">
                                <Label
                                  htmlFor={`${fieldId}-${choice.id}-starts`}
                                  size="sm"
                                >
                                  Starts
                                </Label>
                                <DatePicker
                                  id={`${fieldId}-${choice.id}-starts`}
                                  value={
                                    selection.start_date ?? defaultStartDate
                                  }
                                  onChange={(nextStart) =>
                                    updateSelection(index, (current) => ({
                                      ...current,
                                      start_date: nextStart,
                                    }))
                                  }
                                />
                              </div>
                            ) : null}
                          </div>

                          {membershipEnd && endIso && endIso > membershipEnd ? (
                            <p className="text-amber-foreground mt-2 flex items-center gap-1 text-xs">
                              <AlertTriangle className="size-3" />
                              Service runs beyond membership expiry (
                              {fmt.date(membershipEnd)}).
                            </p>
                          ) : null}

                          <Collapse open={adjustingOptionId === choice.id}>
                            <div className="-mx-1 mt-3 grid gap-3 px-1 py-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end">
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor={`${fieldId}-${choice.id}-price`}
                                  size="sm"
                                >
                                  Unit price
                                </Label>
                                <CurrencyInput
                                  id={`${fieldId}-${choice.id}-price`}
                                  symbol={currencySymbol(locale.currency)}
                                  groupLocale={locale.locale}
                                  value={adjustedPrice}
                                  onValueChange={setAdjustedPrice}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor={`${fieldId}-${choice.id}-reason`}
                                  size="sm"
                                >
                                  Reason
                                </Label>
                                <Input
                                  id={`${fieldId}-${choice.id}-reason`}
                                  value={adjustReason}
                                  onChange={(event) =>
                                    setAdjustReason(event.target.value)
                                  }
                                  placeholder="Required when price changes"
                                />
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setAdjustingOptionId(null)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  disabled={adjustmentInvalid}
                                  onClick={() => {
                                    if (cataloguePrice != null) {
                                      applyPriceAdjustment(
                                        choice,
                                        cataloguePrice
                                      );
                                    }
                                  }}
                                >
                                  Apply
                                </Button>
                              </div>
                            </div>
                          </Collapse>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
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
