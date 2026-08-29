'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Camera, ChevronDown, Pencil } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLeadFieldOptions } from '@/hooks/use-lead-field-options';
import {
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import { useLocale } from '@/hooks/use-locale';
import { istAddDays, daysBetween } from '@/lib/memberships/expiry';
import { editedMembershipEndDate } from '@/lib/memberships/edit-cycle';
import { membershipIdForContact } from '@/lib/memberships/lookup';
import { editMembershipCycle } from '@/lib/memberships/periods';
import { cmToFeetInches, feetInchesToCm, kgToLb, lbToKg } from '@/lib/bmi/bmi';
import {
  createMembershipCheckoutDraft,
  quoteMembershipCheckout,
  quoteMembershipCheckoutDraft,
} from '@/lib/memberships/checkout';
import {
  firstCycleFee,
  optionEndDate,
  pricingCadenceLabel,
} from '@/lib/memberships/pricing';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { CheckoutResult, Membership } from '@/types';
import { useMembershipPlans } from './use-membership-plans';
import { PlanOptionPicker, TRIAL_PLAN_VALUE } from './plan-option-picker';
import { MembershipCheckoutPanel } from './membership-checkout-panel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import { UserAvatar } from '@/components/ui/user-avatar';
import { InlineEditActions } from '@/components/ui/inline-edit-actions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AvatarEditorDialog } from './avatar-editor-dialog';

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
    gender?: string | null;
    dateOfBirth?: string | null;
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
  const fieldOptions = useLeadFieldOptions();
  const {
    plans,
    loading: plansLoading,
    refresh: refreshPlans,
  } = useMembershipPlans(true);
  const isEdit = !!member;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
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
  // Mobile-only disclosure; at lg the CSS keeps the lists open regardless.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [checkoutDraft, setCheckoutDraft] = useState(() =>
    createMembershipCheckoutDraft({ startDate: fmt.today() })
  );
  const [checkoutIdempotencyKey, setCheckoutIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );

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
  const isCreate = !isEdit;
  const displayName =
    name.trim() ||
    seedContact?.name?.trim() ||
    (isConvert ? 'This contact' : 'New member');

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

  // Standard paid-membership expiry: the picked billing option drives it; a
  // legacy membership without an option (edit mode, plan unchanged)
  // keeps its CURRENT cycle length — never the plan's frozen
  // duration_days, which mirrors the first option and may not be this
  // member's duration.
  function standardPaidEndDate(): string | null {
    if (isEdit) {
      return editedMembershipEndDate({
        member: member ?? null,
        planId,
        optionId,
        startDate,
        selectedOption,
      });
    }
    return selectedOption ? optionEndDate(startDate, selectedOption) : null;
  }

  // The footer restates what this dialog is about to create. It prices the
  // same draft the checkout panel does, so the two can never disagree.
  const footerQuote =
    isCreate && !isTrial
      ? quoteMembershipCheckoutDraft({
          mode: isConvert ? 'convert' : 'join',
          option: selectedOption,
          draft: checkoutDraft,
        })
      : null;

  function updateCheckoutDraft(next: typeof checkoutDraft) {
    setCheckoutDraft(next);
    setStartDate(next.startDate);
    if (next.planId === TRIAL_PLAN_VALUE) {
      setIsTrial(true);
      setPlanId('');
      setOptionId(null);
      return;
    }
    setIsTrial(false);
    setPlanId(next.planId);
    setOptionId(next.optionId);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      // Edit mode reads the membership's contact; add mode falls back to
      // the optional seed (lead → member conversion), else blank.
      setName(member?.contact?.name ?? seedContact?.name ?? '');
      setPhone(member?.contact?.phone ?? seedContact?.phone ?? '');
      setEmail(member?.contact?.email ?? seedContact?.email ?? '');
      setGender(member?.contact?.gender ?? seedContact?.gender ?? '');
      setDateOfBirth(
        member?.contact?.date_of_birth ?? seedContact?.dateOfBirth ?? ''
      );
      setPlanId(member?.plan_id ?? '');
      setOptionId(member?.pricing_option_id ?? null);
      setStartDate(member?.start_date ?? fmt.today());
      setFeeAmount(member ? String(member.fee_amount) : '');
      // An existing fee is authoritative — never auto-reseed it from a plan
      // switch in edit mode; add mode follows the plan until the user types.
      setFeeTouched(!!member);
      setNotes(member?.notes ?? '');
      setAvatarUrl(
        member?.contact?.avatar_url ?? seedContact?.avatarUrl ?? null
      );
      setAvatarOpen(false);
      setHeightCm(member?.contact?.height_cm ?? seedContact?.heightCm ?? null);
      setWeightKg(member?.contact?.weight_kg ?? seedContact?.weightKg ?? null);
      setCheckoutDraft(
        createMembershipCheckoutDraft({
          planId: member?.is_trial ? TRIAL_PLAN_VALUE : member?.plan_id,
          optionId: member?.pricing_option_id,
          startDate: member?.start_date ?? fmt.today(),
        })
      );
      setCheckoutIdempotencyKey(crypto.randomUUID());
      setDupMatch(null);
      setIsTrial(member?.is_trial ?? false);
      // Seed trial length from the existing trial's span, else a 7-day default.
      const td = member?.is_trial
        ? daysBetween(member.start_date, member.end_date)
        : NaN;
      setTrialDays(Number.isFinite(td) && td > 0 ? String(td) : '7');
    })();
    return () => {
      cancelled = true;
    };
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
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) setFeeAmount(String(firstCycleFee(selectedOption)));
    })();
    return () => {
      cancelled = true;
    };
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

  async function checkDuplicate(rawPhone = phone) {
    if (isEdit || !accountId) return;
    const value = rawPhone.trim();
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

  async function savePersonalField(
    column: 'name' | 'phone' | 'email',
    rawValue: string
  ): Promise<boolean> {
    const value = rawValue.trim();
    if (column === 'phone' && !value) {
      toast.error('Phone number is required');
      return false;
    }
    if (column === 'email' && value && !EMAIL_RE.test(value)) {
      toast.error('Enter a valid email address');
      return false;
    }

    // A not-yet-created member has no contact row to update. Keep the same
    // click-to-edit interaction as lead conversion, but commit into the form
    // draft until submit creates (or attaches) the contact.
    if (!seedContact?.id) {
      if (column === 'name') setName(value);
      if (column === 'phone') {
        setPhone(value);
        await checkDuplicate(value);
      }
      if (column === 'email') setEmail(value);
      return true;
    }
    if (!accountId) return false;

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

  async function savePersonalMeasurement(
    column: 'height_cm' | 'weight_kg',
    value: number | null
  ): Promise<boolean> {
    if (!seedContact?.id) {
      if (column === 'height_cm') setHeightCm(value);
      if (column === 'weight_kg') setWeightKg(value);
      return true;
    }
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

  async function savePersonalProfileField(
    column: 'gender' | 'date_of_birth',
    value: string
  ): Promise<boolean> {
    if (column === 'date_of_birth' && value && value > fmt.today()) {
      toast.error('Birthday cannot be in the future');
      return false;
    }
    if (!seedContact?.id) {
      if (column === 'gender') setGender(value);
      if (column === 'date_of_birth') setDateOfBirth(value);
      return true;
    }
    try {
      const { data, error } = await supabase
        .from('contacts')
        .update({ [column]: value || null })
        .eq('id', seedContact.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        throw new Error("You don't have permission to update this contact.");
      }
      if (column === 'gender') setGender(value);
      if (column === 'date_of_birth') setDateOfBirth(value);
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update personal details'));
      return false;
    }
  }

  async function saveDisplayedHeight(rawValue: string): Promise<boolean> {
    if (!rawValue.trim()) {
      return savePersonalMeasurement('height_cm', null);
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
    return savePersonalMeasurement('height_cm', canonical);
  }

  async function saveDisplayedWeight(rawValue: string): Promise<boolean> {
    if (!rawValue.trim()) {
      return savePersonalMeasurement('weight_kg', null);
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
    return savePersonalMeasurement('weight_kg', canonical);
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
    const endForPaid = standardPaidEndDate();
    if (!isTrial && !selectedOption && isCreate) {
      return toast.error('Pick a billing option for this plan');
    }
    if (!isTrial && !endForPaid && isEdit) {
      return toast.error('Pick a billing option for this plan');
    }

    let checkoutQuote = null;
    if (isCreate && !isTrial && selectedOption) {
      try {
        checkoutQuote = quoteMembershipCheckout({
          mode: isConvert ? 'convert' : 'join',
          option: selectedOption,
          startDate: checkoutDraft.startDate,
          discountKind: checkoutDraft.discountKind,
          discountValue: checkoutDraft.discountValue,
          bonusMonthsEnabled: checkoutDraft.bonusMonthsEnabled,
          bonusMonths: checkoutDraft.bonusMonths,
          selections: checkoutDraft.includeProductsServices
            ? checkoutDraft.selections
            : [],
        });
      } catch (error) {
        return toast.error(getErrorMessage(error, 'Invalid checkout details'));
      }
    }

    // Edit mode remains a correction workflow and keeps its explicit fee.
    // Create mode sends only intent to the authoritative checkout RPC.
    const fee = isTrial
      ? 0
      : feeAmount === ''
        ? selectedOption
          ? firstCycleFee(selectedOption)
          : Number(member?.fee_amount ?? 0)
        : Number(feeAmount);
    if ((!isCreate || isTrial) && (!Number.isFinite(fee) || fee < 0))
      return toast.error('Enter a valid fee');

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
        const patch: Record<string, string | number | null> = {};
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
          const patch: Record<string, string | number | null> = {};
          if (name.trim() && name.trim() !== (existing.name ?? ''))
            patch.name = name.trim();
          if (
            email.trim() &&
            email.trim() !== ((existing.email as string | null) ?? '')
          )
            patch.email = email.trim();
          if (phone.trim() && phone.trim() !== existing.phone)
            patch.phone = phone.trim();
          if (gender) patch.gender = gender;
          if (dateOfBirth) patch.date_of_birth = dateOfBirth;
          if (heightCm !== null) patch.height_cm = heightCm;
          if (weightKg !== null) patch.weight_kg = weightKg;
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
              gender: gender || null,
              date_of_birth: dateOfBirth || null,
              height_cm: heightCm,
              weight_kg: weightKg,
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

      if (!isTrial) {
        const response = await fetch('/api/member-checkouts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: isConvert ? 'convert' : 'join',
            contact_id: contactId,
            membership: {
              plan_id: checkoutDraft.planId,
              pricing_option_id: checkoutDraft.optionId,
              period_start: checkoutDraft.startDate,
              discount_type: checkoutDraft.discountKind,
              discount_value: checkoutDraft.discountKind
                ? Number(checkoutDraft.discountValue)
                : null,
              bonus_months: checkoutDraft.bonusMonthsEnabled
                ? Number(checkoutDraft.bonusMonths)
                : 0,
            },
            selections: checkoutDraft.includeProductsServices
              ? checkoutDraft.selections
              : [],
            collection: {
              collect_now:
                !!checkoutQuote &&
                checkoutQuote.cashDue > 0 &&
                checkoutDraft.collectNow,
              timing:
                checkoutQuote?.installmentsAvailable === false
                  ? 'full'
                  : checkoutDraft.collectionTiming,
              method: checkoutDraft.paymentMethod,
              paid_at: new Date().toISOString(),
            },
            idempotency_key: checkoutIdempotencyKey,
          }),
        });
        const result = (await response.json()) as CheckoutResult & {
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || 'Checkout failed');

        toast.success(
          isConvert
            ? `Converted to member · Member ID ${result.member_number}`
            : `Member added · Member ID ${result.member_number}`,
          {
            action: onViewExisting
              ? { label: 'View', onClick: () => onViewExisting(contactId) }
              : undefined,
          }
        );
        onOpenChange(false);
        onSaved();
        return;
      }

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
          isCreate &&
            'max-h-[min(96vh,900px)] sm:max-w-[min(1080px,calc(100vw-2rem))]'
        )}
      >
        <DialogHeader className="border-border shrink-0 border-b p-5">
          <DialogTitle size={isCreate ? 'lg' : 'default'}>
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
              isCreate
                ? 'grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:overflow-hidden'
                : 'px-4 py-2'
            )}
          >
            {isCreate && (
              <aside className="border-border border-b p-5 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
                <div className="flex items-center gap-4">
                  {seedContact?.id ? (
                    <button
                      type="button"
                      onClick={() => setAvatarOpen(true)}
                      aria-label="Change profile picture"
                      className="group/avatar-edit relative shrink-0 rounded-full"
                    >
                      <UserAvatar
                        size="lg"
                        name={displayName}
                        src={avatarUrl}
                      />
                      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar-edit:opacity-100 group-focus-visible/avatar-edit:opacity-100">
                        <Camera className="size-4" />
                      </span>
                    </button>
                  ) : (
                    <UserAvatar size="lg" name={displayName} />
                  )}
                  <div className="min-w-0">
                    <p className="text-foreground truncate font-medium">
                      {displayName}
                    </p>
                    {!name.trim() && !seedContact?.name?.trim() ? (
                      <p className="text-muted-foreground truncate text-sm">
                        {phone.trim()
                          ? fmt.phone(phone)
                          : 'Add contact details below'}
                      </p>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setDetailsOpen((open) => !open)}
                  aria-expanded={detailsOpen}
                  aria-controls="mf-lead-details"
                  className="text-muted-foreground hover:text-foreground mt-6 flex w-full items-center justify-between gap-2 text-xs font-medium transition-colors lg:hidden"
                >
                  Details
                  <ChevronDown
                    className={cn(
                      'size-4 transition-transform',
                      detailsOpen && 'rotate-180'
                    )}
                  />
                </button>

                <div
                  id="mf-lead-details"
                  className={cn(
                    'mt-4 lg:mt-6 lg:block',
                    !detailsOpen && 'hidden'
                  )}
                >
                  <div>
                    <p className="text-muted-foreground mb-2 text-xs font-medium">
                      Personal information
                    </p>
                    <dl className="divide-border divide-y">
                      <ConversionEditableDetailRow
                        label="Name"
                        value={name}
                        placeholder="Add name"
                        onSave={(value) => savePersonalField('name', value)}
                      />
                      <ConversionEditableDetailRow
                        label="Phone"
                        type="tel"
                        value={phone}
                        displayValue={
                          phone.trim() ? fmt.phone(phone) : undefined
                        }
                        placeholder="Add phone"
                        onSave={(value) => savePersonalField('phone', value)}
                      />
                      <ConversionEditableDetailRow
                        label="Email"
                        value={email}
                        type="email"
                        placeholder="Add email"
                        onSave={(value) => savePersonalField('email', value)}
                      />
                      <ConversionDateDetailRow
                        label="Birthday"
                        value={dateOfBirth}
                        displayValue={dateOfBirth ? fmt.date(dateOfBirth) : '—'}
                        max={fmt.today()}
                        onSave={(value) =>
                          savePersonalProfileField('date_of_birth', value)
                        }
                      />
                      <ConversionSelectDetailRow
                        label="Gender"
                        value={gender}
                        displayValue={
                          gender ? fieldOptions.genderLabel(gender) : '—'
                        }
                        placeholder="Not specified"
                        options={fieldOptions.genders.map((option) => ({
                          value: option.key,
                          label: option.label,
                        }))}
                        onSave={(value) =>
                          savePersonalProfileField('gender', value)
                        }
                      />
                    </dl>
                    {!isConvert && dupMatch && (
                      <div className="text-amber-foreground mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <div className="space-y-1">
                          <p>
                            {dupMatch.isMember
                              ? `${dupMatch.contact.name || 'This person'} already has a membership — open their profile to renew or edit it.`
                              : dupMatch.exact
                                ? `This number already belongs to ${dupMatch.contact.name || 'an existing contact'}. No duplicate is created — the membership attaches to that record, and details added here update it.`
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
                              {dupMatch.contact.name ||
                                fmt.phone(dupMatch.contact.phone)}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-border mt-5 border-t pt-4">
                    <p className="text-muted-foreground mb-2 text-xs font-medium">
                      Body measurements
                    </p>
                    <dl className="divide-border divide-y">
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
                </div>
              </aside>
            )}

            <div
              className={cn(
                'min-w-0 space-y-4',
                isCreate &&
                  'space-y-6 px-5 py-5 sm:px-6 lg:min-h-0 lg:overflow-y-auto'
              )}
            >
              {isEdit && (
                <>
                  {/* Edit mode keeps the compact correction form; creation
                      owns the split personal-information rail above. */}
                  <div className="space-y-2">
                    <Label htmlFor="mf-phone">
                      Phone <span className="text-red-foreground">*</span>
                    </Label>
                    <PhoneInput
                      id="mf-phone"
                      autoFocus={!isEdit}
                      value={phone}
                      onValueChange={(value) => {
                        setPhone(value);
                        if (dupMatch) setDupMatch(null);
                      }}
                      onBlur={() => void checkDuplicate()}
                      placeholder="98765 43210"
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
                              {dupMatch.contact.name ||
                                fmt.phone(dupMatch.contact.phone)}
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

              {isCreate ? (
                <>
                  <MembershipCheckoutPanel
                    idPrefix="mf"
                    mode={isConvert ? 'convert' : 'join'}
                    plans={plans}
                    plansLoading={plansLoading}
                    value={checkoutDraft}
                    onChange={updateCheckoutDraft}
                    allowTrial
                    startDateEditable
                    showExpirySummary={false}
                  />
                  {isTrial && (
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
                        {fmt.date(
                          istAddDays(startDate, Number(trialDays) || 0)
                        )}{' '}
                        · free pass, no fee — convert to a paid plan later.
                      </p>
                    </div>
                  )}
                </>
              ) : (
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
                        onChange={(selection) => {
                          if (selection.planId === TRIAL_PLAN_VALUE) {
                            setIsTrial(true);
                            setPlanId('');
                            setOptionId(null);
                          } else {
                            setIsTrial(false);
                            setPlanId(selection.planId);
                            setOptionId(selection.optionId);
                          }
                        }}
                      />
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
                        onChange={(event) => setTrialDays(event.target.value)}
                      />
                      <p className="text-muted-foreground text-xs">
                        Ends{' '}
                        {fmt.date(
                          istAddDays(startDate, Number(trialDays) || 0)
                        )}{' '}
                        · free pass, no fee — convert to a paid plan later.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="mf-fee">Fee for this period</Label>
                      <Input
                        id="mf-fee"
                        type="number"
                        min={0}
                        value={feeAmount}
                        onChange={(event) => {
                          setFeeAmount(event.target.value);
                          setFeeTouched(true);
                        }}
                        placeholder={
                          selectedOption
                            ? String(firstCycleFee(selectedOption))
                            : '0'
                        }
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="mf-notes">Notes</Label>
                    <Input
                      id="mf-notes"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <DialogFooter className="border-border m-0 shrink-0">
            {isCreate && (
              <div className="mr-auto min-w-0 space-y-0.5 self-center max-sm:order-1">
                {isTrial ? (
                  <>
                    <p className="text-foreground truncate text-sm font-medium">
                      Trial · free pass
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {fmt.date(startDate)} –{' '}
                      {fmt.date(istAddDays(startDate, Number(trialDays) || 0))}{' '}
                      · {trialDays || '0'}-day trial · No fee
                    </p>
                  </>
                ) : footerQuote && selectedPlan && selectedOption ? (
                  <>
                    <p className="text-foreground truncate text-sm font-medium">
                      {selectedPlan.name}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {fmt.date(checkoutDraft.startDate)} –{' '}
                      {fmt.date(footerQuote.periodEnd)} ·{' '}
                      {pricingCadenceLabel(selectedPlan, selectedOption)} ·{' '}
                      <span className="tabular-nums">
                        {fmt.money(footerQuote.membershipFee)}
                      </span>
                    </p>
                  </>
                ) : null}
              </div>
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
              disabled={saving || checkingDup}
              loading={saving}
            >
              {isEdit ? 'Save' : isConvert ? 'Convert to member' : 'Add member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {isCreate && seedContact?.id && (
        <AvatarEditorDialog
          open={avatarOpen}
          onOpenChange={setAvatarOpen}
          contactId={seedContact.id}
          name={displayName}
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
    <div
      className={cn(
        'grid min-h-11 grid-cols-[64px_minmax(0,1fr)] items-center gap-3',
        editing && 'py-2'
      )}
    >
      <dt className="text-muted-foreground text-xs leading-5">{label}</dt>
      {editing ? (
        <dd className="grid min-w-0 grid-cols-[minmax(0,1fr)_4rem] items-center gap-2">
          {type === 'tel' ? (
            <PhoneInput
              autoFocus
              value={draft}
              onValueChange={setDraft}
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
              className="bg-card border-border text-foreground placeholder:text-muted-foreground h-7 text-sm"
            />
          ) : (
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
              className="bg-card border-border text-foreground placeholder:text-muted-foreground h-7 text-sm"
            />
          )}
          <span className="relative h-7">
            <InlineEditActions
              saving={saving}
              onConfirm={() => void confirm()}
              onDismiss={() => setEditing(false)}
            />
          </span>
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

function ConversionDateDetailRow({
  label,
  value,
  displayValue,
  max,
  onSave,
}: {
  label: string;
  value: string;
  displayValue: string;
  max?: string;
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

  return (
    <div
      className={cn(
        'grid min-h-11 grid-cols-[64px_minmax(0,1fr)] items-center gap-3',
        editing && 'py-2'
      )}
    >
      <dt className="text-muted-foreground text-xs leading-5">{label}</dt>
      {editing ? (
        <dd className="grid min-w-0 grid-cols-[minmax(0,1fr)_4rem] items-center gap-2">
          <DatePicker
            value={draft}
            onChange={setDraft}
            max={max}
            disabled={saving}
            aria-label={label}
          />
          <span className="relative h-8">
            <InlineEditActions
              saving={saving}
              onConfirm={() => void confirm()}
              onDismiss={() => setEditing(false)}
            />
          </span>
        </dd>
      ) : (
        <ConversionDetailValue value={displayValue} onClick={begin} />
      )}
    </div>
  );
}

function ConversionSelectDetailRow({
  label,
  value,
  displayValue,
  placeholder,
  options,
  onSave,
}: {
  label: string;
  value: string;
  displayValue: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onSave: (value: string) => Promise<boolean>;
}) {
  const emptyValue = '__not_specified__';
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

  return (
    <div
      className={cn(
        'grid min-h-11 grid-cols-[64px_minmax(0,1fr)] items-center gap-3',
        editing && 'py-2'
      )}
    >
      <dt className="text-muted-foreground text-xs leading-5">{label}</dt>
      {editing ? (
        <dd className="grid min-w-0 grid-cols-[minmax(0,1fr)_4rem] items-center gap-2">
          <Select
            value={draft || emptyValue}
            onValueChange={(next) =>
              setDraft(next === emptyValue ? '' : (next ?? ''))
            }
            disabled={saving}
          >
            <SelectTrigger className="w-full" aria-label={label}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={emptyValue}>{placeholder}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="relative h-8">
            <InlineEditActions
              saving={saving}
              onConfirm={() => void confirm()}
              onDismiss={() => setEditing(false)}
            />
          </span>
        </dd>
      ) : (
        <ConversionDetailValue value={displayValue} onClick={begin} />
      )}
    </div>
  );
}

function ConversionDetailValue({
  value,
  onClick,
}: {
  value: string;
  onClick: () => void;
}) {
  return (
    <dd className="min-w-0">
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full min-w-0 items-center gap-2 text-left"
      >
        <span
          className={cn(
            'text-foreground min-w-0 flex-1 truncate text-sm leading-5',
            value === '—' && 'text-muted-foreground'
          )}
        >
          {value}
        </span>
        <Pencil className="text-muted-foreground size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </dd>
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
