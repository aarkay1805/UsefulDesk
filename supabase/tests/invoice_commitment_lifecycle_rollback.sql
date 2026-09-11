-- No-send regression harness for Step 4. Run only after the additive migration
-- through the approved Supabase migration connector. All synthetic state is
-- inside this transaction and is rolled back; no schedule, provider link, or
-- customer message is created.
BEGIN;

DO $$
DECLARE v_invoice RECORD; v_user UUID; v_commitment UUID; v_before NUMERIC; v_revised RECORD;
BEGIN
  SELECT b.id, b.account_id, b.contact_id, b.collectible_balance INTO v_invoice
  FROM public.invoice_balances b
  WHERE b.state='open' AND NOT b.requires_refund_review AND b.collectible_balance > 0 AND b.contact_id IS NOT NULL
  ORDER BY b.issued_at LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'No collectible invoice available; schema and grants assertions only.'; RETURN; END IF;
  SELECT membership.user_id INTO v_user FROM public.account_memberships membership WHERE membership.account_id=v_invoice.account_id AND membership.role::TEXT IN ('owner','admin','agent') LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'test account has no branch staff member'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_user)::text, true);
  SELECT public.invoice_commitment_payment_allocations(v_invoice.id) INTO v_before;
  SELECT id INTO v_commitment FROM public.save_invoice_collection_commitment(NULL, v_invoice.id, 'promise_to_pay', LEAST(v_invoice.collectible_balance, 1), CURRENT_DATE + 1, NULL, 'Confirm payment status', v_user, NULL);
  IF NOT EXISTS (SELECT 1 FROM public.invoice_collection_commitments WHERE id=v_commitment AND revision=1 AND payment_allocation_snapshot=v_before AND state='open') THEN
    RAISE EXCEPTION 'promise snapshot/revision was not recorded';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.reconcile_invoice_collection_commitment(uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.reconcile_invoice_collection_commitment(uuid)', 'execute') THEN
    RAISE EXCEPTION 'commitment reconciliation grants are unsafe';
  END IF;
  SELECT * INTO v_revised FROM public.save_invoice_collection_commitment(v_commitment, NULL, 'promise_to_pay', LEAST(v_invoice.collectible_balance, 1), CURRENT_DATE + 1, NULL, 'Confirm updated payment status', v_user, 1);
  IF v_revised.revision <> 2 OR v_revised.payment_allocation_snapshot <> v_before THEN
    RAISE EXCEPTION 'author revision did not preserve payment progress';
  END IF;
  PERFORM public.resolve_invoice_collection_commitment(v_commitment, 2);
  IF NOT EXISTS (SELECT 1 FROM public.invoice_collection_commitments WHERE id=v_commitment AND state='resolved' AND revision=3) THEN
    RAISE EXCEPTION 'author resolve transition was not recorded';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.save_invoice_collection_commitment(uuid,uuid,text,numeric,date,text,text,uuid,integer)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.resolve_invoice_collection_commitment(uuid,integer)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.record_payment_link_whatsapp_send(uuid,text)', 'execute') THEN
    RAISE EXCEPTION 'staff commitment/payment-link evidence grants are missing';
  END IF;
  -- A second open promise exercises the service-only unpaid/future transition
  -- after the first promise proved author edit/resolve behavior.
  SELECT id INTO v_commitment FROM public.save_invoice_collection_commitment(NULL, v_invoice.id, 'promise_to_pay', LEAST(v_invoice.collectible_balance, 1), CURRENT_DATE + 1, NULL, 'Recheck payment status', v_user, NULL);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  IF public.reconcile_invoice_collection_commitment(v_commitment) <> 'open' THEN
    RAISE EXCEPTION 'an unpaid future promise was not kept open';
  END IF;
END $$;

ROLLBACK;
