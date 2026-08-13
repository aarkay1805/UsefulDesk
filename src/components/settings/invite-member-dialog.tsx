'use client';

// ============================================================
// InviteMemberDialog
//
// Two-step modal:
//   1. Form  — role + expiry + optional label → POST creates the invite.
//   2. Result — the share URL, returned ONCE. Copy-to-clipboard, plus a
//              "Send via WhatsApp" deep link that pre-fills wa.me with
//              a friendly message containing the URL.
//
// The plaintext token is server-stored only as a SHA-256 hash, so once
// the result step is dismissed the link is gone forever — the dialog
// shouts this in copy.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Copy,
  Loader2,
  MessageCircle,
  Sparkles,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { ROLE_META } from './role-meta';

type InviteRole = 'admin' | 'agent' | 'viewer';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the
   *  pending-invitations list. */
  onCreated: () => void;
}

const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
];

const ROLE_DESCRIPTIONS: Record<InviteRole, string> = {
  admin: 'Can invite teammates, manage settings, send messages, and edit data.',
  agent:
    'Can use the inbox, contacts, broadcasts, automations, and flows. No settings or member access.',
  viewer: 'Read-only access across every page. Cannot send or edit anything.',
};

// Server caps label at 80 chars (see src/app/api/account/invitations/route.ts).
// Mirror it on the client so we short-circuit before the round-trip
// rather than letting the user submit and bounce off a 400.
const MAX_LABEL_LEN = 80;

interface CreatedInvite {
  url: string;
  role: InviteRole;
  expiresInDays: number;
  /** Snapshotted at creation time so a later account rename can't
   *  retroactively change the wa.me message text on the result step. */
  accountName: string;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  onCreated,
}: InviteMemberDialogProps) {
  const { account } = useAuth();
  const [role, setRole] = useState<InviteRole>('agent');
  const [expiry, setExpiry] = useState<string>('7');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedInvite | null>(null);

  function reset() {
    setRole('agent');
    setExpiry('7');
    setLabel('');
    setResult(null);
    setSubmitting(false);
  }

  async function handleCreate() {
    // Mirror the server's max-length check so we don't ship an
    // obviously-too-long label across the wire just to bounce off
    // a 400. The Input also has a `maxLength={MAX_LABEL_LEN}` cap
    // but a paste can land an over-limit string into state before
    // the limit kicks in on the next keystroke — this is the safety
    // net for that path.
    const trimmedLabel = label.trim();
    if (trimmedLabel.length > MAX_LABEL_LEN) {
      toast.error(`Label must be ${MAX_LABEL_LEN} characters or fewer`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          expiresInDays: Number(expiry),
          label: trimmedLabel || undefined,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to create invitation');
        return;
      }

      const data = (await res.json()) as {
        url: string;
        expiresInDays: number;
      };

      setResult({
        url: data.url,
        role,
        expiresInDays: data.expiresInDays,
        // Snapshot the account name into the result so the wa.me
        // share message has team context. Falls back to a generic
        // string if `account` hasn't loaded yet (shouldn't happen
        // — the dialog requires admin+ which requires a loaded
        // profile — but stay safe).
        accountName: account?.name ?? 'our UsefulDesk account',
      });
      onCreated();
    } catch (err) {
      console.error('[InviteMemberDialog] create error:', err);
      toast.error('Could not reach the server. Try again?');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success('Invite link copied');
    } catch {
      // Most likely "not in a secure context" — happens on http://
      // local IPs. Surface the link in the toast so the admin can
      // hand-copy it.
      toast.error('Clipboard blocked — copy the link manually');
    }
  }

  function whatsappShareUrl(url: string): string {
    // Include the account name so the recipient knows which team
    // they're being invited to before clicking through. This matters
    // for users in multi-team contexts where "our wacrm account"
    // wouldn't be enough to disambiguate.
    const accountName = result?.accountName ?? 'our UsefulDesk account';
    const message = `Join ${accountName} on UsefulDesk using this link (valid for ${result?.expiresInDays} days): ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reset state when the dialog closes — both for cancel and
        // for dismissal after a successful create. The plaintext URL
        // is intentionally NOT preserved across opens.
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="text-primary-text size-4" />
                Invite created
              </DialogTitle>
              <DialogDescription>
                Share this link with your new teammate. They&apos;ll be able to
                sign up (or sign in) and join the account with the{' '}
                <span className="font-medium">
                  {ROLE_META[result.role].label}
                </span>{' '}
                role. The link is valid for{' '}
                <span className="font-medium">
                  {result.expiresInDays} day
                  {result.expiresInDays === 1 ? '' : 's'}
                </span>
                .
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <Label htmlFor="created-invite-link">Invite link</Label>
              <div className="flex gap-2">
                <Input
                  id="created-invite-link"
                  readOnly
                  value={result.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" onClick={copyToClipboard}>
                  <Copy className="size-4" />
                  Copy
                </Button>
              </div>

              <Alert>
                <AlertTriangle />
                <AlertTitle>Save this link now</AlertTitle>
                <AlertDescription>
                  UsefulDesk stores only a secure hash, so closing this dialog
                  removes your only copy. To share again later, use Copy link in
                  Pending invitations to create a fresh link.
                </AlertDescription>
              </Alert>

              {/* Anchor styled with `buttonVariants` rather than wrapping
                  in <Button asChild>. The wacrm Button is the Base UI
                  ButtonPrimitive — it has no Radix-style asChild slot.
                  Direct anchor preserves right-click "Open in new tab"
                  behaviour too. */}
              <a
                href={whatsappShareUrl(result.url)}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonVariants({
                  variant: 'outline',
                  className: 'w-full',
                })}
              >
                <MessageCircle className="size-4" />
                Send via WhatsApp
              </a>
            </div>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Invite a teammate</DialogTitle>
              <DialogDescription>
                Generate a one-time invite link. Share it via WhatsApp, Slack,
                or any channel you like — no email service required.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(v) => v && setRole(v as InviteRole)}
                >
                  <SelectTrigger
                    id="invite-role"
                    className="w-full"
                    aria-describedby="invite-role-description"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <p
                  id="invite-role-description"
                  className="text-muted-foreground text-xs"
                >
                  {ROLE_DESCRIPTIONS[role]}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-expiry">Link valid for</Label>
                <Select value={expiry} onValueChange={(v) => v && setExpiry(v)}>
                  <SelectTrigger id="invite-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-label">Label (optional)</Label>
                <Input
                  id="invite-label"
                  placeholder="e.g. Sara — support team"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={MAX_LABEL_LEN}
                />
                <p className="text-muted-foreground text-xs">
                  Helps you remember who you sent the link to in the pending
                  list below.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Generate link'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
