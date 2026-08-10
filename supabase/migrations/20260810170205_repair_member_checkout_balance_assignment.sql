-- The checkout function has two refund-aware balance reads. The first repair
-- could see the already-correct final read and return before fixing the
-- earlier ambiguous read. Replace every remaining ambiguous occurrence.
DO $$
DECLARE
  v_definition TEXT;
  v_broken TEXT :=
    'SELECT balance INTO v_result FROM public.invoice_balances balance WHERE id = v_invoice_id;';
  v_fixed TEXT :=
    'SELECT balance.* INTO v_result FROM public.invoice_balances balance WHERE id = v_invoice_id;';
BEGIN
  SELECT pg_get_functiondef(
    'public.perform_member_checkout(jsonb)'::REGPROCEDURE
  ) INTO v_definition;

  IF strpos(v_definition, v_broken) = 0 THEN
    RETURN;
  END IF;

  EXECUTE replace(v_definition, v_broken, v_fixed);
END;
$$;
