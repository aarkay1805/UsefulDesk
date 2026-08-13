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
import { AlertCircle, Check, Copy, Loader2, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [submissionCount, setSubmissionCount] = useState<number | null>(null);

  const [headline, setHeadline] = useState('');
  const [intro, setIntro] = useState('');
  const [consentText, setConsentText] = useState('');

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from('lead_capture_forms')
        .select('id, token, is_active, headline, intro, consent_text')
        .eq('account_id', accountId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setLoadError(
          getErrorMessage(
            error,
            "Lead capture settings couldn't load. Try again."
          )
        );
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
  }, [supabase, accountId, reloadNonce]);

  const formUrl = form
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/f/${form.token}`
    : '';
  const hasChanges = Boolean(
    form &&
    (headline.trim() !== (form.headline ?? '') ||
      intro.trim() !== (form.intro ?? '') ||
      consentText.trim() !== form.consent_text)
  );

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/lead-forms', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create the form');
      const nextForm = data.form as CaptureForm;
      setForm(nextForm);
      setHeadline(nextForm.headline ?? '');
      setIntro(nextForm.intro ?? '');
      setConsentText(nextForm.consent_text);
      setSubmissionCount(0);
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
      setUpdatingStatus(true);
      try {
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
      } finally {
        setUpdatingStatus(false);
      }
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
      toast.success('Enquiry form saved');
    } catch (error) {
      toast.error(
        getErrorMessage(error, "The enquiry form couldn't be saved. Try again.")
      );
    } finally {
      setSaving(false);
    }
  }, [form, headline, intro, consentText, supabase]);

  if (loading) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading lead capture settings…
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Lead capture settings couldn&apos;t load</AlertTitle>
        <AlertDescription>
          <p>{loadError}</p>
          <Button
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={() => setReloadNonce((nonce) => nonce + 1)}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Enquiry form</CardTitle>
          <CardDescription>
            Create a public link that sends every submission to Leads.
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
            Share this link anywhere you collect enquiries. Submissions appear
            in Leads with the selected goal tag.
            {submissionCount !== null && submissionCount > 0 && (
              <>
                {' '}
                <span className="text-foreground font-medium">
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
              <Input id="lc-url" readOnly value={formUrl} />
              <Button
                variant="outline"
                onClick={handleCopy}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <p className="text-foreground text-sm font-medium">
                {form.is_active ? 'Form is live' : 'Form is turned off'}
              </p>
              <p
                id="lead-capture-status-description"
                className="text-muted-foreground text-xs"
              >
                {form.is_active
                  ? 'Anyone with the link can submit an enquiry.'
                  : 'The link shows a “not available” message.'}
              </p>
            </div>
            <Switch
              checked={form.is_active}
              onCheckedChange={handleToggleActive}
              disabled={!canEdit || updatingStatus}
              aria-label="Form is live"
              aria-describedby="lead-capture-status-description"
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
                aria-describedby="lead-capture-consent-description"
              />
              <p
                id="lead-capture-consent-description"
                className="text-muted-foreground text-xs"
              >
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
                disabled={saving || !hasChanges}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? 'Saving…' : 'Save changes'}
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
              A new URL will replace the current one. Update every place you
              shared the old link. Existing leads remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRotate}
              disabled={rotating}
            >
              {rotating && <Loader2 className="size-4 animate-spin" />}
              {rotating ? 'Rotating…' : 'Rotate link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
