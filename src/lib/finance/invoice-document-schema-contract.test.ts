import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260824235600_immutable_invoice_documents.sql'
);

describe('immutable invoice document migration contract', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('stores one constrained lease-backed document per invoice', () => {
    expect(sql).toContain("'generating'");
    expect(sql).toContain("'ready'");
    expect(sql).toContain("'failed'");
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS public.invoice_documents'
    );
    expect(sql).toContain('UNIQUE (invoice_id)');
    expect(sql).toMatch(/payload_snapshot JSONB NOT NULL/i);
    expect(sql).toMatch(/storage_path TEXT NOT NULL/i);
    expect(sql).toMatch(/generation_token UUID NOT NULL/i);
    expect(sql).toMatch(/generation_expires_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/sha256 ~ '\^\[0-9a-f\]\{64\}\$'/i);
    expect(sql).toMatch(/byte_count > 0/i);
    expect(sql).toContain('invoice_documents_storage_path_deterministic');
    expect(sql).toContain('payload_snapshot @> \'{"format_version": 1}\'');
  });

  it('makes payload and deterministic-path checks total for malformed JSON', () => {
    const table = sql.match(
      /CREATE TABLE IF NOT EXISTS public\.invoice_documents \([\s\S]*?\n\);/i
    )?.[0];

    expect(table).toBeDefined();
    expect(table).toMatch(
      /COALESCE\(\s*jsonb_typeof\(payload_snapshot->'lines'\) = 'array',\s*FALSE\s*\)/i
    );
    expect(table).toMatch(
      /COALESCE\(\s*jsonb_array_length\(payload_snapshot->'lines'\),\s*0\s*\) > 0/i
    );
    expect(table).toMatch(
      /COALESCE\(\s*jsonb_typeof\(payload_snapshot->'invoice_number'\) = 'string',\s*FALSE\s*\)/i
    );
    expect(table).toMatch(
      /length\(btrim\(COALESCE\(\s*payload_snapshot->>'invoice_number',\s*''\s*\)\)\) > 0/i
    );
    expect(table).toMatch(
      /COALESCE\(\s*storage_path =[\s\S]*?\.pdf'\s*,\s*FALSE\s*\)/i
    );
  });

  it('reserves only eligible invoices and authors the immutable V1 payload in SQL', () => {
    const reserve = sql.match(
      /CREATE OR REPLACE FUNCTION public\.reserve_invoice_document\([\s\S]*?\n\$\$;/i
    )?.[0];

    expect(reserve).toBeDefined();
    expect(reserve).toMatch(
      /RETURNS TABLE \(\s*outcome TEXT,\s*document_id UUID,\s*document_status public\.invoice_document_status,\s*generation_token UUID,\s*payload_snapshot JSONB,\s*storage_path TEXT,\s*sha256 TEXT,\s*byte_count BIGINT,\s*last_error TEXT\s*\)/i
    );
    for (const output of [
      'outcome',
      'document_id',
      'document_status',
      'generation_token',
      'payload_snapshot',
      'storage_path',
      'sha256',
      'byte_count',
      'last_error',
    ]) {
      expect(reserve).toContain(output);
    }

    expect(reserve).toContain('FOR UPDATE');
    expect(reserve).toMatch(/status = 'ready'/i);
    expect(reserve).toMatch(
      /status = 'generating'[\s\S]*generation_expires_at > NOW\(\)/i
    );
    expect(reserve).toMatch(/status IN \('failed', 'generating'\)/i);
    expect(reserve).toMatch(/state = 'void'/i);
    expect(reserve).toContain('requires_refund_review');
    expect(reserve).toContain('invoice_number IS NULL');
    expect(reserve).toContain('seller_snapshot IS NULL');
    expect(reserve).toContain('customer_snapshot IS NULL');
    expect(reserve).toContain("IS DISTINCT FROM 'object'");
    expect(reserve).toMatch(/line\.state = 'active'/i);
    expect(reserve).toContain("'format_version', 1");
    expect(reserve).toContain("'invoice_number'");
    expect(reserve).toContain("'issued_at'");
    expect(reserve).toContain("'currency'");
    expect(reserve).toContain("'seller'");
    expect(reserve).toContain("'customer'");
    expect(reserve).toContain("'lines'");
    expect(reserve).toContain("'subtotal_minor'");
    expect(reserve).toContain("'adjustments_minor'");
    expect(reserve).toContain("'total_minor'");
    expect(reserve).toMatch(/ROUND\(line\.unit_amount \* 100\)::BIGINT/i);
    expect(reserve).toMatch(/ROUND\(line\.line_amount \* 100\)::BIGINT/i);
    expect(reserve).toContain("'account-' || v_invoice.account_id::TEXT");
    expect(reserve).toContain(
      "'/invoice-' || v_invoice.invoice_number || '.pdf'"
    );
    expect(reserve.indexOf("v_document.status = 'ready'")).toBeLessThan(
      reserve.indexOf("v_invoice.state = 'void'")
    );
    expect(reserve.indexOf("v_document.status = 'generating'")).toBeLessThan(
      reserve.indexOf("v_invoice.state = 'void'")
    );
    expect(reserve).toContain(
      'v_adjustments_minor := -v_adjustment_amount_minor'
    );
    expect(reserve).toContain(
      'v_total_minor := v_subtotal_minor + v_adjustments_minor'
    );

    const payloadBuilder = reserve.match(
      /v_payload := jsonb_build_object\([\s\S]*?\n  \);/i
    )?.[0];
    expect(payloadBuilder).toBeDefined();
    for (const mutableKey of [
      'balance',
      'paid',
      'payment',
      'credit',
      'refund',
      'contact',
      'membership',
    ]) {
      expect(payloadBuilder).not.toContain(`'${mutableKey}'`);
      expect(payloadBuilder).not.toContain(`'${mutableKey}_minor'`);
    }

    for (const mutableSource of [
      'public.payments',
      'public.payment_allocations',
      'public.invoice_credit_allocations',
      'public.payment_refunds',
      'public.contacts',
      'public.memberships',
      'public.invoice_profiles',
    ]) {
      expect(reserve).not.toContain(mutableSource);
    }

    expect(reserve).toMatch(
      /SELECT COALESCE\(balance\.requires_refund_review, FALSE\)[\s\S]*FROM public\.invoice_balances balance/i
    );
  });

  it('binds finalize and retryable failure transitions to the active token', () => {
    const finalize = sql.match(
      /CREATE OR REPLACE FUNCTION public\.finalize_invoice_document\([\s\S]*?\n\$\$;/i
    )?.[0];
    const fail = sql.match(
      /CREATE OR REPLACE FUNCTION public\.fail_invoice_document\([\s\S]*?\n\$\$;/i
    )?.[0];

    expect(finalize).toBeDefined();
    expect(finalize).toContain('generation_token = p_generation_token');
    expect(finalize).toMatch(/status = 'generating'/i);
    expect(finalize).toMatch(/p_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/i);
    expect(finalize).toMatch(/p_byte_count > 0/i);
    expect(finalize).toMatch(/status = 'ready'/i);
    expect(finalize).toMatch(/generation_expires_at > NOW\(\)/i);

    expect(fail).toBeDefined();
    expect(fail).toContain('generation_token = p_generation_token');
    expect(fail).toMatch(/status = 'generating'/i);
    expect(fail).toMatch(/status = 'failed'/i);
    expect(fail).toContain("NULLIF(BTRIM(p_error), '')");
    expect(fail).toContain("'Document generation failed.'");
    expect(fail).toMatch(/'Document generation failed\.'[\s\S]*500/i);
  });

  it('exposes read-only metadata and keeps PDF objects private and server-written', () => {
    expect(sql).toContain(
      'REVOKE ALL ON public.invoice_documents FROM authenticated'
    );
    expect(sql).toMatch(
      /CREATE POLICY invoice_documents_select[\s\S]*FOR SELECT TO authenticated[\s\S]*is_account_member\(account_id, 'viewer'\)/i
    );
    expect(sql).toMatch(
      /GRANT SELECT ON public\.invoice_documents TO authenticated/i
    );
    expect(sql).not.toMatch(
      /CREATE POLICY invoice_documents_(?:insert|update|delete)/i
    );

    expect(sql).toContain("'invoice-documents'");
    expect(sql).toMatch(
      /VALUES \([\s\S]*'invoice-documents',[\s\S]*FALSE,[\s\S]*10485760,[\s\S]*ARRAY\['application\/pdf'\]/i
    );
    expect(sql).toMatch(/public = FALSE/i);
    expect(sql).toMatch(/file_size_limit = EXCLUDED\.file_size_limit/i);
    expect(sql).toMatch(/allowed_mime_types = EXCLUDED\.allowed_mime_types/i);
    expect(sql).not.toMatch(
      /CREATE POLICY[\s\S]*ON storage\.objects[\s\S]*bucket_id = 'invoice-documents'/i
    );

    for (const functionName of [
      'reserve_invoice_document',
      'finalize_invoice_document',
      'fail_invoice_document',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${functionName}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`,
          'i'
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?TO service_role`,
          'i'
        )
      );
    }
  });
});
