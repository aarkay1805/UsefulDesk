import type { AutomationTriggerType } from '@/types';

export interface TriggerMeta {
  label: string;
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string;
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'New message',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-foreground',
  },
  first_inbound_message: {
    label: 'First message',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-foreground',
  },
  keyword_match: {
    label: 'Message has a word',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-foreground',
  },
  new_contact_created: {
    label: 'New person',
    pillClass: 'border-primary/30 bg-primary/10 text-primary-text',
  },
  conversation_assigned: {
    label: 'Chat assigned',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-foreground',
  },
  tag_added: {
    label: 'Tag added',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-foreground',
  },
  time_based: {
    label: 'On a schedule',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-foreground',
  },
};

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-foreground',
    }
  );
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
  if (diffSec < 2_592_000) return `${Math.floor(diffSec / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
}
