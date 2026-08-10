-- Keep the checkout result assignment compatible when invoice_balances gains
-- new refund/accounting columns. The alias `balance` collides with the view's
-- numeric `balance` column, so selecting it unqualified returns one number;
-- expanding the alias explicitly returns the complete view row.
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

  IF strpos(v_definition, v_fixed) > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_definition, v_broken) = 0 THEN
    RAISE EXCEPTION
      'perform_member_checkout balance assignment does not match the expected definition';
  END IF;

  EXECUTE replace(v_definition, v_broken, v_fixed);
END;
$$;
