'use client';

// Agent peer-handoff confirm (migration 050). An agent reassigning a lead
// they own doesn't move ownership immediately — it opens this dialog to
// send a transfer REQUEST the target must accept. Admins never see it
// (their reassign is instant); the page decides which path to take from
// the RPC's returned status, so this dialog is purely the "add a note +
// confirm" step. Dumb component: the page owns the RPC call.

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Loader2, ArrowRight } from 'lucide-react';

export function TransferRequestDialog({
  open,
  onOpenChange,
  targetName,
  targetAvatarUrl,
  leadName,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetName: string;
  targetAvatarUrl?: string | null;
  leadName: string;
  submitting: boolean;
  onConfirm: (note: string) => void;
}) {
  // Note resets per request because the parent keys this dialog by the
  // target/lead — a fresh target remounts it with an empty note (no
  // setState-in-effect needed).
  const [note, setNote] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Request transfer
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Ownership of{' '}
            <span className="text-foreground font-medium">{leadName}</span> moves
            only after your teammate accepts. Until then you stay the owner.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          <UserAvatar
            name={targetName}
            src={targetAvatarUrl ?? null}
            className="size-6 shrink-0"
            fallbackClassName="text-[11px]"
          />
          <span className="truncate text-sm font-medium text-foreground">
            {targetName}
          </span>
        </div>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground">Note (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context for your teammate…"
            rows={3}
            className="text-foreground"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => onConfirm(note.trim())}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
