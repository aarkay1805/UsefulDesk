'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { FlowEditorShell } from '@/components/flows/flow-editor-shell';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { canEditAuthoredContent } from '@/lib/auth/roles';
import type { FlowRow, FlowNodeRow } from '@/lib/flows/types';

/**
 * Flow editor shell.
 *
 * Loads `{flow, nodes}` from `/api/flows/[id]` and hands it to
 * `<FlowBuilder>`. Owns the loading/error state so the builder can
 * focus purely on editing.
 *
 * Open to every authenticated user — the beta gate that previously
 * 404'd non-beta accounts was removed in PR #134. The API still
 * 404s on a flow id the caller doesn't own (RLS), which becomes the
 * "Flow not found" state below.
 */
export default function FlowEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, accountRole, profileLoading } = useAuth();

  const [flow, setFlow] = useState<FlowRow | null>(null);
  const [nodes, setNodes] = useState<FlowNodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as {
          flow: FlowRow;
          nodes: FlowNodeRow[];
        };
        if (!cancelled) {
          setFlow(json.flow);
          setNodes(json.nodes ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flow.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loading || profileLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (notFound || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">Flow not found.</p>
        <button
          type="button"
          onClick={() => router.push('/flows')}
          className="text-primary-text text-sm hover:opacity-80"
        >
          ← Back to flows
        </button>
      </div>
    );
  }

  const canEdit = accountRole
    ? canEditAuthoredContent(accountRole, user?.id ?? null, flow.user_id)
    : false;
  if (!canEdit) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-foreground text-sm font-medium">
          Only the flow author can edit or activate it.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/flows')}>
            Back to flows
          </Button>
          <Button onClick={() => router.push(`/flows/${flow.id}/runs`)}>
            View runs
          </Button>
        </div>
      </div>
    );
  }

  return <FlowEditorShell initialFlow={flow} initialNodes={nodes} />;
}
