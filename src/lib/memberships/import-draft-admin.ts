import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  MEMBER_IMPORT_DRAFT_BUCKET,
  type MemberImportDraftRecord,
} from './import-draft';

let adminClient: SupabaseClient | null = null;

function memberImportDraftAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return adminClient;
}

export async function cleanupExpiredMemberImportDrafts(
  client: SupabaseClient = memberImportDraftAdmin(),
  limit = 50
): Promise<{ claimed: number; deleted: number; failed: number }> {
  const { data, error } = await client.rpc(
    'claim_expired_member_import_drafts',
    { p_limit: Math.min(Math.max(Math.trunc(limit), 1), 200) }
  );
  if (error) throw error;
  const drafts = (data as MemberImportDraftRecord[] | null) ?? [];
  let deleted = 0;
  let failed = 0;

  for (const draft of drafts) {
    const removal = await client.storage
      .from(MEMBER_IMPORT_DRAFT_BUCKET)
      .remove([draft.object_path]);
    if (removal.error && !/not.?found/i.test(removal.error.message)) {
      failed += 1;
      await client
        .from('member_import_drafts')
        .update({ status: 'active' })
        .eq('id', draft.id)
        .eq('status', 'cleanup');
      continue;
    }

    const result = await client
      .from('member_import_drafts')
      .delete()
      .eq('id', draft.id)
      .eq('status', 'cleanup')
      .select('id');
    if (result.error || !result.data?.length) {
      failed += 1;
    } else {
      deleted += 1;
    }
  }

  return { claimed: drafts.length, deleted, failed };
}
