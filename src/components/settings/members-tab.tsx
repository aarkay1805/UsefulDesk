'use client';

// ============================================================
// MembersTab — Settings → Members
//
// Two stacked sections:
//   1. Roster   — every member of the account. Admin+ can change a
//                 teammate's role inline and remove them. Owner row
//                 is non-editable everywhere (transfer is its own
//                 separate flow, deferred to a later PR).
//   2. Pending  — outstanding invite links. Admin+ can revoke. The
//                 plaintext URL is gone after the create dialog
//                 closes, so we surface a "revoke + new link" hint
//                 rather than pretending we can resurface it.
//
// Role-gating
//   The tab itself is reachable by any member, but mutation buttons
//   are wrapped in `<RequireRole min="admin">` / `useCan` so an
//   agent or viewer sees the roster read-only. The server-side
//   RPCs (set_member_role, remove_account_member) double-check
//   the role anyway.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Link2,
  Loader2,
  Mail,
  MailX,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react';

import { AvatarBadge } from '@/components/ui/avatar';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { usePresence } from '@/hooks/use-presence';
import type { AccountRole } from '@/lib/auth/roles';
import { presenceLabel, summarize } from '@/lib/presence';
import {
  PRESENCE_DOT_CLASS,
  PresenceDot,
} from '@/components/presence/presence-dot';
import { InviteMemberDialog } from './invite-member-dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { ROLE_META } from './role-meta';
import { SettingsChip } from './settings-chip';

interface Member {
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  role: AccountRole;
  joined_at: string;
}

interface Invitation {
  id: string;
  role: 'admin' | 'agent' | 'viewer';
  label: string | null;
  /** Display name of the invited person (set by lead-import; migration 049). */
  full_name: string | null;
  created_at: string;
  expires_at: string;
}

// Editable roles in the inline dropdown. Owner is never an option —
// promotions go through the (deferred) Transfer Ownership flow.
const EDITABLE_ROLES: { value: AccountRole; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admin', hint: 'Manage members + everything' },
  { value: 'agent', label: 'Agent', hint: 'Use features; no settings' },
  { value: 'viewer', label: 'Viewer', hint: 'Read-only across the app' },
];

// Per-role chip metadata (icon / label / colour) lives in the shared
// ROLE_META module so this roster and the Overview identity chip can't
// drift. The colour scale runs amber (owner — scarce, immutable) →
// primary (admin) → muted (agent / viewer).

function fmtExpiresIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `expires in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  return `expires in ${hours} hour${hours === 1 ? '' : 's'}`;
}

export function MembersTab() {
  const { user, canManageMembers } = useAuth();
  const { fmt } = useLocale();
  const { getPresence, getRow, now } = usePresence();

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  const [pendingMemberAction, setPendingMemberAction] = useState<string | null>(
    null
  );
  const [revokingInvitationId, setRevokingInvitationId] = useState<
    string | null
  >(null);

  const loadEverything = useCallback(async () => {
    try {
      const [mres, ires] = await Promise.all([
        fetch('/api/account/members', { cache: 'no-store' }),
        canManageMembers
          ? fetch('/api/account/invitations', { cache: 'no-store' })
          : Promise.resolve(null),
      ]);

      if (!mres.ok) {
        const payload = await mres.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load members');
        return;
      }
      const mdata = (await mres.json()) as { members: Member[] };
      setMembers(mdata.members);

      if (ires) {
        if (!ires.ok) {
          const payload = await ires.json().catch(() => ({}));
          toast.error(payload.error || 'Failed to load invitations');
          return;
        }
        const idata = (await ires.json()) as { invitations: Invitation[] };
        setInvitations(idata.invitations);
      } else {
        setInvitations([]);
      }
    } catch (err) {
      console.error('[MembersTab] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, [canManageMembers]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await loadEverything();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadEverything]);

  async function handleRoleChange(member: Member, nextRole: AccountRole) {
    if (member.role === nextRole) return;
    // Optimistic update — flip the dropdown immediately so the UI
    // feels snappy. If the server PATCH fails we revert below so
    // the dropdown doesn't lie about the persisted state.
    const previousRole = member.role;
    setPendingMemberAction(member.user_id);
    setMembers((prev) =>
      prev.map((m) =>
        m.user_id === member.user_id ? { ...m, role: nextRole } : m
      )
    );
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        // Revert the optimistic flip. The toast on its own wasn't
        // enough — the dropdown was left showing the new role
        // forever, so the next interaction operated on a wrong
        // baseline (re-trying the same change would no-op via the
        // `member.role === nextRole` guard at the top).
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === member.user_id ? { ...m, role: previousRole } : m
          )
        );
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to update role');
        return;
      }
      toast.success(`Updated ${member.full_name || 'member'} to ${nextRole}`);
    } catch (err) {
      // Same revert on network failure.
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === member.user_id ? { ...m, role: previousRole } : m
        )
      );
      console.error('[MembersTab] role change error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPendingMemberAction(null);
    }
  }

  async function handleRemove() {
    if (!removingMember) return;
    setPendingMemberAction(removingMember.user_id);
    try {
      const res = await fetch(
        `/api/account/members/${removingMember.user_id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to remove member');
        return;
      }
      toast.success(`Removed ${removingMember.full_name || 'member'}`);
      setMembers((prev) =>
        prev.filter((m) => m.user_id !== removingMember.user_id)
      );
      setRemovingMember(null);
    } catch (err) {
      console.error('[MembersTab] remove error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPendingMemberAction(null);
    }
  }

  async function handleRevoke(invite: Invitation) {
    setRevokingInvitationId(invite.id);
    try {
      const res = await fetch(`/api/account/invitations/${invite.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to revoke invitation');
        return;
      }
      toast.success('Invitation revoked');
      setInvitations((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      console.error('[MembersTab] revoke error:', err);
      toast.error('Could not reach the server');
    } finally {
      setRevokingInvitationId(null);
    }
  }

  // Mint a fresh link for a pending invite and copy it. Rotating the token
  // invalidates any previously shared link for this invite — the toast says
  // so. Needed because invite tokens are stored hashed (never re-derivable),
  // and import-created invites never surfaced a link at creation time.
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  async function handleCopyLink(invite: Invitation) {
    setLinkingId(invite.id);
    try {
      const res = await fetch(`/api/account/invitations/${invite.id}/link`, {
        method: 'POST',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to generate link');
        return;
      }
      const { url } = (await res.json()) as { url: string };
      try {
        await navigator.clipboard.writeText(url);
        setCopiedId(invite.id);
        window.setTimeout(() => setCopiedId(null), 2000);
        toast.success(
          'Invite link copied — this replaces any link shared before.'
        );
      } catch {
        // Clipboard blocked (insecure context / permissions) — show the URL.
        toast.message('Invite link (copy it):', { description: url });
      }
    } catch (err) {
      console.error('[MembersTab] copy-link error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLinkingId(null);
    }
  }

  const presenceCounts = summarize(
    members.map((member) => getPresence(member.user_id))
  );

  return (
    <section className="animate-in fade-in-50 max-w-3xl space-y-6 duration-200 motion-reduce:animate-none">
      <SettingsPanelHead
        title="Team members"
        description="People with access to this account. Roles control what each teammate can do."
        action={
          <RequireRole min="admin">
            <Button onClick={() => setInviteOpen(true)}>
              <Plus className="size-4" />
              Invite member
            </Button>
          </RequireRole>
        }
      />

      {loading ? (
        <Card>
          <CardContent
            className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
            role="status"
          >
            <Loader2 className="text-primary-text size-5 animate-spin" />
            Loading team members...
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Roster */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <UsersRound className="text-primary-text size-4" />
                Current team
                <Badge variant="neutral" size="count">
                  {members.length}
                </Badge>
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <PresenceDot status="online" />
                  {presenceCounts.online} online
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <PresenceDot status="away" />
                  {presenceCounts.away} away
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <PresenceDot status="offline" />
                  {presenceCounts.offline} offline
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-border divide-y">
                {members.map((member) => {
                  const roleMeta = ROLE_META[member.role];
                  const RoleIcon = roleMeta.icon;
                  const isSelf = member.user_id === user?.id;
                  const isOwnerRow = member.role === 'owner';
                  const isBusy = pendingMemberAction === member.user_id;
                  const presence = getPresence(member.user_id);
                  const presenceRow = getRow(member.user_id);
                  const presenceText = presenceLabel(
                    presence,
                    presenceRow?.last_seen_at ?? null,
                    now
                  );

                  return (
                    <li
                      key={member.user_id}
                      // Mobile: stack identity (avatar+name+email) above the
                      // role/remove actions so the role dropdown's fixed
                      // 128px width doesn't force the name into a 50-pixel
                      // truncation. Desktop (sm+): everything inline as
                      // before.
                      className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <UserAvatar
                                className="size-10 shrink-0"
                                name={member.full_name || member.email || 'U'}
                                src={member.avatar_url}
                              >
                                {/* role+label so screen readers announce
                                presence — the hover tooltip alone isn't
                                reachable by keyboard/AT on a non-focusable
                                avatar. */}
                                <AvatarBadge
                                  role="img"
                                  aria-label={presenceText}
                                  className={PRESENCE_DOT_CLASS[presence]}
                                />
                              </UserAvatar>
                            }
                          />
                          <TooltipContent>{presenceText}</TooltipContent>
                        </Tooltip>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground truncate text-sm font-medium">
                              {member.full_name || 'Unnamed'}
                            </span>
                            {isSelf && <Badge variant="neutral">You</Badge>}
                          </div>
                          {member.email && (
                            <p className="text-muted-foreground truncate text-xs">
                              {member.email}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Joined date stays desktop-only. The mobile row's
                      vertical density makes the joined date noise. */}
                      <div className="text-muted-foreground hidden text-right text-xs sm:block">
                        Joined {fmt.date(member.joined_at)}
                      </div>

                      {/* Actions cluster. On mobile this is its own row
                      below the identity block; on desktop it sits
                      inline. Items align to the start on mobile so the
                      role dropdown lines up under the avatar. */}
                      <div className="flex items-center gap-2 pl-[3.25rem] sm:gap-3 sm:pl-0">
                        {/* Role display / editor. Inline Select is admin+
                        only AND not allowed on the owner row (owner
                        changes go through transfer, which lands later). */}
                        {canManageMembers && !isOwnerRow && !isSelf ? (
                          <Select
                            value={member.role}
                            onValueChange={(v) =>
                              // Base UI Select can emit null on clear. We
                              // don't expose a clear affordance, so the
                              // guard is defensive — but the typed
                              // signature requires it.
                              v && handleRoleChange(member, v as AccountRole)
                            }
                          >
                            <SelectTrigger
                              className="w-32"
                              disabled={isBusy}
                              aria-label={`Role for ${member.full_name || member.email || 'team member'}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {EDITABLE_ROLES.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <SettingsChip variant={roleMeta.variant}>
                            <RoleIcon />
                            {roleMeta.label}
                          </SettingsChip>
                        )}

                        {/* Remove. Admin+ only; never on the owner row or yourself. */}
                        {canManageMembers && !isOwnerRow && !isSelf && (
                          <Button
                            variant="destructive-ghost"
                            size="icon-sm"
                            onClick={() => setRemovingMember(member)}
                            disabled={isBusy}
                            aria-label={`Remove ${member.full_name || member.email}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {/* Pending invitations — admin+ only */}
          <RequireRole min="admin">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <Mail className="text-primary-text size-4" />
                  Pending invitations
                  <Badge variant="neutral" size="count">
                    {invitations.length}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {invitations.length > 0
                    ? 'Copy link creates a fresh link and invalidates the previous one. Share only the newest link.'
                    : 'Invite links stay here until a teammate joins or you revoke them.'}
                </CardDescription>
              </CardHeader>

              {invitations.length === 0 ? (
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                  <span className="bg-muted flex size-10 items-center justify-center rounded-full">
                    <Mail className="text-muted-foreground size-5" />
                  </span>
                  <p className="mt-3 text-sm font-medium">
                    No pending invitations
                  </p>
                  <p className="text-muted-foreground mt-1 max-w-sm text-xs">
                    New invite links will appear here until they are used or
                    revoked.
                  </p>
                </CardContent>
              ) : (
                <CardContent className="p-0">
                  <ul className="divide-border divide-y">
                    {invitations.map((inv) => {
                      const inviteRoleMeta = ROLE_META[inv.role];
                      const InviteRoleIcon = inviteRoleMeta.icon;
                      return (
                        <li
                          key={inv.id}
                          className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {inv.full_name ||
                                  inv.label ||
                                  'Untitled invite'}
                              </span>
                              <SettingsChip variant={inviteRoleMeta.variant}>
                                <InviteRoleIcon />
                                {inviteRoleMeta.label}
                              </SettingsChip>
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                              Created {fmt.date(inv.created_at)} ·{' '}
                              {fmtExpiresIn(inv.expires_at)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 sm:shrink-0">
                            {/* Copy link rotates the token, so the freshest
                                copy is the only working link. */}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={linkingId === inv.id}
                              onClick={() => handleCopyLink(inv)}
                              className="flex-1 sm:flex-none"
                            >
                              {linkingId === inv.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : copiedId === inv.id ? (
                                <Check className="text-emerald-foreground size-4" />
                              ) : (
                                <Link2 className="size-4" />
                              )}
                              {copiedId === inv.id ? 'Copied' : 'Copy link'}
                            </Button>

                            <Button
                              variant="destructive-ghost"
                              size="sm"
                              onClick={() => handleRevoke(inv)}
                              loading={revokingInvitationId === inv.id}
                              disabled={revokingInvitationId !== null}
                              className="flex-1 sm:flex-none"
                            >
                              <MailX className="size-4" />
                              Revoke
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              )}
            </Card>
          </RequireRole>
        </>
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={loadEverything}
      />

      <Dialog
        open={removingMember !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingMember(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-amber-foreground size-4" />
              Remove member
            </DialogTitle>
            <DialogDescription>
              Remove{' '}
              <span className="font-medium">
                {removingMember?.full_name || 'this teammate'}
              </span>{' '}
              from the account? They&apos;ll be signed out of this account and
              given a fresh personal account on their next sign-in. Their login
              isn&apos;t deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovingMember(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={!!pendingMemberAction}
            >
              {pendingMemberAction ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove member'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
