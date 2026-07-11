"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  type ExistingContact,
} from "@/lib/contacts/dedupe";
import { useLocale } from "@/hooks/use-locale";
import { istAddDays, daysBetween } from "@/lib/memberships/expiry";
import type { Membership, PaymentMethod } from "@/types";
import { useMembershipPlans } from "./use-membership-plans";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const { plans } = useMembershipPlans(true);
  const isEdit = !!member;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState(fmt.today());
  const [feeAmount, setFeeAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // First-payment capture (add mode only).
  const [collectPayment, setCollectPayment] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");

  // Trial / lead: a free pass with its own length instead of a plan's
  // duration. Plan optional, no fee, no payment. Convert-to-member
  // happens later from the Trials list.
  const [isTrial, setIsTrial] = useState(false);
  const [trialDays, setTrialDays] = useState("7");

  const [dupMatch, setDupMatch] = useState<
    { contact: ExistingContact; exact: boolean } | null
  >(null);
  const [checkingDup, setCheckingDup] = useState(false);

  const selectedPlan = plans.find((p) => p.id === planId);

  useEffect(() => {
    if (!open) return;
    // Edit mode reads the membership's contact; add mode falls back to
    // the optional seed (lead → member conversion), else blank.
    setName(member?.contact?.name ?? seedContact?.name ?? "");
    setPhone(member?.contact?.phone ?? seedContact?.phone ?? "");
    setEmail(member?.contact?.email ?? seedContact?.email ?? "");
    setPlanId(member?.plan_id ?? "");
    setStartDate(member?.start_date ?? fmt.today());
    setFeeAmount(member ? String(member.fee_amount) : "");
    setNotes(member?.notes ?? "");
    setCollectPayment(false);
    setPayMethod("cash");
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

  // When a plan is picked, seed the fee from its price (unless the user
  // has already typed one, or we're editing an existing fee).
  useEffect(() => {
    if (!selectedPlan) return;
    setFeeAmount((prev) => (prev === "" ? String(selectedPlan.price) : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  async function checkDuplicate() {
    if (isEdit || !accountId) return;
    const value = phone.trim();
    if (!value) return setDupMatch(null);
    setCheckingDup(true);
    try {
      const existing = await findExistingContact(supabase, accountId, value);
      setDupMatch(
        existing ? { contact: existing, exact: isExactMatch(existing, value) } : null,
      );
    } finally {
      setCheckingDup(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return toast.error("Phone number is required");
    if (!accountId || !user) return toast.error("Your profile is not linked to an account.");

    const trialLen = Number(trialDays);
    if (isTrial) {
      if (!Number.isFinite(trialLen) || trialLen <= 0)
        return toast.error("Enter a valid trial length in days");
    } else if (!planId) {
      return toast.error("Pick a membership plan");
    }

    // Plan is required for a paid member, optional for a trial.
    const plan = plans.find((p) => p.id === planId);
    if (!isTrial && !plan) return toast.error("Selected plan is unavailable");

    // Trials are free; a paid member's fee seeds from the plan price.
    const fee = isTrial ? 0 : feeAmount === "" ? plan!.price : Number(feeAmount);
    if (!Number.isFinite(fee) || fee < 0) return toast.error("Enter a valid fee");

    setSaving(true);
    try {
      // ---- EDIT: update contact + membership in place ----
      if (isEdit && member) {
        const endDate = isTrial
          ? istAddDays(startDate, trialLen)
          : istAddDays(startDate, plan!.duration_days);
        const { error: cErr } = await supabase
          .from("contacts")
          .update({
            name: name.trim() || null,
            phone: phone.trim(),
            email: email.trim() || null,
          })
          .eq("id", member.contact_id);
        if (cErr) throw cErr;

        const { error: mErr } = await supabase
          .from("memberships")
          .update({
            plan_id: isTrial ? planId || null : planId,
            start_date: startDate,
            end_date: endDate,
            fee_amount: fee,
            is_trial: isTrial,
            notes: notes.trim() || null,
          })
          .eq("id", member.id);
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

      const endDate = isTrial
        ? istAddDays(startDate, trialLen)
        : istAddDays(startDate, plan!.duration_days);
      // Trials are free → 'paid' (nothing owed). A paid member is 'paid'
      // only when the first payment is collected up front.
      const feeStatus = isTrial ? "paid" : collectPayment ? "paid" : "due";

      const { data: mRow, error: mErr } = await supabase
        .from("memberships")
        .insert({
          account_id: accountId,
          contact_id: contactId,
          user_id: user.id,
          plan_id: isTrial ? planId || null : planId,
          start_date: startDate,
          end_date: endDate,
          status: "active",
          fee_amount: fee,
          fee_status: feeStatus,
          is_trial: isTrial,
          notes: notes.trim() || null,
        })
        .select("id")
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
      if (collectPayment && !isTrial) {
        const { error: pErr } = await supabase.from("payments").insert({
          account_id: accountId,
          membership_id: mRow.id,
          contact_id: contactId,
          plan_id: planId,
          user_id: user.id,
          amount: fee,
          method: payMethod,
          status: "paid",
          period_start: startDate,
          period_end: endDate,
        });
        if (pErr) {
          // The membership is saved; a payment hiccup shouldn't block it.
          toast.warning("Member created, but the payment couldn't be recorded.");
          onOpenChange(false);
          onSaved();
          return;
        }
      }

      toast.success(isTrial ? "Trial added" : "Member added");
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
          <DialogTitle>{isEdit ? "Edit member" : "Add member"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this member's details."
              : "Add a member and start their membership."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="mf-name" className="text-muted-foreground">Name</Label>
              <Input
                id="mf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mf-phone" className="text-muted-foreground">
                Phone <span className="text-red-700 dark:text-red-400">*</span>
              </Label>
              <Input
                id="mf-phone"
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
                className="bg-muted"
              />
              {dupMatch ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <div className="space-y-1">
                    <p>
                      {dupMatch.exact
                        ? "This number is already a contact — a membership will be attached to them."
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
              <Label htmlFor="mf-email" className="text-muted-foreground">Email</Label>
              <Input
                id="mf-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="member@example.com"
                className="bg-muted"
              />
            </div>

            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isTrial}
                onChange={(e) => setIsTrial(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                This is a trial / free pass
                <span className="block text-xs text-muted-foreground">
                  A free pass with its own length — convert to a paid plan later.
                </span>
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mf-plan" className="text-muted-foreground">
                  Plan {!isTrial && <span className="text-red-700 dark:text-red-400">*</span>}
                </Label>
                <select
                  id="mf-plan"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">Select a plan…</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.duration_days}d
                    </option>
                  ))}
                </select>
                {plans.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No plans yet — add them in Settings → Membership plans.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="mf-start" className="text-muted-foreground">Start date</Label>
                <Input
                  id="mf-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-muted"
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
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Ends {istAddDays(startDate, Number(trialDays) || 0)} · free pass, no fee.
                </p>
              </div>
            ) : (
              <>
                {selectedPlan && (
                  <p className="text-xs text-muted-foreground">
                    Expires {istAddDays(startDate, selectedPlan.duration_days)} ({selectedPlan.duration_days} days).
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="mf-fee" className="text-muted-foreground">Fee for this period</Label>
                  <Input
                    id="mf-fee"
                    type="number"
                    min={0}
                    value={feeAmount}
                    onChange={(e) => setFeeAmount(e.target.value)}
                    placeholder={selectedPlan ? String(selectedPlan.price) : "0"}
                    className="bg-muted"
                  />
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
                  <div className="space-y-1.5">
                    <Label htmlFor="mf-method" className="text-muted-foreground text-xs">
                      Payment method
                    </Label>
                    <select
                      id="mf-method"
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                      className="h-8 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
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
                className="bg-muted"
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
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
