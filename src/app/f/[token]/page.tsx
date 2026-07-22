'use client';

// ============================================================
// /f/[token] — the public lead capture form.
//
// The only page in the product an anonymous stranger is meant to use.
// Four states:
//
//   ┌──────────────────────┬──────────────────────────────────┐
//   │ peek loading         │ spinner                          │
//   │ peek ok:false        │ "link isn't active" card         │
//   │ peek ok:true         │ the form                         │
//   │ submitted            │ thank-you card                   │
//   └──────────────────────┴──────────────────────────────────┘
//
// Validation runs through the SAME pure function the submit route
// runs (src/lib/leads/capture-form.ts). The client copy exists to give
// the visitor inline errors; the server copy is the one that counts.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Script from 'next/script';
import { CheckCircle2, Link2Off, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GOAL_OPTIONS } from '@/lib/leads/attributes';
import {
  captureErrorMessage,
  validateCaptureSubmission,
  type CaptureFieldError,
} from '@/lib/leads/capture-form';

interface SourceOption {
  key: string;
  label: string;
}
interface PeekOk {
  ok: true;
  gym_name: string;
  headline: string | null;
  intro: string | null;
  consent_text: string;
  phone_country_code: string;
  sources: SourceOption[];
}
interface PeekFail {
  ok: false;
  reason: 'not_found' | 'revoked' | 'server_error';
}
type PeekResult = PeekOk | PeekFail;

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
        }
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

export default function CaptureFormPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [goal, setGoal] = useState('');
  const [source, setSource] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot
  const [errors, setErrors] = useState<CaptureFieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileRendered = useRef(false);

  // Inline IIFE + cancelled guard: react-hooks/set-state-in-effect
  // forbids calling a setState-wrapping function straight from an effect.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lead-forms/${token}/peek`);
        const data = (await res.json()) as PeekResult;
        if (!cancelled) setPeek(data);
      } catch {
        if (!cancelled) setPeek({ ok: false, reason: 'server_error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Render the Turnstile widget once the script and the form are both up.
  useEffect(() => {
    if (!turnstileReady || !TURNSTILE_SITE_KEY) return;
    if (turnstileRendered.current) return;
    const el = turnstileRef.current;
    if (!el || !window.turnstile) return;

    turnstileRendered.current = true;
    window.turnstile.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (t: string) => setTurnstileToken(t),
      'error-callback': () => setTurnstileToken(null),
      'expired-callback': () => setTurnstileToken(null),
    });
  }, [turnstileReady, peek]);

  const sources: SourceOption[] = peek?.ok ? peek.sources : [];
  const dialCode = peek?.ok ? peek.phone_country_code : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!peek?.ok || submitting) return;

    const result = validateCaptureSubmission(
      { name, phone, email, goal, source, consent },
      { dialCode, sourceKeys: sources.map((s) => s.key) }
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/lead-forms/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email,
          goal,
          source,
          consent,
          website, // honeypot — empty for a real visitor
          turnstile_token: turnstileToken,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        reason?: string;
        errors?: CaptureFieldError[];
      };

      if (data.ok) {
        setDone(true);
        return;
      }
      if (data.errors?.length) {
        setErrors(data.errors);
      }
      // Reset the widget so a retry gets a fresh token — Turnstile
      // tokens are single-use.
      window.turnstile?.reset();
      setTurnstileToken(null);
    } catch {
      setErrors([]);
    } finally {
      setSubmitting(false);
    }
  }

  const errorFor = (field: CaptureFieldError) =>
    errors.includes(field) ? captureErrorMessage(field) : null;

  if (!peek) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (!peek.ok) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Link2Off className="size-8 text-muted-foreground" />
          <CardTitle>This form isn’t available</CardTitle>
          <CardDescription>
            {peek.reason === 'revoked'
              ? 'This enquiry link has been turned off. Please contact the gym directly.'
              : 'This link doesn’t match an active enquiry form. Double-check the URL, or contact the gym directly.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CheckCircle2 className="size-8 text-success" />
          <CardTitle>Thanks — we’ve got your details</CardTitle>
          <CardDescription>
            {peek.gym_name} will get in touch with you shortly on WhatsApp.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          onLoad={() => setTurnstileReady(true)}
        />
      )}
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{peek.headline || `Enquire at ${peek.gym_name}`}</CardTitle>
          <CardDescription>
            {peek.intro ||
              'Leave your details and we’ll get back to you on WhatsApp.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="cf-name">Name</Label>
              <Input
                id="cf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                aria-invalid={errors.includes('name_required')}
              />
              {errorFor('name_required') && (
                <p className="text-xs text-destructive">
                  {errorFor('name_required')}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-phone">Phone</Label>
              <PhoneInput
                id="cf-phone"
                value={phone}
                onValueChange={setPhone}
                countryCode={dialCode}
                placeholder="98765 43210"
                aria-invalid={
                  errors.includes('phone_required') ||
                  errors.includes('phone_invalid')
                }
              />
              {(errorFor('phone_required') || errorFor('phone_invalid')) && (
                <p className="text-xs text-destructive">
                  {errorFor('phone_required') ?? errorFor('phone_invalid')}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-email">
                Email <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="cf-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                aria-invalid={errors.includes('email_invalid')}
              />
              {errorFor('email_invalid') && (
                <p className="text-xs text-destructive">
                  {errorFor('email_invalid')}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-goal">
                Your goal <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Select value={goal || undefined} onValueChange={(v) => v && setGoal(v)}>
                <SelectTrigger id="cf-goal" className="w-full">
                  <SelectValue placeholder="Pick a goal" />
                </SelectTrigger>
                <SelectContent>
                  {GOAL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-source">
                How did you hear about us?{' '}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Select
                value={source || undefined}
                onValueChange={(v) => v && setSource(v)}
              >
                <SelectTrigger id="cf-source" className="w-full">
                  <SelectValue placeholder="Pick an option" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Honeypot. Off-screen, not display:none — some bots skip
                hidden inputs but happily fill an sr-only one. */}
            <div className="sr-only" aria-hidden="true">
              <label htmlFor="cf-website">Website</label>
              <input
                id="cf-website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            <div className="flex items-start gap-2.5 pt-1">
              <Checkbox
                id="cf-consent"
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                aria-invalid={errors.includes('consent_required')}
                className="mt-0.5"
              />
              <Label
                htmlFor="cf-consent"
                className="text-sm font-normal leading-snug text-muted-foreground"
              >
                {peek.consent_text}
              </Label>
            </div>
            {errorFor('consent_required') && (
              <p className="text-xs text-destructive">
                {errorFor('consent_required')}
              </p>
            )}

            {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="pt-1" />}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Sending…
                </>
              ) : (
                'Send enquiry'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
