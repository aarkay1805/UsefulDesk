"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import { istToday, istAddDays } from "@/lib/memberships/expiry";
import {
  defaultReason,
  REASON_LABEL,
  OUTCOME_LABEL,
} from "@/lib/memberships/follow-ups";
import type {
  FollowUp,
  FollowUpOutcome,
  FollowUpReason,
  Membership,
} from "@/types";
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
import { Textarea } from "@/components/ui/textarea";
import { useAccountStaff } from "./use-account-staff";

const REASONS = Object.keys(REASON_LABEL) as FollowUpReason[];
const OUTCOMES = Object.keys(OUTCOME_LABEL) as FollowUpOutcome[];

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary";

interface FollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Member the task chases — supplies contact/membership context. */
  membership: Membership;
  onSaved: () => void;
}

/**
 * Assign a follow-up: pick an owner, reason, due date, optional note.
 * The form body mounts fresh each open, so field state initializes per
 * member without an on-open reset effect (repo lint forbids setState
 * directly in effects).
 */
export function FollowUpDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
}: FollowUpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open && (
          <AssignForm
            membership={membership}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({
  membership,
  onClose,
  onSaved,
}: {
  membership: Membership;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { user } = useAuth();
  const { staff } = useAccountStaff();

  // Default owner = whoever is assigning; due tomorrow (chase lists
  // are worked in the morning, so "today" would be instantly overdue).
  const [assignedTo, setAssignedTo] = useState(user?.id ?? "");
  const [reason, setReason] = useState<FollowUpReason>(() =>
    defaultReason(membership),
  );
  const [dueDate, setDueDate] = useState(() => istAddDays(istToday(), 1));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAssign() {
    if (!user) return;
    if (!dueDate) return toast.error("Pick a due date");

    setSaving(true);
    const { error } = await supabase.from("follow_ups").insert({
      account_id: membership.account_id,
      contact_id: membership.contact_id,
      membership_id: membership.id,
      assigned_to: assignedTo || null,
      created_by: user.id,
      reason,
      due_date: dueDate,
      note: note.trim() || null,
    });
    setSaving(false);

    if (error) {
      if (isUniqueViolation(error)) {
        toast.error("This member already has an open follow-up.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success("Follow-up assigned");
    onClose();
    onSaved();
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>Assign follow-up</DialogTitle>
          <DialogDescription>
            Give {membership.contact?.name || "this member"}&apos;s next action an
            owner and a due date.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fu-assignee" className="text-muted-foreground">
              Owner
            </Label>
            <select
              id="fu-assignee"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className={selectClass}
            >
              {staff.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.full_name}
                  {s.user_id === user?.id ? " (me)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="fu-reason" className="text-muted-foreground">
                Reason
              </Label>
              <select
                id="fu-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as FollowUpReason)}
                className={selectClass}
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {REASON_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fu-due" className="text-muted-foreground">
                Due
              </Label>
              <Input
                id="fu-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="bg-muted"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-note" className="text-muted-foreground">
              Note <span className="opacity-60">(optional)</span>
            </Label>
            <Textarea
              id="fu-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Promised to decide after salary day"
              className="min-h-[60px] resize-none bg-muted text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAssign}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
    </>
  );
}

interface CompleteFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUp: FollowUp;
  onSaved: () => void;
}

/** Close a follow-up with an outcome — or cancel the task entirely. */
export function CompleteFollowUpDialog({
  open,
  onOpenChange,
  followUp,
  onSaved,
}: CompleteFollowUpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open && (
          <CompleteForm
            followUp={followUp}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CompleteForm({
  followUp,
  onClose,
  onSaved,
}: {
  followUp: FollowUp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();

  const [outcome, setOutcome] = useState<FollowUpOutcome>("renewed");
  const [note, setNote] = useState(followUp.note ?? "");
  const [saving, setSaving] = useState(false);

  async function close(status: "done" | "cancelled") {
    setSaving(true);
    const { error } = await supabase
      .from("follow_ups")
      .update({
        status,
        outcome: status === "done" ? outcome : null,
        note: note.trim() || null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", followUp.id);
    setSaving(false);

    if (error) return toast.error(error.message);
    toast.success(status === "done" ? "Follow-up completed" : "Follow-up cancelled");
    onClose();
    onSaved();
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>Complete follow-up</DialogTitle>
          <DialogDescription>
            What happened with {followUp.contact?.name || "this member"}?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fu-outcome" className="text-muted-foreground">
              Outcome
            </Label>
            <select
              id="fu-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as FollowUpOutcome)}
              className={selectClass}
            >
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-close-note" className="text-muted-foreground">
              Note <span className="opacity-60">(optional)</span>
            </Label>
            <Textarea
              id="fu-close-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Renewed for 3 months, paid via UPI"
              className="min-h-[60px] resize-none bg-muted text-sm"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => close("cancelled")}
            disabled={saving}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel task
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Back
            </Button>
            <Button
              type="button"
              onClick={() => close("done")}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Mark done
            </Button>
          </div>
        </DialogFooter>
    </>
  );
}
