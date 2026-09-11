import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  canCancelInvoiceCollectionCommitment,
  canCreateInvoiceCollectionCommitment,
  canEditInvoiceCollectionCommitment,
  canResolveInvoiceCollectionCommitment,
} from '@/lib/auth/roles';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(['promise_to_pay', 'verification_hold', 'dispute_hold']);

type CommitmentInput = {
  id?: unknown;
  kind?: unknown;
  amount?: unknown;
  promisedOn?: unknown;
  reason?: unknown;
  nextAction?: unknown;
  assignedTo?: unknown;
  revision?: unknown;
  action?: unknown;
};

function text(value: unknown, max = 500): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : null;
}

function parseInput(body: CommitmentInput) {
  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : null;
  const nextAction = text(body.nextAction);
  const assignedTo = typeof body.assignedTo === 'string' && body.assignedTo ? body.assignedTo : null;
  if (!kind || !nextAction || !assignedTo) return { error: 'Kind, next action, and assignee are required' } as const;
  if (kind === 'promise_to_pay') {
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Promise amount must be greater than zero' } as const;
    if (typeof body.promisedOn !== 'string' || !DATE.test(body.promisedOn)) return { error: 'A promised payment date is required' } as const;
    return { value: { kind, amount, promisedOn: body.promisedOn, reason: null, nextAction, assignedTo } } as const;
  }
  const reason = text(body.reason);
  if (!reason) return { error: 'A hold reason is required' } as const;
  return { value: { kind, amount: null, promisedOn: null, reason, nextAction, assignedTo } } as const;
}

async function invoiceInAccount(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  invoiceId: string
) {
  const { data, error } = await supabase.from('invoices').select('id').eq('id', invoiceId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

type RouteParams = { params: Promise<{ invoiceId: string }> };

export async function GET(_request: Request, context: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { invoiceId } = await context.params;
    if (!(await invoiceInAccount(ctx.supabase, invoiceId))) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    const { data, error } = await ctx.supabase
      .from('invoice_collection_commitments')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ commitments: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteParams) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requireRole('agent');
    if (!canCreateInvoiceCollectionCommitment(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { invoiceId } = await context.params;
    if (!(await invoiceInAccount(ctx.supabase, invoiceId))) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    const parsed = parseInput((await request.json()) as CommitmentInput);
    if ('error' in parsed) return NextResponse.json(parsed, { status: 400 });
    const { data, error } = await ctx.supabase.rpc('save_invoice_collection_commitment', {
      p_id: null, p_invoice_id: invoiceId, p_kind: parsed.value.kind, p_amount: parsed.value.amount,
      p_promised_on: parsed.value.promisedOn, p_reason: parsed.value.reason, p_next_action: parsed.value.nextAction,
      p_assigned_to: parsed.value.assignedTo, p_expected_revision: null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === '23505' ? 409 : 400 });
    return NextResponse.json({ commitment: data }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteParams) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requireRole('agent');
    const { invoiceId } = await context.params;
    const body = (await request.json()) as CommitmentInput;
    const id = typeof body.id === 'string' ? body.id : null;
    const revision = Number(body.revision);
    if (!id || !Number.isInteger(revision) || revision < 1) return NextResponse.json({ error: 'A current commitment revision is required' }, { status: 400 });
    const { data: existing, error: existingError } = await ctx.supabase
      .from('invoice_collection_commitments').select('id, created_by, invoice_id').eq('id', id).eq('invoice_id', invoiceId).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: 'Commitment not found' }, { status: 404 });
    if (body.action === 'resolve') {
      if (!canResolveInvoiceCollectionCommitment(ctx.role, ctx.userId, existing.created_by)) return NextResponse.json({ error: 'Only the author may resolve this commitment' }, { status: 403 });
      const { data, error } = await ctx.supabase.rpc('resolve_invoice_collection_commitment', { p_id: id, p_expected_revision: revision });
      if (error) return NextResponse.json({ error: error.message }, { status: error.code === '40001' ? 409 : 400 });
      return NextResponse.json({ commitment: data });
    }
    const parsed = parseInput(body);
    if ('error' in parsed) return NextResponse.json(parsed, { status: 400 });
    if (!canEditInvoiceCollectionCommitment(ctx.role, ctx.userId, existing.created_by)) return NextResponse.json({ error: 'Only the author may edit this commitment' }, { status: 403 });
    const { data, error } = await ctx.supabase.rpc('save_invoice_collection_commitment', {
      p_id: id, p_invoice_id: null, p_kind: parsed.value.kind, p_amount: parsed.value.amount,
      p_promised_on: parsed.value.promisedOn, p_reason: parsed.value.reason, p_next_action: parsed.value.nextAction,
      p_assigned_to: parsed.value.assignedTo, p_expected_revision: revision,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === '40001' ? 409 : 400 });
    return NextResponse.json({ commitment: data });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteParams) {
  try {
    requireSameOriginRequest(request);
    const ctx = await requireRole('agent');
    const { invoiceId } = await context.params;
    const body = (await request.json()) as CommitmentInput;
    const id = typeof body.id === 'string' ? body.id : null;
    const revision = Number(body.revision);
    if (!id || !Number.isInteger(revision) || revision < 1) return NextResponse.json({ error: 'A current commitment revision is required' }, { status: 400 });
    const { data: existing } = await ctx.supabase.from('invoice_collection_commitments').select('id, created_by').eq('id', id).eq('invoice_id', invoiceId).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Commitment not found' }, { status: 404 });
    if (!canCancelInvoiceCollectionCommitment(ctx.role, ctx.userId, existing.created_by)) return NextResponse.json({ error: 'Only the author or an admin may cancel this commitment' }, { status: 403 });
    const { data, error } = await ctx.supabase.rpc('cancel_invoice_collection_commitment', { p_id: id, p_expected_revision: revision });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === '40001' ? 409 : 400 });
    return NextResponse.json({ commitment: data });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
    return toErrorResponse(error);
  }
}
