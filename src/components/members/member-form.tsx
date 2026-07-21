'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, AlertTriangle, Camera, Pencil } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import { useLocale } from '@/hooks/use-locale';
import { istAddDays, daysBetween } from '@/lib/memberships/expiry';
import { membershipIdForContact } from '@/lib/memberships/lookup';
import { editMembershipCycle } from '@/lib/memberships/periods';
import { cmToFeetInches, feetInchesToCm, kgToLb, lbToKg } from '@/lib/bmi/bmi';
import {
  oneTimeDiscountError,
  oneTimeDiscountQuote,
  type OneTimeDiscountKind,
} from '@/lib/memberships/discount';
import {
  durationLabel,
  firstCycleFee,
  optionEndDate,
} from '@/lib/memberships/pricing';
import { currencySymbol } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { Membership, PaymentMethod } from '@/types';
import { useMembershipPlans } from './use-membership-plans';
import { PlanOptionPicker, TRIAL_PLAN_VALUE } from './plan-option-picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserAvatar } from '@/components/ui/user-avatar';
import { InlineEditActions } from '@/components/ui/inline-edit-actions';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AvatarEditorDialog } from './avatar-editor-dialog';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

type ConversionDiscountMode = 'none' | OneTimeDiscountKind;

const DISCOUNT_PERCENTAGE_PRESETS = ['10', '20', '30'] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface MemberFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode — a membership row with its contact hydrated. */
  member?: Membership | null;
  /**
   * Add-mode prefill. An `id` marks lead conversion and makes the existing
   * contact authoritative even when staff correct its phone number.
   */
  seedContact?: {
    id?: string;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    heightCm?: number | null;
    weightKg?: number | null;
  } | null;
  onSaved: () => void;
  /** Jump to an existing member's detail (dedupe found they already exist). */
  onViewExisting?: (contactId: string) => void;
}

export function MemberForm({
  open,
  onOpenChange,
  member,
  seedContact,
  onSaved,
  onViewExisting,
}: MemberFormProps) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const { locale, fmt } = useLocale();
  const symbol = currencySymbol(locale.currency);
  const {
    plans,
    loading: plansLoading,
    refresh: refreshPlans,
  } = useMembershipPlans(true);
  const isEdit = !!member;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [planId, setPlanId] = useState('');
  const [optionId, setOptionId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(fmt.today());
  const [feeAmount, setFeeAmount] = useState('');
  // Tracks whether the user typed the fee themselves. Until they do, the
  // fee follows the selected plan's price — so switching plans can't
  // leave a stale price from the previous pick.
  const [feeTouched, setFeeTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);

  const [discountMode, setDiscountMode] =
    useState<ConversionDiscountMode>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [discountTouched, setDiscountTouched] = useState(false);

  // First-payment capture (add mode only). Defaults ON — a walk-in pays
  // at signup; staff untick for the exception, not the rule. Amount
  // defaults to the full fee but accepts a partial joining payment.
  const [collectPayment, setCollectPayment] = useState(true);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payAmount, setPayAmount] = useState('');

  // Trial / lead: a free pass with its own length instead of a plan's
  // duration. Plan optional, no fee, no payment. Convert-to-member
  // happens later from the Trials list.
  const [isTrial, setIsTrial] = useState(false);
  const [trialDays, setTrialDays] = useState('7');

  // A phone that already belongs to a contact. `isMember` splits the two
  // outcomes: a plain contact gets the membership attached (fine), an
  // existing member is a dead end (UNIQUE(account_id, contact_id)).
  const [dupMatch, setDupMatch] = useState<{
    contact: ExistingContact;
    exact: boolean;
    isMember: boolean;
  } | null>(null);
  const [checkingDup, setCheckingDup] = useState(false);

  // A seeded contact ID makes conversion mode stable while staff correct
  // the lead's phone number in step 1. The old phone-comparison heuristic
  // could accidentally create a new contact and leave the lead behind.
  const isConvert = !isEdit && !!seedContact?.id;
  const convertName =
    name.trim() || seedContact?.name?.trim() || 'This contact';

  const selectedPlan = plans.find((p) => p.id === planId);
  // An ARCHIVED option still resolves when it's the membership's own
  // (edit mode) — otherwise a routine edit of a member whose option was
  // retired would fall back to the plan's frozen legacy duration and
  // silently rewrite their cycle length. New picks stay active-only.
  const selectedOption =
    selectedPlan?.pricing_options?.find(
      (o) =>
        o.id === optionId &&
        (o.is_active || (isEdit && o.id === member?.pricing_option_id))
    ) ?? null;
  // The fee the first payment settles against. Conversion applies its
  // explicit one-time offer; normal add mode keeps the editable-fee fallback.
  const regularFirstFee = selectedOption ? firstCycleFee(selectedOption) : 0;
  const discountKind = discountMode === 'none' ? null : discountMode;
  const discountQuote = oneTimeDiscountQuote(
    regularFirstFee,
    discountKind,
    discountValue
  );
  const discountFieldError =
    discountKind && discountTouched
      ? oneTimeDiscountError(regularFirstFee, discountKind, discountValue)
      : null;
  const previewFee = isConvert
    ? discountQuote.firstInvoiceTotal
    : feeAmount === ''
      ? regularFirstFee
      : Number(feeAmount) || 0;

  // Paid-membership expiry: the picked billing option drives it; a
  // legacy membership without an option (edit mode, plan unchanged)
  // keeps its CURRENT cycle length — never the plan's frozen
  // duration_days, which mirrors the first option and may not be this
  // member's duration.
  function paidEndDate(): string | null {
    if (selectedOption) return optionEndDate(startDate, selectedOption);
    if (isEdit && member && planId === member.plan_id) {
      const len = daysBetween(member.start_date, member.end_date);
      if (Number.isFinite(len) && len > 0) return istAddDays(startDate, len);
    }
    return null;
  }

  useEffect(() => {
    if (!open) return;
    // Edit mode reads the membership's contact; add mode falls back to
    // the optional seed (lead → member conversion), else blank.
    setName(member?.contact?.name ?? seedContact?.name ?? '');
    setPhone(member?.contact?.phone ?? seedContact?.phone ?? '');
    setEmail(member?.contact?.email ?? seedContact?.email ?? '');
    setPlanId(member?.plan_id ?? '');
    setOptionId(member?.pricing_option_id ?? null);
    setStartDate(member?.start_date ?? fmt.today());
    setFeeAmount(member ? String(member.fee_amount) : '');
    // An existing fee is authoritative — never auto-reseed it from a plan
    // switch in edit mode; add mode follows the plan until the user types.
    setFeeTouched(!!member);
    setNotes(member?.notes ?? '');
    setAvatarUrl(member?.contact?.avatar_url ?? seedContact?.avatarUrl ?? null);
    setAvatarOpen(false);
    setHeightCm(member?.contact?.height_cm ?? seedContact?.heightCm ?? null);
    setWeightKg(member?.contact?.weight_kg ?? seedContact?.weightKg ?? null);
    setDiscountMode('none');
    setDiscountValue('');
    setDiscountTouched(false);
    setCollectPayment(!member);
    setPayMethod('cash');
    setPayAmount('');
    setDupMatch(null);
    setIsTrial(member?.is_trial ?? false);
    // Seed trial length from the existing trial's span, else a 7-day default.
    const td = member?.is_trial
      ? daysBetween(member.start_date, member.end_date)
      : NaN;
    setTrialDays(Number.isFinite(td) && td > 0 ? String(td) : '7');
    // seedContact is read only at open; re-seeding on its identity would
    // clobber user edits, so it's intentionally out of the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member]);

  // The fee follows the selected billing option's first-cycle fee
  // (price + one-time joining fee) until the user edits it (feeTouched)
  // — so switching options re-seeds instead of keeping a stale price.
  // Edit mode opens touched (existing fee is authoritative).
  useEffect(() => {
    if (!selectedOption || feeTouched) return;
    setFeeAmount(String(firstCycleFee(selectedOption)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionId]);

  // The no-plans hint links to Settings in a new tab; refetch plans when
  // the user tabs back so the plan they just created is pickable without
  // reopening the dialog.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('focus', refreshPlans);
    return () => window.removeEventListener('focus', refreshPlans);
  }, [open, refreshPlans]);

  async function checkDuplicate() {
    if (isEdit || !accountId) return;
    const value = phone.trim();
    if (!value || isConvert) return setDupMatch(null);
    setCheckingDup(true);
    try {
      const existing = await findExistingContact(supabase, accountId, value);
      if (!existing) return setDupMatch(null);
      // An exact match may already hold a membership — surface that here
      // rather than at submit, where the unique violation only produces a
      // toast after the form is filled out.
      const exact = isExactMatch(existing, value);
      const isMember = exact
        ? !!(await membershipIdForContact(supabase, existing.id))
        : false;
      setDupMatch({ contact: existing, exact, isMember });
    } finally {
      setCheckingDup(false);
    }
  }

  async function saveConversionField(
    column: 'name' | 'phone' | 'email',
    rawValue: string
  ): Promise<boolean> {
    if (!isConvert || !seedContact?.id || !accountId) return false;
    const value = rawValue.trim();
    if (column === 'phone' && !value) {
      toast.error('Phone number is required');
      return false;
    }
    if (column === 'email' && value && !EMAIL_RE.test(value)) {
      toast.error('Enter a valid email address');
      return false;
    }

    try {
      if (column === 'phone') {
        const existing = await findExistingContact(supabase, accountId, value);
        if (
          existing &&
          existing.id !== seedContact.id &&
          isExactMatch(existing, value)
        ) {
          toast.error('This phone number belongs to another contact');
          return false;
        }
      }

      const { data, error } = await supabase
        .from('contacts')
        .update({ [column]: value || null })
        .eq('id', seedContact.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        throw new Error("You don't have permission to update this contact.");
      }

      if (column === 'name') setName(value);
      if (column === 'phone') setPhone(value);
      if (column === 'email') setEmail(value);
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update contact details'));
      return false;
    }
  }

  async function saveConversionMeasurement(
    column: 'height_cm' | 'weight_kg',
    value: number | null
  ): Promise<boolean> {
    if (!isConvert || !seedContact?.id) return false;
    try {
      const { data, error } = await supabase
        .from('contacts')
        .update({ [column]: value })
        .eq('id', seedContact.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        throw new Error("You don't have permission to update measurements.");
      }
      if (column === 'height_cm') setHeightCm(value);
      if (column === 'weight_kg') setWeightKg(value);
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update measurements'));
      return false;
    }
  }

  async function saveDisplayedHeight(rawValue: string): Promise<boolean> {
    if (!rawValue.trim()) {
      return saveConversionMeasurement('height_cm', null);
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter a valid height');
      return false;
    }
    const canonical =
      locale.measurementSystem === 'imperial'
        ? feetInchesToCm(0, value)
        : Math.round(value * 10) / 10;
    return saveConversionMeasurement('height_cm', canonical);
  }

  async function saveDisplayedWeight(rawValue: string): Promise<boolean> {
    if (!rawValue.trim()) {
      return saveConversionMeasurement('weight_kg', null);
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter a valid weight');
      return false;
    }
    const canonical =
      locale.measurementSystem === 'imperial'
        ? lbToKg(value)
        : Math.round(value * 10) / 10;
    return saveConversionMeasurement('weight_kg', canonical);
  }

  async function refreshConversionAvatar() {
    if (!seedContact?.id) return;
    const { data } = await supabase
      .from('contacts')
      .select('avatar_url')
      .eq('id', seedContact.id)
      .single();
    setAvatarUrl(data?.avatar_url ?? null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return toast.error('Phone number is required');
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      return toast.error('Enter a valid email address');
    }
    if (!accountId || !user)
      return toast.error('Your profile is not linked to an account.');
    // Known-member dedupe hit: the membership insert would fail on
    // UNIQUE(account_id, contact_id) anyway — send staff to the member
    // instead of letting them fill out a form that can't save.
    if (dupMatch?.isMember) {
      toast.error('This person is already a member.');
      onOpenChange(false);
      onViewExisting?.(dupMatch.contact.id);
      return;
    }

    const trialLen = Number(trialDays);
    if (isTrial) {
      if (!Number.isFinite(trialLen) || trialLen <= 0)
        return toast.error('Enter a valid trial length in days');
    } else if (!planId) {
      return toast.error('Pick a membership plan (or Trial / free pass)');
    }

    // Plan + billing option are required for a paid member; a legacy
    // edit (no option on the row) may proceed on the plan's frozen days.
    const plan = plans.find((p) => p.id === planId);
    if (!isTrial && !plan) return toast.error('Selected plan is unavailable');
    const endForPaid = paidEndDate();
    if (!isTrial && !endForPaid) {
      return toast.error('Pick a billing option for this plan');
    }
    if (isConvert && !isTrial) {
      setDiscountTouched(true);
      const discountError = oneTimeDiscountError(
        regularFirstFee,
        discountKind,
        discountValue
      );
      if (discountError) return toast.error(discountError);
    }

    // Trials are free; a paid member's fee seeds from the option's
    // first-cycle fee (price + one-time joining fee).
    // No-option (legacy edit) rows fall back to the membership's own fee,
    // not the plan's frozen price (which mirrors the first option only).
    const fee = isTrial
      ? 0
      : isConvert
        ? discountQuote.firstInvoiceTotal
        : feeAmount === ''
          ? selectedOption
            ? firstCycleFee(selectedOption)
            : Number(member?.fee_amount ?? 0)
          : Number(feeAmount);
    if (!Number.isFinite(fee) || fee < 0)
      return toast.error('Enter a valid fee');

    // First payment: blank = the full fee; a typed amount may be a
    // partial joining payment but can't exceed the fee.
    const collecting = collectPayment && !isTrial && fee > 0;
    const payAmt = payAmount === '' ? fee : Number(payAmount);
    if (collecting) {
      if (!Number.isFinite(payAmt) || payAmt <= 0)
        return toast.error('Enter a valid payment amount');
      if (payAmt > fee) return toast.error('The payment cannot exceed the fee');
    }

    setSaving(true);
    try {
      // ---- EDIT: update contact + membership in place ----
      if (isEdit && member) {
        const endDate = isTrial ? istAddDays(startDate, trialLen) : endForPaid!;
        const { error: cErr } = await supabase
          .from('contacts')
          .update({
            name: name.trim() || null,
            phone: phone.trim(),
            email: email.trim() || null,
          })
          .eq('id', member.contact_id);
        if (cErr) throw cErr;

        // One transaction (migration 058): membership + current period +
        // that period's payment re-stamps move together, so an aborted
        // edit can't leave the cycle keys diverged.
        const { error: mErr } = await editMembershipCycle(supabase, member.id, {
          plan_id: isTrial ? planId || null : planId,
          pricing_option_id: isTrial ? null : optionId,
          period_start: startDate,
          period_end: endDate,
          fee_amount: fee,
          is_trial: isTrial,
          notes: notes.trim() || null,
        });
        if (mErr) throw mErr;

        toast.success('Member updated');
        onOpenChange(false);
        onSaved();
        return;
      }

      // ---- ADD: find-or-create contact, then create membership ----
      let contactId: string;
      if (isConvert && seedContact?.id) {
        contactId = seedContact.id;
        // Conversion always updates the lead that opened this dialog.
        const patch: Record<string, string> = {};
        if (name.trim() && name.trim() !== (seedContact.name ?? '')) {
          patch.name = name.trim();
        }
        if (email.trim() && email.trim() !== (seedContact.email ?? '')) {
          patch.email = email.trim();
        }
        if (phone.trim() !== (seedContact.phone ?? '')) {
          patch.phone = phone.trim();
        }
        if (Object.keys(patch).length) {
          const { data: updated, error: uErr } = await supabase
            .from('contacts')
            .update(patch)
            .eq('id', contactId)
            .select('id');
          if (uErr) throw uErr;
          if (!updated?.length) {
            throw new Error('You do not have access to update this contact.');
          }
        }
      } else {
        const existing = await findExistingContact(
          supabase,
          accountId,
          phone.trim()
        );
        if (existing) {
          contactId = existing.id;
          // The form's fields are authoritative over the existing record —
          // staff correcting a lead's name/email on the way in expects it to
          // stick (it used to be silently dropped). Only non-empty values are
          // written, so a blank field can't wipe what the contact already has.
          const patch: Record<string, string> = {};
          if (name.trim() && name.trim() !== (existing.name ?? ''))
            patch.name = name.trim();
          if (
            email.trim() &&
            email.trim() !== ((existing.email as string | null) ?? '')
          )
            patch.email = email.trim();
          if (phone.trim() && phone.trim() !== existing.phone)
            patch.phone = phone.trim();
          if (Object.keys(patch).length) {
            // Silent-RLS rule: a blocked update returns no error and no rows.
            const { data: updated, error: uErr } = await supabase
              .from('contacts')
              .update(patch)
              .eq('id', contactId)
              .select('id');
            if (uErr) throw uErr;
            if (!updated?.length)
              throw new Error('You do not have access to update this contact.');
          }
        } else {
          const { data, error } = await supabase
            .from('contacts')
            .insert({
              user_id: user.id,
              account_id: accountId,
              name: name.trim() || null,
              phone: phone.trim(),
              email: email.trim() || null,
              // Origin (migration 048): a human added this record in the UI.
              received_via: 'manual' as const,
            })
            .select('id')
            .single();
          if (error) throw error;
          contactId = data.id;
        }
      }

      const endDate = isTrial ? istAddDays(startDate, trialLen) : endForPaid!;
      const { data: mRow, error: mErr } = await supabase
        .from('memberships')
        .insert({
          account_id: accountId,
          contact_id: contactId,
          user_id: user.id,
          plan_id: isTrial ? planId || null : planId,
          pricing_option_id: isTrial ? null : optionId,
          start_date: startDate,
          end_date: endDate,
          status: 'active',
          fee_amount: fee,
          is_trial: isTrial,
          notes: notes.trim() || null,
          conversion_list_price:
            isConvert && !isTrial ? discountQuote.listPrice : null,
          conversion_discount_type: isConvert && !isTrial ? discountKind : null,
          conversion_discount_value:
            isConvert && !isTrial && discountKind
              ? Number(discountValue)
              : null,
          conversion_discount_amount:
            isConvert && !isTrial ? discountQuote.discountAmount : 0,
        })
        .select('id, member_number')
        .single();

      if (mErr) {
        // UNIQUE(account_id, contact_id): this contact is already a member.
        if (isUniqueViolation(mErr)) {
          toast.error('This person is already a member.');
          onOpenChange(false);
          onViewExisting?.(contactId);
          return;
        }
        throw mErr;
      }

      // Optional first payment (never for a free trial).
      if (collecting) {
        const { error: pErr } = await supabase.rpc(
          'record_membership_payment',
          {
            p_membership_id: mRow.id,
            p_period_end: endDate,
            p_amount: payAmt,
            p_method: payMethod,
            p_paid_at: new Date().toISOString(),
            p_note: '',
            p_receipt_path: null,
            p_idempotency_key: crypto.randomUUID(),
          }
        );
        if (pErr) {
          // The membership is saved; a payment hiccup shouldn't block it.
          toast.warning(
            "Member created, but the payment couldn't be recorded."
          );
          onOpenChange(false);
          onSaved();
          return;
        }
      }

      toast.success(
        isTrial
          ? `Trial added · Member ID ${mRow.member_number}`
          : isConvert
            ? `Converted to member · Member ID ${mRow.member_number}`
            : `Member added · Member ID ${mRow.member_number}`,
        {
          // One tap to the new member's sheet (photo, auto-pay, notes).
          action: onViewExisting
            ? { label: 'View', onClick: () => onViewExisting(contactId) }
            : undefined,
        }
      );
      onOpenChange(false);
      onSaved();
    } catch (err) {
      if (isUniqueViolation(err)) {
        toast.error('A contact with this phone number already exists.');
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Failed to save member');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[96vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md',
          isConvert &&
            'h-[min(96vh,900px)] sm:max-w-[min(960px,calc(100vw-2rem))]'
        )}
      >
        <DialogHeader className="border-border shrink-0 border-b p-5">
          <DialogTitle>
            {isEdit
              ? 'Edit member'
              : isConvert
                ? 'Convert to member'
                : 'Add member'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this member's details."
              : isConvert
                ? 'Review the lead and set up their membership.'
                : 'Add a member and start their membership.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto',
              isConvert
                ? 'grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'
                : 'px-4 py-2'
            )}
          >
            {isConvert && (
              <aside className="border-border border-b p-5 md:border-r md:border-b-0">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setAvatarOpen(true)}
                    aria-label="Change profile picture"
                    className="group/avatar-edit relative shrink-0 rounded-full"
                  >
                    <UserAvatar size="lg" name={convertName} src={avatarUrl} />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar-edit:opacity-100 group-focus-visible/avatar-edit:opacity-100">
                      <Camera className="size-4" />
                    </span>
                  </button>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-foreground truncate font-medium">
                      {convertName}
                    </p>
                    <p className="text-muted-foreground truncate text-sm">
                      {phone.trim()}
                    </p>
                  </div>
                </div>

                <div className="mt-7">
                  <p className="text-foreground mb-3 text-sm font-semibold">
                    Personal information
                  </p>
                  <dl className="border-border divide-border divide-y overflow-hidden rounded-lg border">
                    <ConversionEditableDetailRow
                      label="Name"
                      value={name}
                      placeholder="Add name"
                      onSave={(value) => saveConversionField('name', value)}
                    />
                    <ConversionEditableDetailRow
                      label="Phone"
                      value={phone}
                      placeholder="Add phone"
                      onSave={(value) => saveConversionField('phone', value)}
                    />
                    <ConversionEditableDetailRow
                      label="Email"
                      value={email}
                      type="email"
                      placeholder="Add email"
                      onSave={(value) => saveConversionField('email', value)}
                    />
                  </dl>
                </div>

                <div className="mt-6">
                  <p className="text-foreground mb-3 text-sm font-semibold">
                    Body measurements
                  </p>
                  <dl className="border-border divide-border divide-y overflow-hidden rounded-lg border">
                    <ConversionEditableDetailRow
                      label="Height"
                      type="number"
                      inputMode="decimal"
                      value={measurementHeightDraft(
                        heightCm,
                        locale.measurementSystem
                      )}
                      displayValue={formatMeasurementHeight(
                        heightCm,
                        locale.measurementSystem
                      )}
                      placeholder={
                        locale.measurementSystem === 'imperial' ? 'in' : 'cm'
                      }
                      onSave={saveDisplayedHeight}
                    />
                    <ConversionEditableDetailRow
                      label="Weight"
                      type="number"
                      inputMode="decimal"
                      value={measurementWeightDraft(
                        weightKg,
                        locale.measurementSystem
                      )}
                      displayValue={formatMeasurementWeight(
                        weightKg,
                        locale.measurementSystem
                      )}
                      placeholder={
                        locale.measurementSystem === 'imperial' ? 'lb' : 'kg'
                      }
                      onSave={saveDisplayedWeight}
                    />
                  </dl>
                </div>
              </aside>
            )}

            <div
              className={cn(
                'space-y-4',
                isConvert && 'space-y-6 px-5 py-5 sm:px-6'
              )}
            >
              {isConvert && (
                <h3 className="text-foreground text-base font-semibold">
                  Membership details
                </h3>
              )}
              {!isConvert && (
                <>
                  {/* Phone leads: it's the identity key — the dedupe check fires
                off it, so an existing member surfaces before staff types
                out the rest of the form. */}
                  <div className="space-y-2">
                    <Label htmlFor="mf-phone">
                      Phone <span className="text-red-foreground">*</span>
                    </Label>
                    <Input
                      id="mf-phone"
                      autoFocus={!isEdit}
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (dupMatch) setDupMatch(null);
                      }}
                      onBlur={checkDuplicate}
                      placeholder={
                        locale.phoneCountryCode
                          ? `${locale.phoneCountryCode} 98765 43210`
                          : '+91 98765 43210'
                      }
                    />
                    {dupMatch ? (
                      <div className="text-amber-foreground flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <div className="space-y-1">
                          <p>
                            {dupMatch.isMember
                              ? `${dupMatch.contact.name || 'This person'} already has a membership — open their profile to renew or edit it.`
                              : dupMatch.exact
                                ? `This number already belongs to ${dupMatch.contact.name || 'an existing contact'}. No duplicate is created — the membership attaches to that record, and any details you change here update it.`
                                : 'A contact with a very similar number already exists.'}
                          </p>
                          {onViewExisting && (
                            <button
                              type="button"
                              onClick={() =>
                                onViewExisting(dupMatch.contact.id)
                              }
                              className="font-medium underline underline-offset-2 hover:no-underline"
                            >
                              View{' '}
                              {dupMatch.contact.name || dupMatch.contact.phone}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        Include country code
                        {locale.phoneCountryCode
                          ? `, e.g. ${locale.phoneCountryCode}`
                          : ', e.g. +91'}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mf-name">Name</Label>
                    <Input
                      id="mf-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mf-email">Email</Label>
                    <Input
                      id="mf-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="member@example.com"
                    />
                  </div>
                </>
              )}

              {/* Membership fields are shared by Add/Edit and conversion;
                   conversion simply places them in the right-hand pane. */}
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <PlanOptionPicker
                      idPrefix="mf"
                      plans={plans}
                      planId={isTrial ? TRIAL_PLAN_VALUE : planId}
                      optionId={optionId}
                      allowTrial
                      required
                      onChange={(sel) => {
                        if (sel.planId === TRIAL_PLAN_VALUE) {
                          setIsTrial(true);
                          setPlanId('');
                          setOptionId(null);
                        } else {
                          setIsTrial(false);
                          setPlanId(sel.planId);
                          setOptionId(sel.optionId);
                        }
                      }}
                      footer={
                        !plansLoading && plans.length === 0 ? (
                          <p className="text-muted-foreground text-xs">
                            No plans yet —{' '}
                            <a
                              href="/settings?tab=plans"
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline underline-offset-2 hover:no-underline"
                            >
                              create one in Settings
                            </a>
                            , then come back.
                          </p>
                        ) : null
                      }
                    />
                    {!isTrial && selectedPlan && paidEndDate() && (
                      <p className="text-muted-foreground text-xs">
                        Expires {fmt.date(paidEndDate()!)}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mf-start">Start date</Label>
                    <DatePicker
                      id="mf-start"
                      value={startDate}
                      onChange={setStartDate}
                    />
                  </div>
                </div>

                {isTrial ? (
                  <div className="space-y-2">
                    <Label htmlFor="mf-trial-days">Trial length (days)</Label>
                    <Input
                      id="mf-trial-days"
                      type="number"
                      min={1}
                      value={trialDays}
                      onChange={(e) => setTrialDays(e.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">
                      Ends{' '}
                      {fmt.date(istAddDays(startDate, Number(trialDays) || 0))}{' '}
                      · free pass, no fee — convert to a paid plan later.
                    </p>
                  </div>
                ) : (
                  <>
                    {isConvert ? (
                      selectedOption && (
                        <div className="border-border space-y-4 rounded-lg border p-4">
                          <Label htmlFor="mf-offer-discount">
                            <Checkbox
                              id="mf-offer-discount"
                              checked={discountKind !== null}
                              onCheckedChange={(checked) => {
                                setDiscountMode(
                                  checked === true ? 'percentage' : 'none'
                                );
                                setDiscountValue('');
                                setDiscountTouched(false);
                              }}
                            />
                            Offer discount
                          </Label>

                          {discountKind && (
                            <>
                              <div className="grid gap-4 sm:grid-cols-[max-content_minmax(0,1fr)]">
                                <div className="space-y-2">
                                  <Label>Discount type</Label>
                                  <Toolbar aria-label="Discount type">
                                    <ToolbarToggleGroup<OneTimeDiscountKind>
                                      value={[discountKind]}
                                      onValueChange={(values) => {
                                        if (!values[0]) return;
                                        setDiscountMode(values[0]);
                                        setDiscountValue('');
                                        setDiscountTouched(false);
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
                                  <Label htmlFor="mf-discount-value">
                                    {discountKind === 'amount'
                                      ? 'Discount amount'
                                      : 'Discount percentage'}
                                  </Label>
                                  {discountKind === 'amount' ? (
                                    <CurrencyInput
                                      id="mf-discount-value"
                                      symbol={symbol}
                                      groupLocale={locale.locale}
                                      value={discountValue}
                                      onValueChange={(value) => {
                                        setDiscountValue(value);
                                        setDiscountTouched(true);
                                      }}
                                      onBlur={() => setDiscountTouched(true)}
                                      inputMode="decimal"
                                      placeholder="0"
                                      aria-invalid={!!discountFieldError}
                                      aria-describedby={
                                        discountFieldError
                                          ? 'mf-discount-error'
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
                                            discountValue as (typeof DISCOUNT_PERCENTAGE_PRESETS)[number]
                                          )
                                            ? [discountValue]
                                            : []
                                        }
                                        onValueChange={(values) => {
                                          const value = values[0];
                                          if (!value) return;
                                          setDiscountValue(value);
                                          setDiscountTouched(true);
                                        }}
                                        aria-label="Common discount percentages"
                                      >
                                        {DISCOUNT_PERCENTAGE_PRESETS.map(
                                          (value) => (
                                            <Chip key={value} value={value}>
                                              {value}%
                                            </Chip>
                                          )
                                        )}
                                      </ChipGroup>
                                      <Input
                                        id="mf-discount-value"
                                        type="number"
                                        min={0}
                                        max={100}
                                        step="0.01"
                                        inputMode="decimal"
                                        value={discountValue}
                                        onChange={(event) => {
                                          setDiscountValue(event.target.value);
                                          setDiscountTouched(true);
                                        }}
                                        onBlur={() => setDiscountTouched(true)}
                                        placeholder="10"
                                        aria-invalid={!!discountFieldError}
                                        aria-describedby={
                                          discountFieldError
                                            ? 'mf-discount-error'
                                            : undefined
                                        }
                                        className="w-24 shrink-0 tabular-nums"
                                      />
                                    </div>
                                  )}
                                  {discountFieldError && (
                                    <p
                                      id="mf-discount-error"
                                      role="alert"
                                      className="text-destructive text-xs"
                                    >
                                      {discountFieldError}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="border-border space-y-2 border-t pt-4">
                                <div className="text-muted-foreground flex items-center justify-between gap-4">
                                  <span>Regular first invoice</span>
                                  <span className="tabular-nums">
                                    {fmt.money(discountQuote.listPrice)}
                                  </span>
                                </div>
                                {discountQuote.discountAmount > 0 && (
                                  <div className="text-muted-foreground flex items-center justify-between gap-4">
                                    <span>
                                      Discount
                                      {discountKind === 'percentage' &&
                                      discountValue
                                        ? ` (${discountValue}%)`
                                        : ''}
                                    </span>
                                    <span className="tabular-nums">
                                      −{fmt.money(discountQuote.discountAmount)}
                                    </span>
                                  </div>
                                )}
                                <div className="text-foreground flex items-center justify-between gap-4 font-medium">
                                  <span>First invoice total</span>
                                  <span className="tabular-nums">
                                    {fmt.money(discountQuote.firstInvoiceTotal)}
                                  </span>
                                </div>
                              </div>

                              <p className="text-muted-foreground text-xs">
                                {selectedPlan?.plan_type === 'recurring'
                                  ? `Future renewals return to ${fmt.money(selectedOption.price)} per ${durationLabel(selectedOption.duration_count, selectedOption.duration_unit)}.`
                                  : 'The regular plan price is unchanged; this offer applies only to this purchase.'}
                              </p>
                            </>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="mf-fee">Fee for this period</Label>
                        <Input
                          id="mf-fee"
                          type="number"
                          min={0}
                          value={feeAmount}
                          onChange={(e) => {
                            setFeeAmount(e.target.value);
                            setFeeTouched(true);
                          }}
                          placeholder={
                            selectedOption
                              ? String(firstCycleFee(selectedOption))
                              : '0'
                          }
                        />
                        {!isEdit &&
                          selectedOption &&
                          selectedOption.setup_fee > 0 && (
                            <p className="text-muted-foreground text-xs">
                              <span className="tabular-nums">
                                {fmt.money(selectedOption.price)}
                              </span>{' '}
                              plan
                              {' + '}
                              <span className="tabular-nums">
                                {fmt.money(selectedOption.setup_fee)}
                              </span>{' '}
                              joining fee — first cycle only.
                            </p>
                          )}
                      </div>
                    )}
                  </>
                )}

                {!isEdit && !isTrial && previewFee > 0 && (
                  <div className="border-border space-y-4 rounded-lg border p-4">
                    <Label htmlFor="mf-collect-payment">
                      <Checkbox
                        id="mf-collect-payment"
                        checked={collectPayment}
                        onCheckedChange={(checked) =>
                          setCollectPayment(checked === true)
                        }
                      />
                      Collect the first payment now
                    </Label>
                    {collectPayment && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="mf-pay-amount">Amount</Label>
                          <Input
                            id="mf-pay-amount"
                            type="number"
                            min={0.01}
                            step="0.01"
                            inputMode="decimal"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            placeholder={
                              previewFee > 0 ? String(previewFee) : '0'
                            }
                          />
                          {previewFee > 0 && (
                            <div className="flex gap-2">
                              {/* Same one-tap splits as RecordPaymentDialog —
                              partial joining payments are routine. */}
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => setPayAmount(String(previewFee))}
                              >
                                Full{' '}
                                <span className="tabular-nums">
                                  {fmt.moneyShort(previewFee)}
                                </span>
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() =>
                                  setPayAmount(
                                    String(
                                      Math.round((previewFee / 2) * 100) / 100
                                    )
                                  )
                                }
                              >
                                Half{' '}
                                <span className="tabular-nums">
                                  {fmt.moneyShort(
                                    Math.round((previewFee / 2) * 100) / 100
                                  )}
                                </span>
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="mf-method">Payment method</Label>
                          <Select
                            value={payMethod}
                            onValueChange={(v) =>
                              setPayMethod(v as PaymentMethod)
                            }
                          >
                            <SelectTrigger id="mf-method" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PAYMENT_METHODS.map((m) => (
                                <SelectItem key={m.value} value={m.value}>
                                  {m.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {previewFee > 0 &&
                          payAmount !== '' &&
                          Number(payAmount) > 0 &&
                          Number(payAmount) < previewFee && (
                            <p className="text-muted-foreground text-xs sm:col-span-2">
                              Remaining due after this payment:{' '}
                              <span className="text-foreground font-medium tabular-nums">
                                {fmt.money(previewFee - Number(payAmount))}
                              </span>
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                )}

                {!isConvert && (
                  <div className="space-y-2">
                    <Label htmlFor="mf-notes">Notes</Label>
                    <Input
                      id="mf-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                )}
              </>
            </div>
          </div>

          <DialogFooter className="border-border m-0 shrink-0">
            {isConvert && (
              <p className="text-muted-foreground mr-auto self-center text-xs">
                Member ID will be assigned automatically
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || checkingDup || !!discountFieldError}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Save' : isConvert ? 'Convert to member' : 'Add member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {isConvert && seedContact?.id && (
        <AvatarEditorDialog
          open={avatarOpen}
          onOpenChange={setAvatarOpen}
          contactId={seedContact.id}
          name={convertName}
          currentUrl={avatarUrl}
          onSaved={() => void refreshConversionAvatar()}
        />
      )}
    </Dialog>
  );
}

function ConversionEditableDetailRow({
  label,
  value,
  displayValue,
  placeholder,
  type = 'text',
  inputMode,
  onSave,
}: {
  label: string;
  value: string;
  displayValue?: string;
  placeholder: string;
  type?: React.HTMLInputTypeAttribute;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  onSave: (value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  function begin() {
    setDraft(value);
    setEditing(true);
  }

  async function confirm() {
    setSaving(true);
    const saved = await onSave(draft);
    setSaving(false);
    if (saved) setEditing(false);
  }

  const shown = displayValue ?? (value.trim() || '—');

  return (
    <div className="grid min-h-11 grid-cols-[72px_1fr] items-center gap-4 px-3">
      <dt className="text-muted-foreground text-xs leading-5">{label}</dt>
      {editing ? (
        <dd className="relative min-w-0">
          <Input
            autoFocus
            type={type}
            inputMode={inputMode}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void confirm();
              } else if (event.key === 'Escape') {
                setEditing(false);
              }
            }}
            placeholder={placeholder}
            disabled={saving}
            className="bg-card border-border text-foreground placeholder:text-muted-foreground h-7 pr-16 text-sm"
          />
          <InlineEditActions
            saving={saving}
            onConfirm={() => void confirm()}
            onDismiss={() => setEditing(false)}
          />
        </dd>
      ) : (
        <dd className="min-w-0">
          <button
            type="button"
            onClick={begin}
            className="group flex w-full min-w-0 items-center gap-2 text-left"
          >
            <span
              className={cn(
                'text-foreground min-w-0 flex-1 truncate text-sm leading-5',
                shown === '—' && 'text-muted-foreground'
              )}
            >
              {shown}
            </span>
            <Pencil className="text-muted-foreground size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        </dd>
      )}
    </div>
  );
}

function measurementHeightDraft(
  heightCm: number | null,
  measurementSystem: string
): string {
  if (!heightCm) return '';
  if (measurementSystem === 'imperial') {
    return String(Math.round((heightCm / 2.54) * 10) / 10);
  }
  return String(heightCm);
}

function measurementWeightDraft(
  weightKg: number | null,
  measurementSystem: string
): string {
  if (!weightKg) return '';
  return String(measurementSystem === 'imperial' ? kgToLb(weightKg) : weightKg);
}

function formatMeasurementHeight(
  heightCm: number | null,
  measurementSystem: string
): string {
  if (!heightCm) return '—';
  if (measurementSystem === 'imperial') {
    const { feet, inches } = cmToFeetInches(heightCm);
    return `${feet}′ ${inches}″`;
  }
  return `${heightCm} cm`;
}

function formatMeasurementWeight(
  weightKg: number | null,
  measurementSystem: string
): string {
  if (!weightKg) return '—';
  return measurementSystem === 'imperial'
    ? `${kgToLb(weightKg)} lb`
    : `${weightKg} kg`;
}
