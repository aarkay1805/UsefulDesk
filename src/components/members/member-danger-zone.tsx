'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { canRecordWhatsAppConsent } from '@/lib/auth/roles';
import { WhatsAppConsentControl } from '@/components/contacts/whatsapp-consent-control';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface MemberDangerZoneProps {
  contactId: string;
  memberName: string;
  /** Owner/admin only (canDeleteMember). */
  canDelete: boolean;
  /** A live provider mandate must be resolved before local deletion. */
  blockedReason?: string | null;
  /** Called after a successful delete — close the sheet + refresh the list. */
  onDeleted: () => void;
}

/**
 * Settings / danger zone. Delete permanently removes personal/member
 * data while retaining anonymized payment ledger rows for accounting via the
 * delete_member RPC — which re-checks owner/admin server-side, so the
 * UI gate isn't the only guard. (Merge intentionally deferred.)
 */
export function MemberDangerZone({
  contactId,
  memberName,
  canDelete,
  blockedReason,
  onDeleted,
}: MemberDangerZoneProps) {
  const supabase = createClient();
  const { accountRole } = useAuth();
  const canManageConsent = accountRole
    ? canRecordWhatsAppConsent(accountRole)
    : false;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const { error } = await supabase.rpc('delete_member', {
      p_contact_id: contactId,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Member deleted');
    setConfirmOpen(false);
    onDeleted();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consent &amp; data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManageConsent && (
          <div className="border-border flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">WhatsApp consent</p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Record account-message or marketing consent history. These
                records do not control sending.
              </p>
            </div>
            <div className="self-end sm:self-auto">
              <WhatsAppConsentControl
                contactId={contactId}
                contactName={memberName || 'this member'}
              />
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-destructive text-sm font-medium">
              Delete member
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Permanently delete this member&apos;s profile, membership,
              attendance, and notes. Payment ledger entries are retained without
              the member link for accounting. This can&apos;t be undone.
            </p>
            {blockedReason && (
              <p className="text-muted-foreground mt-1 text-sm">
                {blockedReason} Deletion is unavailable until then.
              </p>
            )}
          </div>
          <Button
            className="self-end sm:self-auto"
            variant="destructive"
            size="sm"
            disabled={!canDelete || !!blockedReason}
            onClick={() => setConfirmOpen(true)}
            title={
              blockedReason ??
              (canDelete
                ? undefined
                : 'Only an owner or admin can delete a member')
            }
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {memberName || 'this member'}?</DialogTitle>
            <DialogDescription>
              This permanently removes the member profile, membership,
              attendance, and notes. Payment ledger entries are retained and
              anonymized for accounting. This action cannot be undone.
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
            <Button
              variant="destructive"
              onClick={remove}
              loading={busy}
              disabled={busy}
            >
              <Trash2 className="size-4" /> Delete member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
