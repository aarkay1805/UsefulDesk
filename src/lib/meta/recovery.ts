import 'server-only';

import type { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  runMetaLeadEventRecovery,
  type MetaEventRecoveryResult,
  type MetaRecoveryNote,
} from '@/lib/meta/lead-event-recovery';
import {
  runMetaPageHealthRecovery,
  type MetaPageRecoveryResult,
} from '@/lib/meta/page-health-recovery';

export { mapWithConcurrency } from '@/lib/meta/recovery-concurrency';

type AdminClient = ReturnType<typeof supabaseAdmin>;

export interface MetaLeadRecoveryBody {
  events: Omit<MetaEventRecoveryResult, 'notes'>;
  pages: Omit<MetaPageRecoveryResult, 'notes'>;
  notes: MetaRecoveryNote[];
}

export async function runMetaLeadRecovery(args: {
  admin: AdminClient;
  dependencies?: {
    runEvents?: typeof runMetaLeadEventRecovery;
    runPages?: typeof runMetaPageHealthRecovery;
  };
}): Promise<{ ok: boolean; body: MetaLeadRecoveryBody }> {
  const runEvents = args.dependencies?.runEvents ?? runMetaLeadEventRecovery;
  const runPages = args.dependencies?.runPages ?? runMetaPageHealthRecovery;
  let ok = true;
  let events: MetaEventRecoveryResult = {
    claimed: 0,
    processed: 0,
    failed: 0,
    busy: 0,
    notes: [],
  };
  let pages: MetaPageRecoveryResult = {
    claimed: 0,
    healthy: 0,
    repaired: 0,
    attention: 0,
    failed: 0,
    notes: [],
  };

  try {
    events = await runEvents({ admin: args.admin });
  } catch {
    ok = false;
    events.failed = 1;
    events.notes.push({ phase: 'events', code: 'phase_failed' });
  }
  try {
    pages = await runPages({ admin: args.admin });
  } catch {
    ok = false;
    pages.failed = 1;
    pages.notes.push({ phase: 'pages', code: 'phase_failed' });
  }
  if (events.busy > 0 || pages.failed > 0) ok = false;

  const { notes: eventNotes, ...eventCounts } = events;
  const { notes: pageNotes, ...pageCounts } = pages;
  return {
    ok,
    body: {
      events: eventCounts,
      pages: pageCounts,
      notes: [...eventNotes, ...pageNotes],
    },
  };
}
