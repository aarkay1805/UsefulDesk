'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  FileText,
  MessageCircle,
  Clock,
  Users,
  PhoneCall,
  Loader2,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { usePendingNavigation } from '@/hooks/use-pending-navigation';
import {
  canDeleteAuthoredContent,
  canEditAuthoredContent,
} from '@/lib/auth/roles';
import type { Automation } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AUTOMATION_TEMPLATES,
  type TemplateSlug,
} from '@/lib/automations/templates';
import { triggerMeta, formatRelative } from '@/lib/automations/trigger-meta';
import { cn } from '@/lib/utils';

const TEMPLATE_ORDER: TemplateSlug[] = [
  'welcome_message',
  'out_of_office',
  'lead_qualifier',
  'follow_up_reminder',
];

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  out_of_office: Clock,
  lead_qualifier: Users,
  follow_up_reminder: PhoneCall,
};

export default function AutomationsPage() {
  const { navigate, isPending } = usePendingNavigation();
  const { user, accountRole } = useAuth();
  const canCreate = accountRole
    ? canEditAuthoredContent(accountRole, user?.id ?? null, user?.id ?? null)
    : false;
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function load() {
    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      setAutomations((data ?? []) as Automation[]);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load automations'
      );
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleActive(a: Automation, next: boolean) {
    // Optimistic flip so the switch feels instant.
    setAutomations(
      (prev) =>
        prev?.map((x) => (x.id === a.id ? { ...x, is_active: next } : x)) ??
        prev
    );
    const res = await fetch(`/api/automations/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      // Roll back on error.
      setAutomations(
        (prev) =>
          prev?.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x)) ??
          prev
      );
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? 'Failed to update');
      return;
    }
    toast.success(next ? 'Automation activated' : 'Automation paused');
  }

  async function duplicate(a: Automation) {
    setDuplicatingId(a.id);
    try {
      const res = await fetch(`/api/automations/${a.id}/duplicate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? 'Failed to duplicate');
        return;
      }
      toast.success('Automation duplicated');
      await load();
    } finally {
      setDuplicatingId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/automations/${pendingDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? 'Failed to delete');
        return;
      }
      toast.success('Automation deleted');
      setPendingDelete(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function retryLoad() {
    setRetrying(true);
    try {
      await load();
    } finally {
      setRetrying(false);
    }
  }

  function startFromTemplate(slug: TemplateSlug) {
    navigate(`/automations/new?template=${slug}`);
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-red-foreground text-sm">{error}</p>
        <Button variant="outline" onClick={retryLoad} loading={retrying}>
          Retry
        </Button>
      </div>
    );
  }

  if (automations === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary-text h-6 w-6 animate-spin" />
      </div>
    );
  }

  const showTemplates = automations.length < 3;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Automations</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Build workflows that react to WhatsApp® events automatically.
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create automations"
          onClick={() => navigate('/automations/new')}
          loading={isPending('/automations/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Create Automation
        </GatedButton>
      </div>

      {showTemplates && (
        <section>
          <h2 className="text-muted-foreground mb-3 text-sm font-semibold">
            Quick-start templates
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {TEMPLATE_ORDER.map((slug) => {
              const t = AUTOMATION_TEMPLATES[slug];
              const Icon = TEMPLATE_ICON[slug];
              return (
                <button
                  key={slug}
                  onClick={() => startFromTemplate(slug)}
                  disabled={
                    !canCreate || isPending(`/automations/new?template=${slug}`)
                  }
                  aria-busy={
                    isPending(`/automations/new?template=${slug}`) || undefined
                  }
                  className="group border-border bg-card hover:border-border-hover flex flex-col items-start rounded-xl border p-4 text-left transition-colors"
                >
                  <div className="bg-primary/10 text-primary-text group-hover:bg-primary/15 mb-3 flex h-9 w-9 items-center justify-center rounded-lg">
                    {isPending(`/automations/new?template=${slug}`) ? (
                      <Loader2
                        className="h-5 w-5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <div className="text-foreground text-sm font-semibold">
                    {t.name}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {automations.length === 0 ? (
        <div className="border-border bg-card/40 flex h-48 flex-col items-center justify-center rounded-xl border border-dashed">
          <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl">
            <Zap className="text-primary-text h-6 w-6" />
          </div>
          <p className="text-foreground mt-3 text-sm font-medium">
            No automations yet
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Pick a template above or create one from scratch.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {automations.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              canEdit={
                accountRole
                  ? canEditAuthoredContent(
                      accountRole,
                      user?.id ?? null,
                      a.user_id
                    )
                  : false
              }
              canDuplicate={canCreate}
              canDelete={
                accountRole
                  ? canDeleteAuthoredContent(
                      accountRole,
                      user?.id ?? null,
                      a.user_id
                    )
                  : false
              }
              onToggle={(next) => toggleActive(a, next)}
              onEdit={() => navigate(`/automations/${a.id}/edit`)}
              onDuplicate={() => duplicate(a)}
              onLogs={() => navigate(`/automations/${a.id}/logs`)}
              onDelete={() => setPendingDelete(a)}
              editing={isPending(`/automations/${a.id}/edit`)}
              viewingLogs={isPending(`/automations/${a.id}/logs`)}
              duplicating={duplicatingId === a.id}
              duplicateBlocked={duplicatingId !== null}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete automation</DialogTitle>
            <DialogDescription>
              This permanently removes{' '}
              <span className="text-foreground">{pendingDelete?.name}</span> and
              its execution history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              loading={deleting}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutomationCard({
  automation,
  canEdit,
  canDuplicate,
  canDelete,
  onToggle,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
  editing,
  viewingLogs,
  duplicating,
  duplicateBlocked,
}: {
  automation: Automation;
  canEdit: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onLogs: () => void;
  onDelete: () => void;
  editing: boolean;
  viewingLogs: boolean;
  duplicating: boolean;
  duplicateBlocked: boolean;
}) {
  const meta = triggerMeta(automation.trigger_type);
  return (
    <li className="border-border bg-card hover:border-border-hover rounded-xl border transition-colors">
      <div className="flex items-center gap-4 p-4">
        <div
          className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
          aria-hidden
        >
          <Zap className="text-primary-text h-5 w-5" />
        </div>

        <button
          type="button"
          onClick={onEdit}
          disabled={!canEdit || editing}
          aria-busy={editing || undefined}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            {editing ? (
              <Loader2
                className="text-primary-text h-4 w-4 shrink-0 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            <span className="text-foreground truncate text-sm font-semibold">
              {automation.name}
            </span>
            {automation.is_active && (
              <span className="relative flex h-2 w-2" aria-label="active">
                <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                <span className="bg-primary relative inline-flex h-2 w-2 rounded-full" />
              </span>
            )}
          </div>
          {automation.description && (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {automation.description}
            </p>
          )}
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                meta.pillClass
              )}
            >
              {meta.label}
            </span>
            <span className="tabular-nums">
              {automation.execution_count} run
              {automation.execution_count === 1 ? '' : 's'}
            </span>
            <span aria-hidden>·</span>
            <span>last {formatRelative(automation.last_executed_at)}</span>
          </div>
        </button>

        <div className="flex items-center gap-3">
          <Switch
            checked={automation.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={automation.is_active ? 'Deactivate' : 'Activate'}
            disabled={!canEdit}
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Open menu"
              aria-busy={duplicating || viewingLogs || undefined}
              disabled={duplicateBlocked || viewingLogs}
              className="text-muted-foreground hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
            >
              {duplicating || viewingLogs ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <MoreVertical className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit} disabled={!canEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDuplicate}
                disabled={!canDuplicate || duplicateBlocked}
              >
                <Copy className="h-4 w-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogs}>
                <FileText className="h-4 w-4" />
                View Logs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={onDelete}
                disabled={!canDelete}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
