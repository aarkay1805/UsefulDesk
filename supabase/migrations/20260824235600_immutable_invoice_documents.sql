-- One immutable, private PDF artifact per persisted invoice.
-- Postgres owns eligibility, payload construction, and generation leases;
-- browser roles can read metadata but cannot write rows or Storage objects.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type type
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typname = 'invoice_document_status'
  ) THEN
    CREATE TYPE public.invoice_document_status AS ENUM (
      'generating',
      'ready',
      'failed'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.invoice_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  status public.invoice_document_status NOT NULL DEFAULT 'generating',
  payload_snapshot JSONB NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT,
  byte_count BIGINT,
  format_version INTEGER NOT NULL DEFAULT 1,
  generation_token UUID NOT NULL DEFAULT gen_random_uuid(),
  generation_expires_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id),
  UNIQUE (storage_path),
  FOREIGN KEY (account_id, invoice_id)
    REFERENCES public.invoices(account_id, id) ON DELETE RESTRICT,
  CONSTRAINT invoice_documents_payload_object
    CHECK (jsonb_typeof(payload_snapshot) = 'object'),
  CONSTRAINT invoice_documents_payload_v1
    CHECK (
      payload_snapshot @> '{"format_version": 1}'::JSONB
      AND jsonb_typeof(payload_snapshot->'lines') = 'array'
      AND jsonb_array_length(payload_snapshot->'lines') > 0
    ),
  CONSTRAINT invoice_documents_storage_path_present
    CHECK (length(btrim(storage_path)) > 0),
  CONSTRAINT invoice_documents_storage_path_deterministic
    CHECK (
      payload_snapshot ? 'invoice_number'
      AND storage_path =
        'account-' || account_id::TEXT
        || '/' || invoice_id::TEXT
        || '/invoice-' || (payload_snapshot->>'invoice_number') || '.pdf'
    ),
  CONSTRAINT invoice_documents_sha256_hex
    CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT invoice_documents_byte_count_positive
    CHECK (byte_count IS NULL OR byte_count > 0),
  CONSTRAINT invoice_documents_format_version_v1
    CHECK (format_version = 1),
  CONSTRAINT invoice_documents_last_error_bounded
    CHECK (last_error IS NULL OR length(last_error) BETWEEN 1 AND 500),
  CONSTRAINT invoice_documents_state_consistent
    CHECK (
      (
        status = 'generating'
        AND sha256 IS NULL
        AND byte_count IS NULL
        AND generated_at IS NULL
        AND last_error IS NULL
      )
      OR (
        status = 'ready'
        AND sha256 IS NOT NULL
        AND byte_count > 0
        AND generated_at IS NOT NULL
        AND last_error IS NULL
      )
      OR (
        status = 'failed'
        AND sha256 IS NULL
        AND byte_count IS NULL
        AND generated_at IS NULL
        AND last_error IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS invoice_documents_account_created_idx
  ON public.invoice_documents(account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.invoice_documents;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.invoice_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.invoice_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_documents_select ON public.invoice_documents;
CREATE POLICY invoice_documents_select ON public.invoice_documents
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'viewer'));

-- Table state changes remain callable only through the three functions below.
REVOKE ALL ON public.invoice_documents FROM PUBLIC, anon;
REVOKE ALL ON public.invoice_documents FROM authenticated;
REVOKE ALL ON public.invoice_documents FROM service_role;
GRANT SELECT ON public.invoice_documents TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_invoice_document(p_invoice_id UUID)
RETURNS TABLE (
  outcome TEXT,
  document_id UUID,
  document_status public.invoice_document_status,
  generation_token UUID,
  payload_snapshot JSONB,
  storage_path TEXT,
  sha256 TEXT,
  byte_count BIGINT,
  last_error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_document public.invoice_documents%ROWTYPE;
  v_requires_refund_review BOOLEAN := FALSE;
  v_timezone TEXT;
  v_lines JSONB;
  v_subtotal_minor BIGINT;
  v_adjustment_amount_minor BIGINT;
  v_adjustments_minor BIGINT;
  v_total_minor BIGINT;
  v_payload JSONB;
  v_storage_path TEXT;
BEGIN
  SELECT invoice.*
  INTO v_invoice
  FROM public.invoices invoice
  WHERE invoice.id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice is unavailable'
      USING ERRCODE = '22023';
  END IF;

  -- The RPC is granted only to service_role. Retaining the membership check
  -- makes the boundary fail closed if a future grant deliberately permits an
  -- authenticated server session to invoke it with the caller's JWT.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_account_member(v_invoice.account_id, 'viewer') THEN
    RAISE EXCEPTION 'Invoice is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT document.*
  INTO v_document
  FROM public.invoice_documents document
  WHERE document.invoice_id = p_invoice_id
  FOR UPDATE;

  IF FOUND AND v_document.status = 'ready' THEN
    RETURN QUERY
    SELECT
      'ready'::TEXT,
      v_document.id,
      v_document.status,
      v_document.generation_token,
      v_document.payload_snapshot,
      v_document.storage_path,
      v_document.sha256,
      v_document.byte_count,
      v_document.last_error;
    RETURN;
  END IF;

  IF FOUND
     AND v_document.status = 'generating'
     AND v_document.generation_expires_at > NOW() THEN
    RETURN QUERY
    SELECT
      'generating'::TEXT,
      v_document.id,
      v_document.status,
      v_document.generation_token,
      v_document.payload_snapshot,
      v_document.storage_path,
      v_document.sha256,
      v_document.byte_count,
      v_document.last_error;
    RETURN;
  END IF;

  IF v_invoice.state = 'void' THEN
    RAISE EXCEPTION 'Voided invoices cannot generate documents'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(balance.requires_refund_review, FALSE)
  INTO v_requires_refund_review
  FROM public.invoice_balances balance
  WHERE balance.id = p_invoice_id;

  IF v_requires_refund_review THEN
    RAISE EXCEPTION 'Resolve the invoice refund review before generating a document'
      USING ERRCODE = '22023';
  END IF;

  IF v_invoice.invoice_number IS NULL
     OR length(btrim(v_invoice.invoice_number)) = 0 THEN
    RAISE EXCEPTION 'Invoice number is incomplete'
      USING ERRCODE = '22023';
  END IF;

  IF v_invoice.identity_snapshot_version IS DISTINCT FROM 1
     OR v_invoice.seller_snapshot IS NULL
     OR jsonb_typeof(v_invoice.seller_snapshot) IS DISTINCT FROM 'object'
     OR length(btrim(COALESCE(v_invoice.seller_snapshot->>'business_name', ''))) = 0
     OR jsonb_typeof(v_invoice.seller_snapshot->'address')
       IS DISTINCT FROM 'object'
     OR length(btrim(COALESCE(
       v_invoice.seller_snapshot->'address'->>'line1', ''
     ))) = 0
     OR length(btrim(COALESCE(
       v_invoice.seller_snapshot->'address'->>'city', ''
     ))) = 0
     OR length(btrim(COALESCE(
       v_invoice.seller_snapshot->'address'->>'country', ''
     ))) = 0 THEN
    RAISE EXCEPTION 'Finish Invoice details in Settings -> Payments first.'
      USING ERRCODE = '22023';
  END IF;

  IF v_invoice.customer_snapshot IS NULL
     OR jsonb_typeof(v_invoice.customer_snapshot) IS DISTINCT FROM 'object'
     OR length(btrim(COALESCE(
       v_invoice.customer_snapshot->>'customer_name', ''
     ))) = 0
     OR jsonb_typeof(v_invoice.customer_snapshot->'address')
       IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invoice customer snapshot is incomplete'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    jsonb_agg(
      jsonb_build_object(
        'description', line.description,
        'period', CASE
          WHEN line.service_start IS NOT NULL AND line.service_end IS NOT NULL
            THEN line.service_start::TEXT || ' to ' || line.service_end::TEXT
          ELSE NULL
        END,
        'quantity', line.quantity,
        'unit_amount_minor', ROUND(line.unit_amount * 100)::BIGINT,
        'amount_minor', ROUND(line.line_amount * 100)::BIGINT
      )
      ORDER BY line.sort_order, line.id
    ),
    COALESCE(SUM(ROUND(line.line_amount * 100)::BIGINT), 0)::BIGINT
  INTO v_lines, v_subtotal_minor
  FROM public.invoice_lines line
  WHERE line.invoice_id = p_invoice_id
    AND line.account_id = v_invoice.account_id
    AND line.state = 'active';

  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice has no active line facts'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    SUM(ROUND(adjustment.amount * 100)::BIGINT),
    0
  )::BIGINT
  INTO v_adjustment_amount_minor
  FROM public.invoice_adjustments adjustment
  WHERE adjustment.invoice_id = p_invoice_id
    AND adjustment.account_id = v_invoice.account_id;

  v_adjustments_minor := -v_adjustment_amount_minor;
  v_total_minor := v_subtotal_minor + v_adjustments_minor;

  IF v_total_minor < 0 THEN
    RAISE EXCEPTION 'Invoice adjustments exceed active line facts'
      USING ERRCODE = '22023';
  END IF;

  SELECT account.timezone
  INTO v_timezone
  FROM public.accounts account
  WHERE account.id = v_invoice.account_id;

  v_payload := jsonb_build_object(
    'format_version', 1,
    'invoice_number', v_invoice.invoice_number,
    'issued_at', (
      v_invoice.issued_at AT TIME ZONE v_timezone
    )::DATE::TEXT,
    'currency', v_invoice.currency,
    'seller', v_invoice.seller_snapshot,
    'customer', v_invoice.customer_snapshot,
    'lines', v_lines,
    'subtotal_minor', v_subtotal_minor,
    'adjustments_minor', v_adjustments_minor,
    'total_minor', v_total_minor
  );

  v_storage_path :=
    'account-' || v_invoice.account_id::TEXT
    || '/' || v_invoice.id::TEXT
    || '/invoice-' || v_invoice.invoice_number || '.pdf';

  IF v_document.id IS NULL THEN
    INSERT INTO public.invoice_documents (
      account_id,
      invoice_id,
      status,
      payload_snapshot,
      storage_path,
      generation_token,
      generation_expires_at,
      generated_by
    )
    VALUES (
      v_invoice.account_id,
      v_invoice.id,
      'generating',
      v_payload,
      v_storage_path,
      gen_random_uuid(),
      NOW() + INTERVAL '5 minutes',
      auth.uid()
    )
    RETURNING * INTO v_document;
  ELSE
    UPDATE public.invoice_documents document
    SET
      status = 'generating',
      payload_snapshot = v_payload,
      storage_path = v_storage_path,
      sha256 = NULL,
      byte_count = NULL,
      generation_token = gen_random_uuid(),
      generation_expires_at = NOW() + INTERVAL '5 minutes',
      generated_at = NULL,
      generated_by = auth.uid(),
      last_error = NULL,
      updated_at = NOW()
    WHERE document.id = v_document.id
      AND document.status IN ('failed', 'generating')
    RETURNING document.* INTO v_document;
  END IF;

  RETURN QUERY
  SELECT
    'claimed'::TEXT,
    v_document.id,
    v_document.status,
    v_document.generation_token,
    v_document.payload_snapshot,
    v_document.storage_path,
    v_document.sha256,
    v_document.byte_count,
    v_document.last_error;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_invoice_document(
  p_invoice_id UUID,
  p_generation_token UUID,
  p_sha256 TEXT,
  p_byte_count BIGINT
)
RETURNS SETOF public.invoice_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_generation_token IS NULL THEN
    RAISE EXCEPTION 'Generation token is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Document checksum must be lowercase SHA-256 hex'
      USING ERRCODE = '22023';
  END IF;

  IF p_byte_count IS NULL OR NOT (p_byte_count > 0) THEN
    RAISE EXCEPTION 'Document byte count must be positive'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.invoice_documents document
  SET
    status = 'ready',
    sha256 = p_sha256,
    byte_count = p_byte_count,
    generated_at = NOW(),
    last_error = NULL,
    updated_at = NOW()
  WHERE document.invoice_id = p_invoice_id
    AND document.status = 'generating'
    AND document.generation_token = p_generation_token
    AND document.generation_expires_at > NOW()
  RETURNING document.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_invoice_document(
  p_invoice_id UUID,
  p_generation_token UUID,
  p_error TEXT
)
RETURNS SETOF public.invoice_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_generation_token IS NULL THEN
    RAISE EXCEPTION 'Generation token is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.invoice_documents document
  SET
    status = 'failed',
    sha256 = NULL,
    byte_count = NULL,
    generation_expires_at = NOW(),
    generated_at = NULL,
    last_error = LEFT(
      COALESCE(
        NULLIF(BTRIM(p_error), ''),
        'Document generation failed.'
      ),
      500
    ),
    updated_at = NOW()
  WHERE document.invoice_id = p_invoice_id
    AND document.status = 'generating'
    AND document.generation_token = p_generation_token
  RETURNING document.*;
END;
$$;

ALTER FUNCTION public.reserve_invoice_document(UUID) OWNER TO postgres;
ALTER FUNCTION public.finalize_invoice_document(UUID, UUID, TEXT, BIGINT)
  OWNER TO postgres;
ALTER FUNCTION public.fail_invoice_document(UUID, UUID, TEXT) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.reserve_invoice_document(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_invoice_document(UUID, UUID, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_invoice_document(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reserve_invoice_document(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_invoice_document(UUID, UUID, TEXT, BIGINT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_invoice_document(UUID, UUID, TEXT)
  TO service_role;

-- Private 10 MiB PDF-only Storage. No storage.objects policy grants browser
-- reads or mutations; the authenticated API route streams downloads, and the
-- trusted server uses service-role Storage access for create/delete/signing.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'invoice-documents',
  'invoice-documents',
  FALSE,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
