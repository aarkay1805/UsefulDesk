'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { usePendingNavigation } from '@/hooks/use-pending-navigation';
import {
  canDeleteAuthoredContent,
  canEditAuthoredContent,
} from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<FlowRow['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const STATUS_COLORS: Record<FlowRow['status'], string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  active: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-foreground',
  archived: 'border-border bg-muted/50 text-muted-foreground',
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: 'MessageSquare' | 'HelpCircle' | 'UserPlus';
  trigger_type: string;
  node_count: number;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

export default function FlowsPage() {
  const { navigate, isPending } = usePendingNavigation();
  const { user, accountRole } = useAuth();
  const canCreate = accountRole
    ? canEditAuthoredContent(accountRole, user?.id ?? null, user?.id ?? null)
    : false;
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null);
  const [deletingFlowId, setDeletingFlowId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes] = await Promise.all([
          fetch('/api/flows'),
          fetch('/api/flows/templates'),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const tmplJson = (await tmplRes.json()) as {
            templates: TemplateSummary[];
          };
          if (!cancelled) setTemplates(tmplJson.templates ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flows.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    let navigationStarted = false;
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: 'keyword',
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      navigate(`/flows/${json.flow.id}`);
      navigationStarted = true;
    } catch (err) {
      console.error(err);
      toast.error("Couldn't create flow.");
    } finally {
      if (!navigationStarted) setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    let navigationStarted = false;
    setCreating(true);
    setCreatingTemplate(slug);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Clone failed: ${res.status}`);
      }
      const json = (await res.json()) as { flow: FlowRow };
      navigate(`/flows/${json.flow.id}`);
      navigationStarted = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clone failed';
      toast.error(msg);
    } finally {
      if (!navigationStarted) {
        setCreating(false);
        setCreatingTemplate(null);
      }
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(
      `Delete "${flow.name}"? Any active runs will end immediately.`
    );
    if (!yes) return;
    setDeletingFlowId(flow.id);
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success('Flow deleted.');
    } catch (err) {
      console.error(err);
      toast.error("Couldn't delete flow.");
    } finally {
      setDeletingFlowId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-2xl font-semibold">Flows</h1>
            <Badge variant="warning" className="tracking-wide uppercase">
              Beta
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Build branching, button-driven WhatsApp conversations. Useful for
            menus, FAQs, and triage before a human steps in.
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create flows"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New flow
        </GatedButton>
      </header>

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          canCreate={canCreate}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              canEdit={
                accountRole
                  ? canEditAuthoredContent(
                      accountRole,
                      user?.id ?? null,
                      flow.user_id
                    )
                  : false
              }
              canDelete={
                accountRole
                  ? canDeleteAuthoredContent(
                      accountRole,
                      user?.id ?? null,
                      flow.user_id
                    )
                  : false
              }
              onEdit={() => navigate(`/flows/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
              editing={isPending(`/flows/${flow.id}`)}
              deleting={deletingFlowId === flow.id}
              deleteBlocked={deletingFlowId !== null}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent className="bg-popover text-popover-foreground sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Create a new flow</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Start from a template or build from scratch.
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Start from a template
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.icon] ?? FileText;
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => handleUseTemplate(t.slug)}
                      disabled={creating || !canCreate}
                      aria-busy={creatingTemplate === t.slug || undefined}
                      className="border-border bg-background hover:border-border-hover flex flex-col gap-2.5 rounded-lg border p-4 text-left transition-colors disabled:opacity-50"
                    >
                      {creatingTemplate === t.slug ? (
                        <Loader2
                          className="text-primary-text h-5 w-5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Icon className="text-primary-text h-5 w-5" />
                      )}
                      <span className="text-popover-foreground text-sm font-semibold">
                        {t.name}
                      </span>
                      <span className="text-muted-foreground text-xs leading-relaxed">
                        {t.description}
                      </span>
                      <span className="border-border text-muted-foreground mt-auto border-t pt-2 text-[11px]">
                        {t.node_count} {t.node_count === 1 ? 'node' : 'nodes'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-border space-y-2 border-t pt-4">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              Or start blank
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Welcome menu"
              className="bg-muted"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              loading={creating && creatingTemplate === null}
              disabled={!newName.trim() || creating}
            >
              Create blank flow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  canCreate,
}: {
  onCreate: () => void;
  canCreate: boolean;
}) {
  return (
    <div className="border-border bg-card/50 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="bg-muted flex h-14 w-14 items-center justify-center rounded-full">
        <Workflow className="text-muted-foreground h-6 w-6" />
      </div>
      <h2 className="text-foreground mt-4 text-base font-medium">
        No flows yet
      </h2>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">
        Build your first conversation — a welcome menu, an order lookup, an FAQ
        bot. Customers tap buttons; the bot routes them to the right answer (or
        the right agent).
      </p>
      <GatedButton
        canAct={canCreate}
        gateReason="create flows"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Create your first flow
      </GatedButton>
    </div>
  );
}

function FlowCard({
  flow,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  editing,
  deleting,
  deleteBlocked,
}: {
  flow: FlowRow;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  editing: boolean;
  deleting: boolean;
  deleteBlocked: boolean;
}) {
  const triggerSummary = describeTrigger(flow);
  const StatusIcon =
    flow.status === 'active'
      ? PlayCircle
      : flow.status === 'archived'
        ? Archive
        : PauseCircle;
  return (
    <div className="border-border bg-card hover:border-border-hover flex flex-col rounded-lg border p-4 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="text-primary-text h-4 w-4 shrink-0" />
          <h3 className="text-foreground truncate text-sm font-semibold">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 gap-1 text-[10px]',
            STATUS_COLORS[flow.status]
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS[flow.status]}
        </Badge>
      </div>

      <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">
        {flow.description || triggerSummary}
      </p>

      <div className="text-muted-foreground mt-4 flex items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {flow.execution_count} {flow.execution_count === 1 ? 'run' : 'runs'}
        </span>
      </div>

      <div className="border-border mt-4 flex items-center justify-end gap-2 border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          loading={editing}
          disabled={!canEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          variant="destructive-ghost"
          size="sm"
          onClick={onDelete}
          loading={deleting}
          disabled={!canDelete || deleteBlocked}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow): string {
  if (flow.trigger_type === 'keyword') {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return 'Triggers on keyword (none set)';
    return `Triggers on: ${keywords.join(', ')}`;
  }
  if (flow.trigger_type === 'first_inbound_message') {
    return "Triggers on a contact's first-ever inbound message";
  }
  return 'Manual trigger';
}
