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
          ? 'WhatsApp permission saved.'
          : 'Saved: this person asked not to get messages.'
      );
      setEvidenceNote('');
      setOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save WhatsApp permission.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <ShieldCheck className="size-4" /> WhatsApp permission
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save WhatsApp permission</DialogTitle>
          <DialogDescription>
            Keep a note of what {contactName || 'this person'} agreed to. This
            note does not stop or start any messages.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <RadioGroup
            value={scope}
            onValueChange={(value) => setScope(value as TemplateConsentScope)}
            aria-label="Type of messages"
          >
            <Label className="border-border flex items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem
                value="whatsapp_account_updates"
                className="mt-0.5"
              />
              <span>
                <span className="block">Updates about their account</span>
                <span className="text-muted-foreground mt-1 block text-xs leading-4 font-normal">
                  Messages about their membership, invoices, and payments. Not
                  renewal offers.
                </span>
              </span>
            </Label>
            <Label className="border-border flex items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem value="whatsapp_marketing" className="mt-0.5" />
              <span>
                <span className="block">Offers and marketing</span>
                <span className="text-muted-foreground mt-1 block text-xs leading-4 font-normal">
                  Renewal offers, come-back offers, and other promotions.
                </span>
              </span>
            </Label>
          </RadioGroup>

          <div className="space-y-2">
            <Label htmlFor="whatsapp-consent-evidence">How did they tell you?</Label>
            <Textarea
              id="whatsapp-consent-evidence"
              value={evidenceNote}
              onChange={(event) => setEvidenceNote(event.target.value)}
              placeholder="Example: Said yes at the front desk on 5 March"
            />
            <p className="text-muted-foreground text-xs leading-4">
              This is saved as history for all branches. It does not stop
              messages from being sent.
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
            Save: does not want messages
          </Button>
          <Button
            type="button"
            disabled={!evidenceNote.trim()}
            loading={saving}
            onClick={() => void record('opt_in')}
          >
            Save: agreed to messages
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
