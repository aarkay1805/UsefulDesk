'use client';

// ============================================================
// Settings → Lead capture → the public enquiry form.
//
// One form per gym (lead_capture_forms.account_id is UNIQUE). The card
// mints it on demand, shows the shareable link, lets an admin edit the
// copy + the consent text, and revoke or rotate the link.
//
// Token minting goes through POST /api/lead-forms (CSPRNG, server-side).
// Everything else is a direct RLS write from the browser client — with
// `.select('id')` chained, because an RLS-blocked write returns NO
// error and zero rows, and would otherwise toast success over a write
// that never happened.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';

interface CaptureForm {
  id: string;
  token: string;
  is_active: boolean;
  headline: string | null;
  intro: string | null;
  consent_text: string;
}

export function LeadCaptureSettings() {
  const { accountId, canEditSettings } = useAuth();
  const supabase = createClient();
  const canEdit = canEditSettings;

  const [form, setForm] = useState<CaptureForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [submissionCount, setSubmissionCount] = useState<number | null>(null);

  const [headline, setHeadline] = useState('');
  const [intro, setIntro] = useState('');
  const [consentText, setConsentText] = useState('');

  // Manual refetch is a nonce bump — never a setState-wrapping call
  // straight out of an effect (react-hooks/set-state-in-effect).
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('lead_capture_forms')
        .select('id, token, is_active, headline, intro, consent_text')
        .eq('account_id', accountId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        toast.error(getErrorMessage(error, 'Failed to load the capture form'));
        setLoading(false);
        return;
      }
      if (data) {
        const row = data as CaptureForm;
        setForm(row);
        setHeadline(row.headline ?? '');
        setIntro(row.intro ?? '');
        setConsentText(row.consent_text);

        const { count } = await supabase
          .from('lead_capture_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId);
        if (!cancelled) setSubmissionCount(count ?? 0);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, accountId, nonce]);

  const formUrl = form
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/f/${form.token}`
    : '';

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/lead-forms', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create the form');
      setForm(data.form as CaptureForm);
      setConsentText((data.form as CaptureForm).consent_text);
      toast.success('Enquiry form created');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create the form'));
    } finally {
      setCreating(false);
    }
  }, []);

  const handleRotate = useCallback(async () => {
    setRotating(true);
    try {
      const res = await fetch('/api/lead-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotate: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to rotate the link');
      setForm(data.form as CaptureForm);
      setRotateOpen(false);
      toast.success('New link generated — the old one no longer works');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to rotate the link'));
    } finally {
      setRotating(false);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the link and copy it manually');
    }
  }, [formUrl]);

  const handleToggleActive = useCallback(
    async (next: boolean) => {
      if (!form) return;
      const { data, error } = await supabase
        .from('lead_capture_forms')
        .update({
          is_active: next,
          revoked_at: next ? null : new Date().toISOString(),
        })
        .eq('id', form.id)
        // Empty result = RLS refused. Without this the UI would toast
        // success while the row sat unchanged.
        .select('id')
        .maybeSingle();

      if (error || !data) {
        toast.error(getErrorMessage(error, 'Failed to update the form'));
        return;
      }
      setForm({ ...form, is_active: next });
      toast.success(next ? 'Form is live' : 'Form turned off');
    },
    [form, supabase]
  );

  const handleSaveCopy = useCallback(async () => {
    if (!form) return;
    const consent = consentText.trim();
    if (!consent) {
      toast.error('Consent text cannot be empty');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('lead_capture_forms')
        .update({
          headline: headline.trim() || null,
          intro: intro.trim() || null,
          consent_text: consent,
        })
        .eq('id', form.id)
        .select('id')
        .maybeSingle();

      if (error || !data) {
        toast.error(getErrorMessage(error, 'Failed to save'));
        return;
      }
      setForm({
        ...form,
        headline: headline.trim() || null,
        intro: intro.trim() || null,
        consent_text: consent,
      });
      toast.success('Saved');
    } finally {
      setSaving(false);
    }
  }, [form, headline, intro, consentText, supabase]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </CardContent>
      </Card>
    );
  }

  if (!form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Enquiry form</CardTitle>
          <CardDescription>
            A public form anyone can fill in — put the link in your Instagram
            bio, or print it as a QR code at the front desk. Every submission
            lands in Leads as a new enquiry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GatedButton
            canAct={canEdit}
            gateReason="create the enquiry form"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating && <Loader2 className="size-4 animate-spin" />}
            Create enquiry form
          </GatedButton>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Enquiry form</CardTitle>
          <CardDescription>
            Share this link to collect enquiries. Every submission lands in
            Leads, tagged with the enquirer&apos;s goal.
            {submissionCount !== null && submissionCount > 0 && (
              <>
                {' '}
                <span className="font-medium text-foreground">
                  {submissionCount} received so far.
                </span>
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="lc-url">Your link</Label>
            <div className="flex gap-2">
              <Input id="lc-url" readOnly value={formUrl} className="font-mono text-xs" />
              <Button variant="outline" onClick={handleCopy} className="shrink-0">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">
                {form.is_active ? 'Form is live' : 'Form is turned off'}
              </p>
              <p className="text-xs text-muted-foreground">
                {form.is_active
                  ? 'Anyone with the link can submit an enquiry.'
                  : 'The link shows a “not available” message.'}
              </p>
            </div>
            <Switch
              checked={form.is_active}
              onCheckedChange={handleToggleActive}
              disabled={!canEdit}
              aria-label="Form is live"
            />
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lc-headline">Headline</Label>
              <Input
                id="lc-headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Enquire at Iron Gym"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-intro">Intro</Label>
              <Textarea
                id="lc-intro"
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                placeholder="Leave your details and we’ll get back to you on WhatsApp."
                rows={2}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-consent">Consent text</Label>
              <Textarea
                id="lc-consent"
                value={consentText}
                onChange={(e) => setConsentText(e.target.value)}
                rows={2}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                Shown next to a required checkbox. The exact wording is stored
                with every submission, so editing it never rewrites what past
                enquirers agreed to.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <GatedButton
                canAct={canEdit}
                gateReason="edit the enquiry form"
                onClick={handleSaveCopy}
                disabled={saving}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save
              </GatedButton>
              <GatedButton
                canAct={canEdit}
                gateReason="rotate the enquiry link"
                variant="outline"
                onClick={() => setRotateOpen(true)}
              >
                <RefreshCw className="size-4" />
                Rotate link
              </GatedButton>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate the enquiry link?</DialogTitle>
            <DialogDescription>
              This generates a new URL and immediately kills the current one.
              Anywhere you&apos;ve already shared it — your Instagram bio, a
              printed QR poster, a WhatsApp broadcast — will stop working until
              you replace it. Existing leads are unaffected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRotate} disabled={rotating}>
              {rotating && <Loader2 className="size-4 animate-spin" />}
              Rotate link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
