'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { canRecordWhatsAppConsent } from '@/lib/auth/roles';
import { recordTemplateConsent } from '@/lib/consent/template-consent';
import type { TemplateConsentScope } from '@/lib/whatsapp/template-contracts';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

interface WhatsAppConsentControlProps {
  contactId: string;
  contactName: string;
}

export function WhatsAppConsentControl({
  contactId,
  contactName,
}: WhatsAppConsentControlProps) {
  const { accountId, accountRole } = useAuth();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<TemplateConsentScope>(
    'whatsapp_account_updates'
  );
  const [evidenceNote, setEvidenceNote] = useState('');
  const [saving, setSaving] = useState(false);

  if (!accountId || !accountRole || !canRecordWhatsAppConsent(accountRole)) {
    return null;
  }

  async function record(action: 'opt_in' | 'opt_out') {
    setSaving(true);
    try {
      await recordTemplateConsent(supabase, {
        accountId: accountId!,
        contactId,
        scope,
        action,
        source: 'staff_recorded',
        evidenceNote,
      });
      toast.success(
        action === 'opt_in'
          ? 'WhatsApp permission recorded.'
          : 'WhatsApp opt-out recorded for the organization.'
      );
      setEvidenceNote('');
      setOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not record WhatsApp consent.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <ShieldCheck className="size-4" /> WhatsApp consent
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record WhatsApp consent</DialogTitle>
          <DialogDescription>
            Record explicit permission for {contactName || 'this contact'}.
            Having a phone number or follow-up permission does not authorize
            these proactive WhatsApp categories.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <RadioGroup
            value={scope}
            onValueChange={(value) => setScope(value as TemplateConsentScope)}
            aria-label="WhatsApp permission category"
          >
            <Label className="border-border flex items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem
                value="whatsapp_account_updates"
                className="mt-0.5"
              />
              <span>
                <span className="block">Account updates</span>
                <span className="text-muted-foreground mt-1 block text-xs leading-4 font-normal">
                  Existing membership, invoice, payment, and transaction
                  updates. This does not include renewal offers.
                </span>
              </span>
            </Label>
            <Label className="border-border flex items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem value="whatsapp_marketing" className="mt-0.5" />
              <span>
                <span className="block">Marketing</span>
                <span className="text-muted-foreground mt-1 block text-xs leading-4 font-normal">
                  Renewal invitations, win-back messages, campaigns, and offers.
                </span>
              </span>
            </Label>
          </RadioGroup>

          <div className="space-y-2">
            <Label htmlFor="whatsapp-consent-evidence">Evidence note</Label>
            <Textarea
              id="whatsapp-consent-evidence"
              value={evidenceNote}
              onChange={(event) => setEvidenceNote(event.target.value)}
              placeholder="Where and when did the member give or withdraw permission?"
            />
            <p className="text-muted-foreground text-xs leading-4">
              An opt-out suppresses proactive WhatsApp messages across this
              organization, regardless of the category selected above.
            </p>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            disabled={!evidenceNote.trim()}
            loading={saving}
            onClick={() => void record('opt_out')}
          >
            Record opt-out
          </Button>
          <Button
            type="button"
            disabled={!evidenceNote.trim()}
            loading={saving}
            onClick={() => void record('opt_in')}
          >
            Record permission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
