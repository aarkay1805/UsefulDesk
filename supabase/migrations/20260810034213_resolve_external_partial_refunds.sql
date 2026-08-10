-- Close a contained Razorpay Dashboard partial-refund review only after an
-- admin explicitly assigns every refunded paise to original payment lines.
-- Provider/payment facts stay immutable; refund and adjustment allocations
-- remain append-only and the linked exception is resolved in the same
-- transaction as accounting classification.

CREATE OR REPLACE FUNCTION public.resolve_gateway_partial_refund(
  p_account_id UUID,
  p_refund_id UUID,
  p_actor UUID,
  p_disposition TEXT,
  p_reason TEXT,
  p_allocations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.payment_refunds%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_exception public.gateway_refund_exceptions%ROWTYPE;
  v_adjustment_id UUID;
  v_allocation_count INTEGER;
  v_distinct_line_count INTEGER;
  v_allocation_total NUMERIC(12, 2);
BEGIN
  IF p_actor IS NULL
     OR p_disposition NOT IN ('reopen_balance', 'reduce_charge')
     OR length(btrim(COALESCE(p_reason, ''))) < 3
     OR length(btrim(COALESCE(p_reason, ''))) > 500
     OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Valid partial-refund resolution is required';
  END IF;

  IF jsonb_array_length(p_allocations) < 1
     OR jsonb_array_length(p_allocations) > 100 THEN
    RAISE EXCEPTION 'Valid partial-refund resolution is required';
  END IF;

  IF NOT private.user_has_account_membership(
    p_account_id,
    p_actor,
    'admin'::public.account_role_enum
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.accounts account
    WHERE account.id = p_account_id
      AND account.branch_status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Admin account membership is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_allocations) item
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR NOT item ? 'invoice_line_id'
      OR NOT item ? 'amount'
  ) THEN
    RAISE EXCEPTION 'Every refund allocation requires a line and amount';
  END IF;

  BEGIN
    WITH requested AS (
      SELECT allocation.invoice_line_id, allocation.amount
      FROM jsonb_to_recordset(p_allocations)
        AS allocation(invoice_line_id UUID, amount NUMERIC)
    )
    SELECT
      COUNT(*)::INTEGER,
      COUNT(DISTINCT requested.invoice_line_id)::INTEGER,
      COALESCE(SUM(requested.amount), 0)::NUMERIC(12, 2)
    INTO v_allocation_count, v_distinct_line_count, v_allocation_total
    FROM requested;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Refund allocation values are invalid';
  END;

  IF v_allocation_count <> v_distinct_line_count
     OR v_allocation_total <= 0
     OR EXISTS (
       SELECT 1
       FROM jsonb_to_recordset(p_allocations)
         AS allocation(invoice_line_id UUID, amount NUMERIC)
       WHERE allocation.invoice_line_id IS NULL
          OR allocation.amount IS NULL
          OR allocation.amount <= 0
          OR allocation.amount <> round(allocation.amount, 2)
     ) THEN
    RAISE EXCEPTION 'Refund allocations must be unique positive paise amounts';
  END IF;

  SELECT *
  INTO v_refund
  FROM public.payment_refunds
  WHERE id = p_refund_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF v_refund.id IS NULL
     OR v_refund.status <> 'processed'
     OR v_refund.source <> 'razorpay_dashboard'
     OR v_refund.gateway_refund_id IS NULL THEN
    RAISE EXCEPTION 'External processed refund is required';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = v_refund.payment_id
    AND account_id = p_account_id
    AND invoice_id = v_refund.invoice_id
    AND gateway_payment_id IS NOT NULL
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'Gateway payment identity is unavailable';
  END IF;

  SELECT *
  INTO v_exception
  FROM public.gateway_refund_exceptions
  WHERE account_id = p_account_id
    AND refund_id = v_refund.id
    AND payment_id = v_refund.payment_id
    AND invoice_id = v_refund.invoice_id
    AND gateway_refund_id = v_refund.gateway_refund_id
    AND reason_code = 'partial_refund_line_target_required'
  FOR UPDATE;

  IF v_exception.id IS NULL THEN
    RAISE EXCEPTION 'Linked partial-refund exception is unavailable';
  END IF;

  IF v_refund.disposition IS NOT NULL THEN
    IF v_refund.disposition = p_disposition
       AND v_refund.reason = btrim(p_reason)
       AND v_exception.resolved_at IS NOT NULL
       AND NOT EXISTS (
         (SELECT allocation.invoice_line_id, allocation.amount
          FROM public.payment_refund_allocations allocation
          WHERE allocation.refund_id = v_refund.id
          EXCEPT
          SELECT requested.invoice_line_id, requested.amount
          FROM jsonb_to_recordset(p_allocations)
            AS requested(invoice_line_id UUID, amount NUMERIC))
         UNION ALL
         (SELECT requested.invoice_line_id, requested.amount
          FROM jsonb_to_recordset(p_allocations)
            AS requested(invoice_line_id UUID, amount NUMERIC)
          EXCEPT
          SELECT allocation.invoice_line_id, allocation.amount
          FROM public.payment_refund_allocations allocation
          WHERE allocation.refund_id = v_refund.id)
       ) THEN
      RETURN jsonb_build_object(
        'outcome', 'duplicate',
        'refund_id', v_refund.id,
        'exception_id', v_exception.id,
        'adjustment_id', (
          SELECT adjustment.id
          FROM public.invoice_adjustments adjustment
          WHERE adjustment.source_refund_id = v_refund.id
        )
      );
    END IF;
    RAISE EXCEPTION 'Refund resolution is immutable';
  END IF;

  IF v_exception.resolved_at IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.payment_refund_allocations allocation
       WHERE allocation.refund_id = v_refund.id
     )
     OR v_allocation_total <> v_refund.amount THEN
    RAISE EXCEPTION 'Refund line targeting is not eligible or incomplete';
  END IF;

  IF EXISTS (
    WITH requested AS (
      SELECT allocation.invoice_line_id, allocation.amount
      FROM jsonb_to_recordset(p_allocations)
        AS allocation(invoice_line_id UUID, amount NUMERIC)
    )
    SELECT 1
    FROM requested
    LEFT JOIN public.payment_allocations original
      ON original.payment_id = v_refund.payment_id
     AND original.invoice_line_id = requested.invoice_line_id
     AND original.account_id = p_account_id
    LEFT JOIN public.invoice_lines line
      ON line.id = requested.invoice_line_id
     AND line.invoice_id = v_refund.invoice_id
     AND line.account_id = p_account_id
    WHERE original.payment_id IS NULL
       OR line.id IS NULL
       OR requested.amount > original.amount - COALESCE((
         SELECT SUM(prior.amount)
         FROM public.payment_refund_allocations prior
         JOIN public.payment_refunds prior_refund
           ON prior_refund.id = prior.refund_id
         WHERE prior.payment_id = v_refund.payment_id
           AND prior.invoice_line_id = requested.invoice_line_id
           AND prior.refund_id <> v_refund.id
           AND prior_refund.status IN ('creating', 'pending', 'processed', 'orphaned')
       ), 0)
  ) THEN
    RAISE EXCEPTION 'Refund allocation exceeds an original payment line';
  END IF;

  PERFORM set_config('app.gateway_refund_workflow', '1', TRUE);

  INSERT INTO public.payment_refund_allocations (
    refund_id,
    payment_id,
    invoice_line_id,
    account_id,
    amount
  )
  SELECT
    v_refund.id,
    v_refund.payment_id,
    allocation.invoice_line_id,
    p_account_id,
    allocation.amount
  FROM jsonb_to_recordset(p_allocations)
    AS allocation(invoice_line_id UUID, amount NUMERIC);

  UPDATE public.payment_refunds
  SET disposition = p_disposition,
      reason = btrim(p_reason),
      updated_at = clock_timestamp()
  WHERE id = v_refund.id
  RETURNING * INTO v_refund;

  IF p_disposition = 'reduce_charge' THEN
    v_adjustment_id := public.create_refund_adjustment(
      v_refund.id,
      p_actor,
      btrim(p_reason)
    );
  END IF;

  UPDATE public.gateway_refund_exceptions
  SET resolved_at = clock_timestamp(),
      resolved_by = p_actor,
      resolution_note = left(
        'Explicit invoice-line allocation and ' || p_disposition || ': ' || btrim(p_reason),
        500
      )
  WHERE id = v_exception.id
    AND resolved_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partial-refund exception resolution was lost';
  END IF;

  PERFORM public.request_invoice_link_cancellation(
    v_refund.invoice_id,
    'partial_refund_resolved'
  );
  IF v_payment.membership_id IS NOT NULL THEN
    UPDATE public.memberships
    SET fee_status = fee_status
    WHERE id = v_payment.membership_id;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'resolved',
    'refund_id', v_refund.id,
    'exception_id', v_exception.id,
    'adjustment_id', v_adjustment_id,
    'allocation_count', v_allocation_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_gateway_partial_refund(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_gateway_partial_refund(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) TO service_role;

COMMENT ON FUNCTION public.resolve_gateway_partial_refund(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) IS 'Admin-audited, service-only atomic line targeting, classification, and exception resolution for an imported external partial refund.';
