"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import type { CheckInWarning } from "@/lib/memberships/attendance-limits";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * The warn-with-override step both check-in paths share (migration 062):
 * a member at their plan's visit limit — or on an exhausted session pack
 * — still checks in if staff confirm. Never a hard block; the owner
 * stays in charge at the front desk.
 */
export function AttendanceOverrideDialog({
  open,
  warning,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  warning: CheckInWarning | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-foreground" />
            {warning?.title ?? "Check-in limit"}
          </DialogTitle>
          <DialogDescription>{warning?.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Check in anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
