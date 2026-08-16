import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  draftObjectPath,
  MEMBER_IMPORT_DRAFT_BUCKET,
  type MemberImportDraftRecord,
  type MemberImportDraftState,
  validateDraftState,
} from '@/lib/memberships/import-draft';
import {
  MAX_IMPORT_WORKBOOK_BYTES,
  memberImportFileKind,
} from '@/lib/memberships/import-workbook';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNED_URL_SECONDS = 5 * 60;

function emptyState(dateOrder: MemberImportDraftState['dateOrder']) {
  return {
    version: 1,
    step: 1,
    worksheet: null,
    mapping: [],
    dateOrder,
    recipe: null,
    candidates: [],
    resolutions: {},
    exclusions: [],
    receipt: null,
  } satisfies MemberImportDraftState;
}

function draftResponseStatus(code: string): number {
  if (code === 'draft_conflict') return 409;
  if (code === 'draft_expired') return 410;
  if (code === 'source_mismatch') return 422;
  return 404;
}

async function signedDraft(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  draft: MemberImportDraftRecord
) {
  const { data, error } = await supabase.storage
    .from(MEMBER_IMPORT_DRAFT_BUCKET)
    .createSignedUrl(draft.object_path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    return { ok: false as const, code: 'draft_unavailable' as const };
  }
  return {
    ok: true as const,
    draft,
    signed_url: data.signedUrl,
    signed_url_expires_in: SIGNED_URL_SECONDS,
  };
}

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const { data, error } = await ctx.supabase
      .from('member_import_drafts')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('author_id', ctx.userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('saved_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { ok: false, code: 'draft_unavailable' },
        { status: 500 }
      );
    }
    if (!data) return NextResponse.json({ ok: true, draft: null });
    const result = await signedDraft(
      ctx.supabase,
      data as MemberImportDraftRecord
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'source_mismatch',
          error: 'Choose a CSV or XLSX file',
        },
        { status: 400 }
      );
    }
    const sourceKind = memberImportFileKind(file.name);
    if (
      !sourceKind ||
      file.size <= 0 ||
      file.size > MAX_IMPORT_WORKBOOK_BYTES
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: 'source_mismatch',
          error: 'Invalid import workbook',
        },
        { status: 400 }
      );
    }
    const dateOrderValue = form.get('date_order');
    const dateOrder = dateOrderValue === 'MDY' ? dateOrderValue : 'DMY';
    const stateValue = form.get('state');
    let state: unknown = emptyState(dateOrder);
    if (typeof stateValue === 'string' && stateValue.trim()) {
      try {
        state = JSON.parse(stateValue);
      } catch {
        return NextResponse.json(
          { ok: false, code: 'invalid_state' },
          { status: 400 }
        );
      }
    }
    const validation = validateDraftState(state);
    if (!validation.ok) {
      return NextResponse.json(validation, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sourceHash = createHash('sha256').update(bytes).digest('hex');
    const draftId = randomUUID();
    const objectPath = draftObjectPath(
      ctx.accountId,
      ctx.userId,
      draftId,
      file.name
    );
    const contentType =
      sourceKind === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv';
    const upload = await ctx.supabase.storage
      .from(MEMBER_IMPORT_DRAFT_BUCKET)
      .upload(objectPath, bytes, { contentType, upsert: false });
    if (upload.error) {
      return NextResponse.json(
        { ok: false, code: 'draft_unavailable' },
        { status: 500 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('member_import_drafts')
      .insert({
        id: draftId,
        account_id: ctx.accountId,
        author_id: ctx.userId,
        source_filename: file.name,
        source_kind: sourceKind,
        source_size: file.size,
        source_sha256: sourceHash,
        object_path: objectPath,
        selected_worksheet: validation.state.worksheet,
        wizard_step: String(validation.state.step),
        mapping: validation.state.mapping,
        date_order: validation.state.dateOrder,
        recipe_metadata: validation.state.recipe,
        state: validation.state,
      })
      .select('*')
      .maybeSingle();
    if (error || !data) {
      await ctx.supabase.storage
        .from(MEMBER_IMPORT_DRAFT_BUCKET)
        .remove([objectPath]);
      return NextResponse.json(
        { ok: false, code: 'draft_conflict' },
        { status: 409 }
      );
    }
    const result = await signedDraft(
      ctx.supabase,
      data as MemberImportDraftRecord
    );
    return NextResponse.json(result, { status: result.ok ? 201 : 500 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      revision?: unknown;
      state?: unknown;
    } | null;
    if (
      !body ||
      typeof body.id !== 'string' ||
      !UUID.test(body.id) ||
      typeof body.revision !== 'number' ||
      !Number.isInteger(body.revision) ||
      body.revision < 1
    ) {
      return NextResponse.json(
        { ok: false, code: 'draft_unavailable' },
        { status: 400 }
      );
    }
    const validation = validateDraftState(body.state);
    if (!validation.ok) {
      return NextResponse.json(validation, { status: 400 });
    }
    const { data, error } = await ctx.supabase.rpc('save_member_import_draft', {
      p_draft_id: body.id,
      p_expected_revision: body.revision,
      p_state: validation.state,
    });
    if (error || !data) {
      return NextResponse.json(
        { ok: false, code: 'draft_unavailable' },
        { status: 500 }
      );
    }
    const result = data as {
      ok: boolean;
      code?: string;
      revision?: number;
      saved_at?: string;
      expires_at?: string;
    };
    return NextResponse.json(result, {
      status: result.ok ? 200 : draftResponseStatus(result.code ?? ''),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const url = new URL(request.url);
    const requestedId = url.searchParams.get('id');
    let query = ctx.supabase
      .from('member_import_drafts')
      .select('id, object_path')
      .eq('account_id', ctx.accountId)
      .eq('author_id', ctx.userId)
      .eq('status', 'active');
    if (requestedId) {
      if (!UUID.test(requestedId)) {
        return NextResponse.json(
          { ok: false, code: 'draft_unavailable' },
          { status: 400 }
        );
      }
      query = query.eq('id', requestedId);
    }
    const { data: draft, error } = await query.maybeSingle();
    if (error) {
      return NextResponse.json(
        { ok: false, code: 'draft_unavailable' },
        { status: 500 }
      );
    }
    if (!draft) return NextResponse.json({ ok: true, discarded: false });

    const removal = await ctx.supabase.storage
      .from(MEMBER_IMPORT_DRAFT_BUCKET)
      .remove([draft.object_path]);
    if (removal.error && !/not.?found/i.test(removal.error.message)) {
      return NextResponse.json(
        { ok: false, code: 'draft_unavailable' },
        { status: 500 }
      );
    }
    const deleted = await ctx.supabase
      .from('member_import_drafts')
      .delete()
      .eq('id', draft.id)
      .eq('author_id', ctx.userId)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (deleted.error || !deleted.data?.length) {
      return NextResponse.json(
        { ok: false, code: 'draft_unavailable' },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, discarded: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
