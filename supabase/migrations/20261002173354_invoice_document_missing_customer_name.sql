-- A member can be created before their name is known. Complete that missing
-- name only in the first document payload, without rewriting invoice identity.
-- No data backfill, invoice updates, new grants, or Storage changes.

CREATE OR REPLACE FUNCTION public.reserve_invoice_document(
  p_invoice_id UUID,
  p_generated_by UUID
)
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
  v_customer_snapshot JSONB;
  v_customer_name TEXT;
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

  -- The trusted server supplies the authenticated actor because a
  -- service-role JWT has no end-user auth.uid(). Require both a real profile
  -- and membership in the invoice account before storing that attribution.
  IF p_generated_by IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.account_memberships membership
      ON membership.user_id = profile.user_id
    WHERE profile.user_id = p_generated_by
      AND membership.account_id = v_invoice.account_id
  ) THEN
    RAISE EXCEPTION 'Document generator is unavailable for this account'
      USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Could not make the invoice PDF. Complete Invoice details in Settings → Business details, then try again.'
      USING ERRCODE = '22023';
  END IF;

  -- Complete only a name that was never captured. Existing invoice identity
  -- stays immutable; the document owns this first-generation completion.
  -- A retry keeps the name already reserved, even if the member changes later.
  v_customer_snapshot := COALESCE(
    v_document.payload_snapshot->'customer',
    v_invoice.customer_snapshot
  );
  IF v_customer_snapshot IS NULL
     OR jsonb_typeof(v_customer_snapshot) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_customer_snapshot->'address') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Could not make the invoice PDF. Its saved member details need repair. Contact support with the invoice number.'
      USING ERRCODE = '22023';
  END IF;

  IF length(btrim(COALESCE(v_customer_snapshot->>'customer_name', ''))) = 0 THEN
    v_customer_name := NULLIF(btrim(v_invoice.customer_name_snapshot), '');
    IF v_customer_name IS NULL THEN
      SELECT NULLIF(btrim(contact.name), '')
      INTO v_customer_name
      FROM public.contacts contact
      WHERE contact.id = v_invoice.contact_id
        AND contact.account_id = v_invoice.account_id;
    END IF;

    IF v_customer_name IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.contacts contact
        WHERE contact.id = v_invoice.contact_id
          AND contact.account_id = v_invoice.account_id
      ) THEN
        RAISE EXCEPTION 'Could not make the invoice PDF. Add the member''s name in Details, then try again.'
          USING ERRCODE = '22023';
      ELSE
        RAISE EXCEPTION 'Could not make the invoice PDF. This invoice has no saved member name. Contact support with the invoice number.'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    v_customer_snapshot := jsonb_set(
      v_customer_snapshot, '{customer_name}', to_jsonb(v_customer_name)
    );
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
    'customer', v_customer_snapshot,
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
      p_generated_by
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
      generated_by = p_generated_by,
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

REVOKE ALL ON FUNCTION public.reserve_invoice_document(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_invoice_document(UUID, UUID)
  TO service_role;
