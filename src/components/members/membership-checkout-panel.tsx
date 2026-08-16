'use client';

import { useEffect, useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Collapse } from '@/components/ui/collapse';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import { useLocale } from '@/hooks/use-locale';
import {
  MAX_CONVERSION_BONUS_MONTHS,
  oneTimeBonusMonthsError,
} from '@/lib/memberships/bonus-time';
import { quoteMembershipCheckout } from '@/lib/memberships/checkout';
import {
  oneTimeDiscountError,
  type OneTimeDiscountKind,
} from '@/lib/memberships/discount';
import { installmentSecondDueOn } from '@/lib/memberships/installments';
import { firstCycleFee, renewalFee } from '@/lib/memberships/pricing';
import { currencySymbol } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type {
  MembershipCheckoutDraft,
  MembershipCheckoutMode,
  MembershipPlan,
  PaymentMethod,
} from '@/types';

import { PlanOptionPicker, TRIAL_PLAN_VALUE } from './plan-option-picker';
import { ProductsServicesPicker } from './products-services-picker';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];
const DISCOUNT_PERCENTAGE_PRESETS = ['10', '20', '30'] as const;
const DEFAULT_DISCOUNT_PERCENTAGE = DISCOUNT_PERCENTAGE_PRESETS[0];
const BONUS_MONTH_PRESETS = ['1', '2', '3'] as const;
const DEFAULT_BONUS_MONTHS = BONUS_MONTH_PRESETS[0];

export interface MembershipCheckoutPanelProps {
  idPrefix: string;
  mode: MembershipCheckoutMode;
  plans: MembershipPlan[];
  plansLoading: boolean;
  value: MembershipCheckoutDraft;
  onChange: (next: MembershipCheckoutDraft) => void;
  availableCredit?: number;
  allowTrial?: boolean;
  startDateEditable: boolean;
  renewalStartExplanation?: string;
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 text-sm',
        strong ? 'text-foreground font-medium' : 'text-muted-foreground'
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function MembershipCheckoutPanel({
  idPrefix,
  mode,
  plans,
  plansLoading,
  value,
  onChange,
  availableCredit = 0,
  allowTrial = false,
  startDateEditable,
  renewalStartExplanation,
}: MembershipCheckoutPanelProps) {
  const { fmt, locale } = useLocale();
  const [discountTouched, setDiscountTouched] = useState(false);
  const [bonusTouched, setBonusTouched] = useState(false);

  const selectedPlan = plans.find((plan) => plan.id === value.planId) ?? null;
  const selectedOption =
    selectedPlan?.pricing_options?.find(
      (option) => option.id === value.optionId && option.is_active
    ) ?? null;
  const isTrial = value.planId === TRIAL_PLAN_VALUE;
  const listPrice = selectedOption
    ? mode === 'membership_renewal'
      ? renewalFee(selectedOption)
      : firstCycleFee(selectedOption)
    : 0;
  const discountError = selectedOption
    ? oneTimeDiscountError(listPrice, value.discountKind, value.discountValue)
    : null;
  const bonusError = oneTimeBonusMonthsError(
    value.bonusMonthsEnabled,
    value.bonusMonths
  );
  const showDiscountError =
    !!discountError && (discountTouched || value.discountKind === 'amount');
  const discountErrorMessage =
    discountError && !value.discountValue.trim()
      ? value.discountKind === 'amount'
        ? 'Enter a discount amount to continue.'
        : 'Enter a discount percentage to continue.'
      : discountError;

  let quote = null;
  if (selectedOption && !isTrial) {
    try {
      quote = quoteMembershipCheckout({
        mode,
        option: selectedOption,
        startDate: value.startDate,
        discountKind: value.discountKind,
        discountValue: value.discountValue,
        bonusMonthsEnabled: value.bonusMonthsEnabled,
        bonusMonths: value.bonusMonths,
        selections: value.includeProductsServices ? value.selections : [],
        availableCredit,
      });
    } catch {
      quote = null;
    }
  }

  const quoteBlockedReason = quote
    ? null
    : !selectedOption
      ? 'Select a plan and billing option to calculate the amount due.'
      : discountError
        ? 'Complete the discount above to calculate the amount due.'
        : bonusError
          ? 'Complete the bonus months above to calculate the amount due.'
          : 'Review the membership details above to calculate the amount due.';

  useEffect(() => {
    if (value.discountKind !== 'amount' || value.discountValue) return;
    document.getElementById(`${idPrefix}-discount-value`)?.focus();
  }, [idPrefix, value.discountKind, value.discountValue]);

  function update(patch: Partial<MembershipCheckoutDraft>) {
    onChange({ ...value, ...patch });
  }

  function setDiscountEnabled(enabled: boolean) {
    setDiscountTouched(false);
    update({
      discountKind: enabled ? 'percentage' : null,
      discountValue: enabled ? DEFAULT_DISCOUNT_PERCENTAGE : '',
    });
  }

  function setBonusEnabled(enabled: boolean) {
    setBonusTouched(false);
    update({
      bonusMonthsEnabled: enabled,
      bonusMonths: enabled ? DEFAULT_BONUS_MONTHS : '',
    });
  }

  function setProductsEnabled(enabled: boolean) {
    update({
      includeProductsServices: enabled,
      selections: enabled ? value.selections : [],
    });
  }

  function setCollectionEnabled(enabled: boolean) {
    update({
      collectNow: enabled,
      collectionTiming: enabled ? value.collectionTiming : 'full',
    });
  }

  return (
    <div
      data-testid="shared-membership-checkout"
      data-mode={mode}
      className="min-w-0 space-y-4"
    >
      <section className="border-border space-y-4 rounded-lg border p-4">
        <h3 className="text-foreground text-base font-semibold">
          Membership details
        </h3>
        <PlanOptionPicker
          idPrefix={idPrefix}
          plans={plans}
          planId={value.planId}
          optionId={value.optionId}
          allowTrial={allowTrial}
          required
          disabled={plansLoading}
          onChange={(selection) =>
            update({
              planId: selection.planId,
              optionId: selection.optionId,
              discountKind: null,
              discountValue: '',
              bonusMonthsEnabled: false,
              bonusMonths: '',
              includeProductsServices: false,
              selections: [],
              collectionTiming: 'full',
            })
          }
          footer={
            plansLoading ? (
              <p className="text-muted-foreground text-xs">Loading plans…</p>
            ) : plans.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No active plans are available.
              </p>
            ) : null
          }
        />

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-start-date`}>Start date</Label>
          <DatePicker
            id={`${idPrefix}-start-date`}
            value={value.startDate}
            onChange={(startDate) => update({ startDate })}
            disabled={!startDateEditable}
          />
          {!startDateEditable && renewalStartExplanation ? (
            <p className="text-muted-foreground text-xs">
              {renewalStartExplanation}
            </p>
          ) : null}
        </div>

        {quote ? (
          <div className="border-border space-y-2 border-t pt-4">
            <SummaryRow
              label="Expiry"
              value={fmt.date(quote.periodEnd)}
              strong
            />
          </div>
        ) : null}
      </section>

      {!isTrial ? (
        <>
          <section className="border-border space-y-4 rounded-lg border p-4">
            <h3>
              <Label htmlFor={`${idPrefix}-discount-enabled`}>
                <Checkbox
                  id={`${idPrefix}-discount-enabled`}
                  checked={value.discountKind !== null}
                  disabled={!selectedOption}
                  onCheckedChange={(checked) =>
                    setDiscountEnabled(checked === true)
                  }
                />
                Offer discount
              </Label>
            </h3>
            <Collapse open={value.discountKind !== null}>
              <div className="-mx-1 space-y-4 px-1 py-1">
                <div className="grid gap-4 sm:grid-cols-[max-content_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label>Discount type</Label>
                    <Toolbar aria-label="Discount type">
                      <ToolbarToggleGroup<OneTimeDiscountKind>
                        value={value.discountKind ? [value.discountKind] : []}
                        onValueChange={(values) => {
                          const discountKind = values[0];
                          if (!discountKind) return;
                          setDiscountTouched(false);
                          update({
                            discountKind,
                            discountValue:
                              discountKind === 'percentage'
                                ? DEFAULT_DISCOUNT_PERCENTAGE
                                : '',
                          });
                        }}
                        aria-label="Discount type"
                      >
                        <ToolbarToggleItem value="percentage">
                          Percentage
                        </ToolbarToggleItem>
                        <ToolbarToggleItem value="amount">
                          Fixed amount
                        </ToolbarToggleItem>
                      </ToolbarToggleGroup>
                    </Toolbar>
                  </div>

                  <div className="min-w-0 space-y-2">
                    <Label htmlFor={`${idPrefix}-discount-value`}>
                      {value.discountKind === 'amount'
                        ? 'Discount amount'
                        : 'Discount percentage'}
                    </Label>
                    {value.discountKind === 'amount' ? (
                      <CurrencyInput
                        id={`${idPrefix}-discount-value`}
                        symbol={currencySymbol(locale.currency)}
                        groupLocale={locale.locale}
                        value={value.discountValue}
                        onValueChange={(discountValue) => {
                          setDiscountTouched(true);
                          update({ discountValue });
                        }}
                        onBlur={() => setDiscountTouched(true)}
                        inputMode="decimal"
                        aria-invalid={showDiscountError}
                        aria-describedby={
                          showDiscountError
                            ? `${idPrefix}-discount-error`
                            : undefined
                        }
                        className="tabular-nums"
                      />
                    ) : (
                      <div className="flex min-w-0 items-center gap-2">
                        <ChipGroup<string>
                          selectionMode="single"
                          value={
                            DISCOUNT_PERCENTAGE_PRESETS.includes(
                              value.discountValue as (typeof DISCOUNT_PERCENTAGE_PRESETS)[number]
                            )
                              ? [value.discountValue]
                              : []
                          }
                          onValueChange={(values) => {
                            const discountValue = values[0];
                            if (!discountValue) return;
                            setDiscountTouched(true);
                            update({ discountValue });
                          }}
                          aria-label="Common discount percentages"
                        >
                          {DISCOUNT_PERCENTAGE_PRESETS.map((preset) => (
                            <Chip key={preset} value={preset}>
                              {preset}%
                            </Chip>
                          ))}
                        </ChipGroup>
                        <Input
                          id={`${idPrefix}-discount-value`}
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          inputMode="decimal"
                          value={value.discountValue}
                          onChange={(event) => {
                            setDiscountTouched(true);
                            update({ discountValue: event.target.value });
                          }}
                          onBlur={() => setDiscountTouched(true)}
                          placeholder="10"
                          aria-invalid={showDiscountError}
                          aria-describedby={
                            showDiscountError
                              ? `${idPrefix}-discount-error`
                              : undefined
                          }
                          className="w-24 shrink-0 tabular-nums"
                        />
                      </div>
                    )}
                    {showDiscountError ? (
                      <p
                        id={`${idPrefix}-discount-error`}
                        role="alert"
                        className="text-destructive text-xs"
                      >
                        {discountErrorMessage}
                      </p>
                    ) : null}
                  </div>
                </div>

                {quote ? (
                  <div className="border-border space-y-2 border-t pt-4">
                    <SummaryRow
                      label="Regular membership fee"
                      value={fmt.money(quote.listPrice)}
                    />
                    <SummaryRow
                      label="Membership discount"
                      value={`−${fmt.money(quote.discountAmount)}`}
                    />
                    <SummaryRow
                      label="Final membership fee"
                      value={fmt.money(quote.membershipFee)}
                      strong
                    />
                  </div>
                ) : null}
              </div>
            </Collapse>
          </section>

          <section className="border-border space-y-4 rounded-lg border p-4">
            <h3>
              <Label htmlFor={`${idPrefix}-bonus-enabled`}>
                <Checkbox
                  id={`${idPrefix}-bonus-enabled`}
                  checked={value.bonusMonthsEnabled}
                  disabled={!selectedOption}
                  onCheckedChange={(checked) =>
                    setBonusEnabled(checked === true)
                  }
                />
                Offer bonus months
              </Label>
            </h3>
            <Collapse open={value.bonusMonthsEnabled}>
              <div className="-mx-1 space-y-4 px-1 py-1">
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-bonus-months`}>
                    Bonus months
                  </Label>
                  <div className="flex min-w-0 items-center gap-2">
                    <ChipGroup<string>
                      selectionMode="single"
                      value={
                        BONUS_MONTH_PRESETS.includes(
                          value.bonusMonths as (typeof BONUS_MONTH_PRESETS)[number]
                        )
                          ? [value.bonusMonths]
                          : []
                      }
                      onValueChange={(values) => {
                        const bonusMonths = values[0];
                        if (!bonusMonths) return;
                        setBonusTouched(true);
                        update({ bonusMonths });
                      }}
                      aria-label="Common bonus month offers"
                    >
                      {BONUS_MONTH_PRESETS.map((preset) => (
                        <Chip key={preset} value={preset}>
                          +{preset} {preset === '1' ? 'month' : 'months'}
                        </Chip>
                      ))}
                    </ChipGroup>
                    <Input
                      id={`${idPrefix}-bonus-months`}
                      type="number"
                      min={1}
                      max={MAX_CONVERSION_BONUS_MONTHS}
                      step={1}
                      inputMode="numeric"
                      value={value.bonusMonths}
                      onChange={(event) => {
                        setBonusTouched(true);
                        update({ bonusMonths: event.target.value });
                      }}
                      onBlur={() => setBonusTouched(true)}
                      aria-invalid={bonusTouched && !!bonusError}
                      aria-describedby={
                        bonusTouched && bonusError
                          ? `${idPrefix}-bonus-error`
                          : undefined
                      }
                      className="w-24 shrink-0 tabular-nums"
                    />
                  </div>
                  {bonusTouched && bonusError ? (
                    <p
                      id={`${idPrefix}-bonus-error`}
                      role="alert"
                      className="text-destructive text-xs"
                    >
                      {bonusError}
                    </p>
                  ) : null}
                </div>

                {quote && quote.bonusMonths > 0 ? (
                  <div className="border-border space-y-2 border-t pt-4">
                    <SummaryRow
                      label="Regular expiry"
                      value={fmt.date(quote.standardEndDate)}
                    />
                    <SummaryRow
                      label="Bonus time"
                      value={`+${quote.bonusMonths} ${quote.bonusMonths === 1 ? 'month' : 'months'}`}
                    />
                    <SummaryRow
                      label="Final expiry"
                      value={fmt.date(quote.periodEnd)}
                      strong
                    />
                  </div>
                ) : null}
              </div>
            </Collapse>
          </section>

          <section className="border-border space-y-4 rounded-lg border p-4">
            <h3>
              <Label htmlFor={`${idPrefix}-products-enabled`}>
                <Checkbox
                  id={`${idPrefix}-products-enabled`}
                  checked={value.includeProductsServices}
                  disabled={!selectedOption}
                  onCheckedChange={(checked) =>
                    setProductsEnabled(checked === true)
                  }
                />
                Products &amp; services
              </Label>
            </h3>
            <Collapse open={value.includeProductsServices}>
              <div className="-mx-1 px-1 py-1">
                <ProductsServicesPicker
                  value={value.selections}
                  onChange={(selections) => update({ selections })}
                  membershipEnd={quote?.periodEnd ?? null}
                  defaultStartDate={value.startDate}
                  presentation="catalogue"
                />
              </div>
            </Collapse>
          </section>

          <section className="border-border space-y-4 rounded-lg border p-4">
            <h3>
              <Label htmlFor={`${idPrefix}-collect-now`}>
                <Checkbox
                  id={`${idPrefix}-collect-now`}
                  checked={
                    quote ? quote.cashDue > 0 && value.collectNow : false
                  }
                  disabled={!quote || quote.cashDue <= 0}
                  aria-describedby={
                    quoteBlockedReason
                      ? `${idPrefix}-collection-unavailable`
                      : undefined
                  }
                  onCheckedChange={(checked) =>
                    setCollectionEnabled(checked === true)
                  }
                />
                Collect payment now
              </Label>
            </h3>

            {quoteBlockedReason ? (
              <p
                id={`${idPrefix}-collection-unavailable`}
                className="text-muted-foreground text-xs"
              >
                {quoteBlockedReason}
              </p>
            ) : null}

            {quote ? (
              <div className="space-y-2">
                <SummaryRow
                  label="Regular membership fee"
                  value={fmt.money(quote.listPrice)}
                />
                {quote.discountAmount > 0 ? (
                  <SummaryRow
                    label="Membership discount"
                    value={`−${fmt.money(quote.discountAmount)}`}
                  />
                ) : null}
                <SummaryRow
                  label="Final membership fee"
                  value={fmt.money(quote.membershipFee)}
                />
                {quote.addOnTotal > 0 ? (
                  <SummaryRow
                    label="Products & services"
                    value={fmt.money(quote.addOnTotal)}
                  />
                ) : null}
                <SummaryRow
                  label="Invoice total"
                  value={fmt.money(quote.invoiceTotal)}
                />
                {quote.creditApplied > 0 ? (
                  <SummaryRow
                    label="Member credit applied"
                    value={`−${fmt.money(quote.creditApplied)}`}
                  />
                ) : null}
                <SummaryRow
                  label={value.collectNow ? 'Cash due' : 'Amount due'}
                  value={fmt.money(quote.cashDue)}
                  strong
                />
              </div>
            ) : null}

            {quote && quote.cashDue <= 0 ? (
              <p className="text-foreground text-sm font-medium">
                No payment required
              </p>
            ) : null}

            <Collapse open={!!quote && quote.cashDue > 0 && value.collectNow}>
              {quote ? (
                <div className="-mx-1 space-y-4 px-1 py-1">
                  <RadioGroup
                    value={
                      quote.installmentsAvailable
                        ? value.collectionTiming
                        : 'full'
                    }
                    onValueChange={(collectionTiming) =>
                      collectionTiming &&
                      update({
                        collectionTiming:
                          collectionTiming as MembershipCheckoutDraft['collectionTiming'],
                      })
                    }
                  >
                    <label
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                        value.collectionTiming === 'full'
                          ? 'border-primary/40 bg-primary/[0.04]'
                          : 'border-border hover:border-border-hover'
                      )}
                    >
                      <RadioGroupItem value="full" className="mt-0.5" />
                      <span className="min-w-0 space-y-0.5">
                        <span className="text-foreground block text-sm font-medium">
                          Collect full amount
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          <span className="tabular-nums">
                            {fmt.money(quote.cashDue)}
                          </span>{' '}
                          due today · {fmt.date(fmt.today())}
                        </span>
                      </span>
                    </label>
                    {quote.installmentsAvailable ? (
                      <label
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                          value.collectionTiming === 'installments'
                            ? 'border-primary/40 bg-primary/[0.04]'
                            : 'border-border hover:border-border-hover'
                        )}
                      >
                        <RadioGroupItem
                          value="installments"
                          className="mt-0.5"
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="text-foreground block text-sm font-medium">
                            Part now, part later
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            <span className="tabular-nums">
                              {fmt.money(quote.installmentNow)}
                            </span>{' '}
                            now, then{' '}
                            <span className="tabular-nums">
                              {fmt.money(quote.installmentLater)}
                            </span>{' '}
                            on {fmt.date(installmentSecondDueOn(fmt.today()))}.
                            No extra fees.
                          </span>
                        </span>
                      </label>
                    ) : null}
                  </RadioGroup>

                  <div className="space-y-2">
                    <Label htmlFor={`${idPrefix}-payment-method`}>
                      Today&apos;s payment method
                    </Label>
                    <Select
                      value={value.paymentMethod}
                      onValueChange={(paymentMethod) =>
                        paymentMethod &&
                        update({
                          paymentMethod: paymentMethod as PaymentMethod,
                        })
                      }
                    >
                      <SelectTrigger
                        id={`${idPrefix}-payment-method`}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method.value} value={method.value}>
                            {method.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </Collapse>
          </section>
        </>
      ) : null}
    </div>
  );
}
