'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { canEditAuthoredContent } from '@/lib/auth/roles';

import {
  AutomationBuilder,
  fromServerSteps,
  type BuilderInitial,
  type ServerStepNode,
} from '@/components/automations/automation-builder';
import type { AutomationTriggerType } from '@/types';

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { user, accountRole, profileLoading } = useAuth();
  const [initial, setInitial] = useState<BuilderInitial | null>(null);
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/automations/${id}`);
      if (!res.ok) {
        if (!cancelled) setError(`Failed to load (${res.status})`);
        return;
      }
      const body = await res.json();
      if (cancelled) return;
      setInitial({
        id: body.automation.id,
        name: body.automation.name ?? '',
        description: body.automation.description ?? '',
        trigger_type: body.automation.trigger_type as AutomationTriggerType,
        trigger_config: body.automation.trigger_config ?? {},
        is_active: !!body.automation.is_active,
        steps: fromServerSteps((body.steps ?? []) as ServerStepNode[]),
      });
      setAuthorId(body.automation.user_id ?? null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-red-foreground text-sm">{error}</p>
        <button
          onClick={() => router.push('/automations')}
          className="text-primary-text hover:text-primary-text/80 text-sm"
        >
          Back to Automations
        </button>
      </div>
    );
  }

  if (!initial || profileLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="text-primary-text h-6 w-6 animate-spin" />
      </div>
    );
  }

  const canEdit = accountRole
    ? canEditAuthoredContent(accountRole, user?.id ?? null, authorId)
    : false;
  if (!canEdit) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-foreground text-sm font-medium">
          Only the automation author can edit or activate it.
        </p>
        <Button variant="outline" onClick={() => router.push('/automations')}>
          Back to Automations
        </Button>
      </div>
    );
  }

  return <AutomationBuilder initial={initial} />;
}
