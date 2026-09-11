-- Execute through the approved SQL connector. This harness never commits.
-- It proves the actual payments INSERT trigger creates a confirmation job only
-- after activation, and that the provider-only recovery RPC rejects a browser
-- JWT before it can inspect or enqueue any event.
BEGIN;

DO $$
DECLARE
  v_account UUID;
  v_source public.payments%ROWTYPE;
  v_invoice RECORD;
  v_payment UUID;
  v_job UUID;
BEGIN
  SELECT settings.account_id INTO v_account
  FROM public.renewal_reminder_settings settings
  JOIN public.payments payment ON payment.account_id = settings.account_id
  WHERE payment.status = 'paid'
    AND payment.contact_id IS NOT NULL
    AND payment.user_id IS NOT NULL
  LIMIT 1;
  IF v_account IS NULL THEN RAISE EXCEPTION 'rollback harness needs one paid payment under a settings account'; END IF;

  UPDATE public.renewal_reminder_settings
  SET payment_confirmations_enabled = TRUE,
      autopay_recovery_enabled = FALSE
  WHERE account_id = v_account;

  SELECT * INTO v_source FROM public.payments
  WHERE account_id = v_account AND status = 'paid' AND contact_id IS NOT NULL AND user_id IS NOT NULL
  LIMIT 1;
  SELECT id, contact_id INTO v_invoice FROM public.invoice_balances
  WHERE account_id = v_account AND state = 'open' AND balance > 0.01
    AND NOT requires_refund_review
  LIMIT 1;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'rollback harness needs one collectible invoice'; END IF;
  -- The ledger's own trusted transaction context is required for direct
  -- payment inserts; this simulates its authoritative committed source.
  PERFORM set_config('app.system_payment', '1', TRUE);
  INSERT INTO public.payments(
    account_id, membership_id, contact_id, plan_id, user_id, amount, method,
    status, paid_at, period_start, period_end, note, created_at,
    idempotency_key, receipt_bucket, source, payment_purpose, invoice_id
  ) VALUES (
    v_source.account_id, NULL, v_invoice.contact_id,
    NULL, v_source.user_id, 0.01, v_source.method, 'paid',
    clock_timestamp(), NULL, NULL,
    'rollback-only confirmation proof', clock_timestamp(), gen_random_uuid(),
    NULL, 'manual', 'other', v_invoice.id
  ) RETURNING id INTO v_payment;
  PERFORM set_config('app.system_payment', '', TRUE);

  SELECT id INTO v_job FROM public.lifecycle_reminder_jobs
  WHERE account_id = v_account AND payment_id = v_payment
    AND kind = 'payment_confirmation';
  IF v_job IS NULL THEN RAISE EXCEPTION 'committed payment trigger did not enqueue its exact confirmation'; END IF;
END;
$$;

-- The production renewal transaction inserts its durable operation and billing
-- period before the payment. Prove that one rolled-back checkout-style renewal
-- produces one exact confirmation with a supported active-until fact.
DO $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_membership_id UUID;
  v_user UUID;
  v_payment UUID;
  v_reason JSONB;
BEGIN
  SELECT membership.id, payment.user_id INTO v_membership_id, v_user
  FROM public.memberships membership
  JOIN public.payments payment ON payment.membership_id = membership.id
  JOIN public.renewal_reminder_settings settings ON settings.account_id = membership.account_id
  WHERE membership.plan_id IS NOT NULL AND payment.status = 'paid' AND payment.user_id IS NOT NULL
  LIMIT 1;
  IF v_membership_id IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'rollback harness needs one membership with an agent-recorded payment'; END IF;
  SELECT * INTO v_membership FROM public.memberships WHERE id = v_membership_id;
  UPDATE public.renewal_reminder_settings SET payment_confirmations_enabled = TRUE
  WHERE account_id = v_membership.account_id;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', v_user::TEXT, TRUE);
  PERFORM public.renew_membership_transaction(
    v_membership.id, v_membership.plan_id, v_membership.end_date + 1,
    v_membership.end_date + 31, 1, 1, 'cash', FALSE, gen_random_uuid()
  );
  SELECT job.payment_id, job.reason INTO v_payment, v_reason
  FROM public.lifecycle_reminder_jobs job
  WHERE job.account_id = v_membership.account_id
    AND job.kind = 'payment_confirmation'
    AND job.reason->>'renewed' = 'true'
    AND job.reason->>'period_end' = (v_membership.end_date + 31)::TEXT
  ORDER BY job.created_at DESC LIMIT 1;
  IF v_payment IS NULL OR v_reason->>'renewed' <> 'true' THEN RAISE EXCEPTION 'renewal transaction did not produce an exact combined confirmation'; END IF;
END;
$$;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  BEGIN
    PERFORM public.enqueue_razorpay_autopay_recovery('not-a-canonical-event', gen_random_uuid(), 'terminal');
    RAISE EXCEPTION 'authenticated caller reached the provider-only recovery function';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
