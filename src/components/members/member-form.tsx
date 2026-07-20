"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Info } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
  type ExistingContact,
} from "@/lib/contacts/dedupe";
import { useLocale } from "@/hooks/use-locale";
import { istAddDays, daysBetween } from "@/lib/memberships/expiry";
import { membershipIdForContact } from "@/lib/memberships/lookup";
import { editMembershipCycle } from "@/lib/memberships/periods";
import {
  durationLabel,
  firstCycleFee,
  optionEndDate,
} from "@/lib/memberships/pricing";
import type { Membership, PaymentMethod } from "@/types";
import { useMembershipPlans } from "./use-membership-plans";
import { PlanOptionPicker, TRIAL_PLAN_VALUE } from "./plan-option-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

interface MemberFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode — a membership row with its contact hydrated. */
  member?: Membership | null;
  /**
   * Add-mode prefill — seeds name/phone/email from an existing contact
   * (e.g. converting a lead to a member). Submit still find-or-creates
   * by phone, so the existing contact is reused, not duplicated.
   */
  seedContact?: { name?: string | null; phone?: string | null; email?: string | null } | null;
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
  const { plans, loading: plansLoading, refresh: refreshPlans } = useMembershipPlans(true);
  const isEdit = !!member;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [planId, setPlanId] = useState("");
  const [optionId, setOptionId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(fmt.today());
  const [feeAmount, setFeeAmount] = useState("");
  // Tracks whether the user typed the fee themselves. Until they do, the
  // fee follows the selected plan's price — so switching plans can't
  // leave a stale price from the previous pick.
  const [feeTouched, setFeeTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // First-payment capture (add mode only). Defaults ON — a walk-in pays
  // at signup; staff untick for the exception, not the rule. Amount
  // defaults to the full fee but accepts a partial joining payment.
  const [collectPayment, setCollectPayment] = useState(true);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payAmount, setPayAmount] = useState("");

  // Trial / lead: a free pass with its own length instead of a plan's
  // duration. Plan optional, no fee, no payment. Convert-to-member
  // happens later from the Trials list.
  const [isTrial, setIsTrial] = useState(false);
  const [trialDays, setTrialDays] = useState("7");

  // A phone that already belongs to a contact. `isMember` splits the two
  // outcomes: a plain contact gets the membership attached (fine), an
  // existing member is a dead end (UNIQUE(account_id, contact_id)).
  const [dupMatch, setDupMatch] = useState<
    { contact: ExistingContact; exact: boolean; isMember: boolean } | null
  >(null);
  const [checkingDup, setCheckingDup] = useState(false);

  // Converting a known lead (the lead sheet's "Convert to member" seeds the
  // form). The contact is expected to exist, so the dedupe warning would be
  // telling staff what they just asked for — they get a plain info line
  // instead. Editing the phone away from the seed drops back to the normal
  // add-mode dedupe path.
  const isConvert =
    !isEdit &&
    !!seedContact?.phone &&
    !!phone.trim() &&
    normalizeKey(phone) === normalizeKey(seedContact.phone);
  const convertName = (name.trim() || seedContact?.name?.trim() || "This contact");

  const selectedPlan = plans.find((p) => p.id === planId);
  // An ARCHIVED option still resolves when it's the membership's own
  // (edit mode) — otherwise a routine edit of a member whose option was
  // retired would fall back to the plan's frozen legacy duration and
  // silently rewrite their cycle length. New picks stay active-only.
  const selectedOption =
    selectedPlan?.pricing_options?.find(
      (o) =>
        o.id === optionId &&
        (o.is_active || (isEdit && o.id === member?.pricing_option_id)),
    ) ?? null;
  // The fee the first payment settles against, mirroring submit's
  // fallback: blank fee field = the option's first-cycle fee (price +
  // one-time joining fee, migration 062).
  const previewFee =
    feeAmount === ""
      ? selectedOption
        ? firstCycleFee(selectedOption)
        : 0
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
    setName(member?.contact?.name ?? seedContact?.name ?? "");
    setPhone(member?.contact?.phone ?? seedContact?.phone ?? "");
    setEmail(member?.contact?.email ?? seedContact?.email ?? "");
    setPlanId(member?.plan_id ?? "");
    setOptionId(member?.pricing_option_id ?? null);
    setStartDate(member?.start_date ?? fmt.today());
    setFeeAmount(member ? String(member.fee_amount) : "");
    // An existing fee is authoritative — never auto-reseed it from a plan
    // switch in edit mode; add mode follows the plan until the user types.
    setFeeTouched(!!member);
    setNotes(member?.notes ?? "");
    setCollectPayment(!member);
    setPayMethod("cash");
    setPayAmount("");
    setDupMatch(null);
    setIsTrial(member?.is_trial ?? false);
    // Seed trial length from the existing trial's span, else a 7-day default.
    const td = member?.is_trial
      ? daysBetween(member.start_date, member.end_date)
      : NaN;
    setTrialDays(Number.isFinite(td) && td > 0 ? String(td) : "7");
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
    window.addEventListener("focus", refreshPlans);
    return () => window.removeEventListener("focus", refreshPlans);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return toast.error("Phone number is required");
    if (!accountId || !user) return toast.error("Your profile is not linked to an account.");
    // Known-member dedupe hit: the membership insert would fail on
    // UNIQUE(account_id, contact_id) anyway — send staff to the member
    // instead of letting them fill out a form that can't save.
    if (dupMatch?.isMember) {
      toast.error("This person is already a member.");
      onOpenChange(false);
      onViewExisting?.(dupMatch.contact.id);
      return;
    }

    const trialLen = Number(trialDays);
    if (isTrial) {
      if (!Number.isFinite(trialLen) || trialLen <= 0)
        return toast.error("Enter a valid trial length in days");
    } else if (!planId) {
      return toast.error("Pick a membership plan (or Trial / free pass)");
    }

    // Plan + billing option are required for a paid member; a legacy
    // edit (no option on the row) may proceed on the plan's frozen days.
    const plan = plans.find((p) => p.id === planId);
    if (!isTrial && !plan) return toast.error("Selected plan is unavailable");
    const endForPaid = paidEndDate();
    if (!isTrial && !endForPaid) {
      return toast.error("Pick a billing option for this plan");
    }

    // Trials are free; a paid member's fee seeds from the option's
    // first-cycle fee (price + one-time joining fee).
    // No-option (legacy edit) rows fall back to the membership's own fee,
    // not the plan's frozen price (which mirrors the first option only).
    const fee = isTrial
      ? 0
      : feeAmount === ""
        ? selectedOption
          ? firstCycleFee(selectedOption)
          : Number(member?.fee_amount ?? 0)
        : Number(feeAmount);
    if (!Number.isFinite(fee) || fee < 0) return toast.error("Enter a valid fee");

    // First payment: blank = the full fee; a typed amount may be a
    // partial joining payment but can't exceed the fee.
    const collecting = collectPayment && !isTrial && fee > 0;
    const payAmt = payAmount === "" ? fee : Number(payAmount);
    if (collecting) {
      if (!Number.isFinite(payAmt) || payAmt <= 0)
        return toast.error("Enter a valid payment amount");
      if (payAmt > fee)
        return toast.error("The payment cannot exceed the fee");
    }

    setSaving(true);
    try {
      // ---- EDIT: update contact + membership in place ----
      if (isEdit && member) {
        const endDate = isTrial ? istAddDays(startDate, trialLen) : endForPaid!;
        const { error: cErr } = await supabase
          .from("contacts")
          .update({
            name: name.trim() || null,
            phone: phone.trim(),
            email: email.trim() || null,
          })
          .eq("id", member.contact_id);
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

        toast.success("Member updated");
        onOpenChange(false);
        onSaved();
        return;
      }

      // ---- ADD: find-or-create contact, then create membership ----
      let contactId: string;
      const existing = await findExistingContact(supabase, accountId, phone.trim());
      if (existing) {
        contactId = existing.id;
        // The form's fields are authoritative over the existing record —
        // staff correcting a lead's name/email on the way in expects it to
        // stick (it used to be silently dropped). Only non-empty values are
        // written, so a blank field can't wipe what the contact already has.
        const patch: Record<string, string> = {};
        if (name.trim() && name.trim() !== (existing.name ?? "")) patch.name = name.trim();
        if (email.trim() && email.trim() !== ((existing.email as string | null) ?? ""))
          patch.email = email.trim();
        if (phone.trim() && phone.trim() !== existing.phone) patch.phone = phone.trim();
        if (Object.keys(patch).length) {
          // Silent-RLS rule: a blocked update returns no error and no rows.
          const { data: updated, error: uErr } = await supabase
            .from("contacts")
            .update(patch)
            .eq("id", contactId)
            .select("id");
          if (uErr) throw uErr;
          if (!updated?.length) throw new Error("You do not have access to update this contact.");
        }
      } else {
        const { data, error } = await supabase
          .from("contacts")
          .insert({
            user_id: user.id,
            account_id: accountId,
            name: name.trim() || null,
            phone: phone.trim(),
            email: email.trim() || null,
            // Origin (migration 048): a human added this record in the UI.
            received_via: "manual" as const,
          })
          .select("id")
          .single();
        if (error) throw error;
        contactId = data.id;
      }

      const endDate = isTrial ? istAddDays(startDate, trialLen) : endForPaid!;
      const { data: mRow, error: mErr } = await supabase
        .from("memberships")
        .insert({
          account_id: accountId,
          contact_id: contactId,
          user_id: user.id,
          plan_id: isTrial ? planId || null : planId,
          pricing_option_id: isTrial ? null : optionId,
          start_date: startDate,
          end_date: endDate,
          status: "active",
          fee_amount: fee,
          is_trial: isTrial,
          notes: notes.trim() || null,
        })
        .select("id, member_number")
        .single();

      if (mErr) {
        // UNIQUE(account_id, contact_id): this contact is already a member.
        if (isUniqueViolation(mErr)) {
          toast.error("This person is already a member.");
          onOpenChange(false);
          onViewExisting?.(contactId);
          return;
        }
        throw mErr;
      }

      // Optional first payment (never for a free trial).
      if (collecting) {
        const { error: pErr } = await supabase.rpc("record_membership_payment", {
          p_membership_id: mRow.id,
          p_period_end: endDate,
          p_amount: payAmt,
          p_method: payMethod,
          p_paid_at: new Date().toISOString(),
          p_note: "",
          p_receipt_path: null,
          p_idempotency_key: crypto.randomUUID(),
        });
        if (pErr) {
          // The membership is saved; a payment hiccup shouldn't block it.
          toast.warning("Member created, but the payment couldn't be recorded.");
          onOpenChange(false);
          onSaved();
          return;
        }
      }

      toast.success(
        isTrial
          ? `Trial added · Member ID ${mRow.member_number}`
          : `Member added · Member ID ${mRow.member_number}`,
        {
          // One tap to the new member's sheet (photo, auto-pay, notes).
          action: onViewExisting
            ? { label: "View", onClick: () => onViewExisting(contactId) }
            : undefined,
        }
      );
      onOpenChange(false);
      onSaved();
    } catch (err) {
      if (isUniqueViolation(err)) {
        toast.error("A contact with this phone number already exists.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Failed to save member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 p-4 pb-2">
          <DialogTitle>
            {isEdit ? "Edit member" : isConvert ? "Convert to member" : "Add member"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this member's details."
              : isConvert
                ? "Start a membership for this contact."
                : "Add a member and start their membership."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-2">
            {/* Phone leads: it's the identity key — the dedupe check fires
                off it, so an existing member surfaces before staff types
                out the rest of the form. */}
            <div className="space-y-2">
              <Label htmlFor="mf-phone" className="text-muted-foreground">
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
                    : "+91 98765 43210"
                }
              />
              {isConvert ? (
                /* Convert-from-lead: the contact existing is the whole point,
                   so this states what happens next, not a hazard. */
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  <p>
                    {convertName} will be converted to a member. Pick a membership
                    plan below to start their membership — any details you change
                    here update their existing record.
                  </p>
                </div>
              ) : dupMatch ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <div className="space-y-1">
                    <p>
                      {dupMatch.isMember
                        ? `${dupMatch.contact.name || "This person"} already has a membership — open their profile to renew or edit it.`
                        : dupMatch.exact
                          ? `This number already belongs to ${dupMatch.contact.name || "an existing contact"}. No duplicate is created — the membership attaches to that record, and any details you change here update it.`
                          : "A contact with a very similar number already exists."}
                    </p>
                    {onViewExisting && (
                      <button
                        type="button"
                        onClick={() => onViewExisting(dupMatch.contact.id)}
                        className="font-medium underline underline-offset-2 hover:no-underline"
                      >
                        View {dupMatch.contact.name || dupMatch.contact.phone}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Include country code
                  {locale.phoneCountryCode
                    ? `, e.g. ${locale.phoneCountryCode}`
                    : ", e.g. +91"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="mf-name" className="text-muted-foreground">Name</Label>
              <Input
                id="mf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mf-email" className="text-muted-foreground">Email</Label>
              <Input
                id="mf-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="member@example.com"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
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
                    setPlanId("");
                    setOptionId(null);
                  } else {
                    setIsTrial(false);
                    setPlanId(sel.planId);
                    setOptionId(sel.optionId);
                  }
                }}
                footer={
                  !plansLoading && plans.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No plans yet —{" "}
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

              <div className="space-y-2">
                <Label htmlFor="mf-start" className="text-muted-foreground">Start date</Label>
                <DatePicker
                  id="mf-start"
                  value={startDate}
                  onChange={setStartDate}
                />
              </div>
            </div>

            {isTrial ? (
              <div className="space-y-2">
                <Label htmlFor="mf-trial-days" className="text-muted-foreground">
                  Trial length (days)
                </Label>
                <Input
                  id="mf-trial-days"
                  type="number"
                  min={1}
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Ends {fmt.date(istAddDays(startDate, Number(trialDays) || 0))} · free pass, no fee — convert to a paid plan later.
                </p>
              </div>
            ) : (
              <>
                {selectedPlan && paidEndDate() && (
                  <p className="text-xs text-muted-foreground">
                    Expires {fmt.date(paidEndDate()!)}
                    {selectedOption &&
                      ` (${durationLabel(selectedOption.duration_count, selectedOption.duration_unit)})`}
                    .
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="mf-fee" className="text-muted-foreground">Fee for this period</Label>
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
                      selectedOption ? String(firstCycleFee(selectedOption)) : "0"
                    }
                  />
                  {!isEdit && selectedOption && selectedOption.setup_fee > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="tabular-nums">{fmt.money(selectedOption.price)}</span> plan
                      {" + "}
                      <span className="tabular-nums">{fmt.money(selectedOption.setup_fee)}</span>{" "}
                      joining fee — first cycle only.
                    </p>
                  )}
                </div>
              </>
            )}

            {!isEdit && !isTrial && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={collectPayment}
                    onChange={(e) => setCollectPayment(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  Collect the first payment now
                </label>
                {collectPayment && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="mf-pay-amount" className="text-muted-foreground text-xs">
                        Amount
                      </Label>
                      <Input
                        id="mf-pay-amount"
                        type="number"
                        min={0.01}
                        step="0.01"
                        inputMode="decimal"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        placeholder={previewFee > 0 ? String(previewFee) : "0"}
                        className="h-8"
                      />
                      {previewFee > 0 && (
                        <div className="flex gap-1.5">
                          {/* Same one-tap splits as RecordPaymentDialog —
                              partial joining payments are routine. */}
                          <button
                            type="button"
                            onClick={() => setPayAmount(String(previewFee))}
                            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors"
                          >
                            Full {fmt.moneyShort(previewFee)}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayAmount(String(Math.round((previewFee / 2) * 100) / 100))}
                            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors"
                          >
                            Half {fmt.moneyShort(Math.round((previewFee / 2) * 100) / 100)}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mf-method" className="text-muted-foreground text-xs">
                        Payment method
                      </Label>
                      <Select
                        value={payMethod}
                        onValueChange={(v) => setPayMethod(v as PaymentMethod)}
                      >
                        <SelectTrigger id="mf-method" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {previewFee > 0 &&
                      payAmount !== "" &&
                      Number(payAmount) > 0 &&
                      Number(payAmount) < previewFee && (
                        <p className="text-muted-foreground text-xs sm:col-span-2">
                          Remaining due after this payment:{" "}
                          <span className="text-foreground font-medium tabular-nums">
                            {fmt.money(previewFee - Number(payAmount))}
                          </span>
                        </p>
                      )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="mf-notes" className="text-muted-foreground">Notes</Label>
              <Input
                id="mf-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <DialogFooter className="m-0 shrink-0 border-border">
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
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save" : isConvert ? "Convert to member" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
