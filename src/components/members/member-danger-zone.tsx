"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface MemberDangerZoneProps {
  contactId: string;
  memberName: string;
  /** Owner/admin only (canDeleteMember). */
  canDelete: boolean;
  /** Called after a successful delete — close the sheet + refresh the list. */
  onDeleted: () => void;
}

/**
 * Settings / danger zone. Delete permanently removes the member and all
 * associated data (membership, payments, attendance, notes) via the
 * delete_member RPC — which re-checks owner/admin server-side, so the
 * UI gate isn't the only guard. (Merge intentionally deferred.)
 */
export function MemberDangerZone({
  contactId,
  memberName,
  canDelete,
  onDeleted,
}: MemberDangerZoneProps) {
  const supabase = createClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const { error } = await supabase.rpc("delete_member", {
      p_contact_id: contactId,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Member deleted");
    setConfirmOpen(false);
    onDeleted();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-destructive">Delete member</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Permanently delete this member and all associated data —
              membership, payments, attendance, and notes. This can&apos;t be
              undone.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canDelete}
            onClick={() => setConfirmOpen(true)}
            title={canDelete ? undefined : "Only an owner or admin can delete a member"}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {memberName || "this member"}?</DialogTitle>
            <DialogDescription>
              This permanently removes the member and every record tied to them
              — membership, payment history, attendance, and notes. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              <Trash2 className="size-4" /> Delete member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
