"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, UsersRound } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { istAddDays } from "@/lib/memberships/expiry";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import type { Contact } from "@/types";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Newest-first cap on the candidate list — keeps the dialog snappy on
 *  big books; the search box narrows within the loaded set. */
const CANDIDATE_LIMIT = 500;

interface ImportMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Bulk-import existing contacts as members: pick people who don't have
 * a membership yet, apply one plan + start date to all of them. Fees
 * are marked 'due' — record collections per member afterwards, so the
 * import lands them straight in the Payment due action list.
 */
export function ImportMembersDialog({
  open,
  onOpenChange,
  onSaved,
}: ImportMembersDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        {open && (
          <ImportForm onClose={() => onOpenChange(false)} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const { fmt } = useLocale();
  const { plans } = useMembershipPlans(true);

  const [candidates, setCandidates] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState(fmt.today());
  const [feeAmount, setFeeAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedPlan = plans.find((p) => p.id === planId);

  // Contacts who aren't members yet — the import candidates. Any
  // membership row (trial or paid, any status) disqualifies; those
  // people already live in the Members views.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [memsRes, contactsRes] = await Promise.all([
        supabase.from("memberships").select("contact_id"),
        supabase
          .from("contacts")
          .select("id, name, phone, email")
          .order("created_at", { ascending: false })
          .limit(CANDIDATE_LIMIT),
      ]);
      if (cancelled) return;
      const memberIds = new Set(
        ((memsRes.data as { contact_id: string }[]) ?? []).map((m) => m.contact_id),
      );
      const rows = ((contactsRes.data as Contact[]) ?? []).filter(
        (c) => !memberIds.has(c.id),
      );
      setCandidates(rows);
      setTruncated(
        ((contactsRes.data as Contact[]) ?? []).length === CANDIDATE_LIMIT,
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed the fee from the picked plan unless the user already typed one.
  useEffect(() => {
    if (!selectedPlan) return;
    setFeeAmount((prev) => (prev === "" ? String(selectedPlan.price) : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  }

  async function handleImport() {
    if (!accountId || !user) return;
    if (selected.size === 0) return toast.error("Select at least one contact");
    if (!selectedPlan) return toast.error("Pick a membership plan");
    const fee = feeAmount === "" ? selectedPlan.price : Number(feeAmount);
    if (!Number.isFinite(fee) || fee < 0) return toast.error("Enter a valid fee");

    const endDate = istAddDays(startDate, selectedPlan.duration_days);
    const rows = candidates
      .filter((c) => selected.has(c.id))
      .map((c) => ({
        account_id: accountId,
        contact_id: c.id,
        user_id: user.id,
        plan_id: selectedPlan.id,
        start_date: startDate,
        end_date: endDate,
        status: "active",
        fee_amount: fee,
        fee_status: "due",
        is_trial: false,
      }));

    setSaving(true);
    const { error } = await supabase.from("memberships").insert(rows);
    setSaving(false);

    if (error) {
      if (isUniqueViolation(error)) {
        // Someone got a membership between load and import — none of the
        // batch landed (single statement); reopen to refresh candidates.
        toast.error(
          "Some selected contacts became members meanwhile. Reopen the dialog and retry.",
        );
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success(
      rows.length === 1 ? "1 member imported" : `${rows.length} members imported`,
    );
    onClose();
    onSaved();
  }

  return (
    <>
      <DialogHeader className="shrink-0 p-4 pb-2">
        <DialogTitle>Import members from leads</DialogTitle>
        <DialogDescription>
          Turn existing contacts into members — one plan and start date for
          everyone selected. Fees are marked due; record payments per member
          after.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-2">
        {/* Shared membership settings */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="im-plan" className="text-muted-foreground">
              Plan <span className="text-red-700 dark:text-red-400">*</span>
            </Label>
            <Select
              value={planId || undefined}
              onValueChange={(v) => setPlanId(v ?? "")}
            >
              <SelectTrigger id="im-plan" className="w-full bg-muted">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.duration_days}d · {fmt.money(p.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="im-start" className="text-muted-foreground">
              Start date
            </Label>
            <DatePicker
              id="im-start"
              value={startDate}
              onChange={setStartDate}
              className="bg-muted"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="im-fee" className="text-muted-foreground">
              Fee each
            </Label>
            <Input
              id="im-fee"
              type="number"
              min={0}
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              placeholder={selectedPlan ? String(selectedPlan.price) : "0"}
              className="bg-muted"
            />
          </div>
        </div>
        {selectedPlan && (
          <p className="text-xs text-muted-foreground">
            Everyone imported expires {istAddDays(startDate, selectedPlan.duration_days)}.
          </p>
        )}

        {/* Candidate picker */}
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or phone…"
        />

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading contacts…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <UsersRound className="size-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                {candidates.length === 0
                  ? "Every contact is already a member."
                  : "No contacts match your search."}
              </p>
            </div>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2.5 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                  className="size-4 accent-primary"
                />
                Select all{query ? " (filtered)" : ""} · {filtered.length}
              </label>
              <ul className="divide-y divide-border">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {c.name || "Unnamed"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.phone}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {truncated && (
          <p className="text-xs text-muted-foreground">
            Showing the {CANDIDATE_LIMIT} newest contacts — search to narrow, or
            import in batches.
          </p>
        )}
      </div>

      <DialogFooter className="m-0 shrink-0 border-border p-4 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleImport}
          disabled={saving || loading || selected.size === 0 || !selectedPlan}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Import {selected.size > 0 ? selected.size : ""} member
          {selected.size === 1 ? "" : "s"}
        </Button>
      </DialogFooter>
    </>
  );
}
