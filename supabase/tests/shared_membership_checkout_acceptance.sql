-- Rollback-scoped acceptance for the shared membership checkout transaction.
-- Safe to run after applying 20260816120000_shared_membership_checkout.sql;
-- all fixtures and checkout writes stay inside this transaction and roll back.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_checkout(
  p_condition BOOLEAN,
  p_message TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'shared membership checkout acceptance failed: %', p_message;
  END IF;
END;
$$;

SELECT set_config('acceptance.actor', fixture.user_id::TEXT, TRUE),
  set_config('acceptance.account', fixture.account_id::TEXT, TRUE)
FROM (
  SELECT membership.user_id, membership.account_id
  FROM public.account_memberships membership
  JOIN auth.users actor ON actor.id = membership.user_id
  JOIN public.accounts account ON account.id = membership.account_id
  WHERE membership.role IN ('owner', 'admin', 'agent')
    AND COALESCE(account.branch_status, 'active') = 'active'
  ORDER BY membership.created_at, membership.account_id
  LIMIT 1
) fixture;

SELECT pg_temp.assert_checkout(
  NULLIF(current_setting('acceptance.actor', TRUE), '') IS NOT NULL
    AND NULLIF(current_setting('acceptance.account', TRUE), '') IS NOT NULL,
  'Test project must contain an agent-accessible active account'
);

SELECT set_config('acceptance.contact', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.plan', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.option', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.join_key', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.renew_key', gen_random_uuid()::TEXT, TRUE);

INSERT INTO public.contacts (
  id, account_id, user_id, phone, name, created_by
) VALUES (
  current_setting('acceptance.contact')::UUID,
  current_setting('acceptance.account')::UUID,
  current_setting('acceptance.actor')::UUID,
  '+919' || substring(replace(current_setting('acceptance.contact'), '-', ''), 1, 9),
  'Shared Checkout Acceptance',
  current_setting('acceptance.actor')::UUID
);

INSERT INTO public.membership_plans (
  id, account_id, name, price, duration_days, description, is_active,
  plan_type, attendance_limit_count, attendance_limit_interval
) VALUES (
  current_setting('acceptance.plan')::UUID,
  current_setting('acceptance.account')::UUID,
  'Shared Checkout Monthly', 1000, 30,
  'Rollback-scoped shared checkout acceptance plan', TRUE,
  'recurring', NULL, NULL
);

INSERT INTO public.plan_pricing_options (
  id, account_id, plan_id, duration_count, duration_unit,
  price, setup_fee, is_active, sort_order
) VALUES (
  current_setting('acceptance.option')::UUID,
  current_setting('acceptance.account')::UUID,
  current_setting('acceptance.plan')::UUID,
  1, 'month', 1000, 200, TRUE, 0
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('acceptance.actor'),
    'role', 'authenticated'
  )::TEXT,
  TRUE
);
SELECT set_config(
  'request.headers',
  jsonb_build_object(
    'x-usefuldesk-account-id', current_setting('acceptance.account')
  )::TEXT,
  TRUE
);

-- Lead conversion may defer collection. Browser-authored totals and expiry
-- are deliberately forged; the transaction must ignore them and use the
-- active account-owned pricing option plus structured offer intent.
SELECT set_config(
  'acceptance.join_result',
  public.perform_join_checkout(jsonb_build_object(
    'mode', 'convert',
    'account_id', current_setting('acceptance.account'),
    'contact_id', current_setting('acceptance.contact'),
    'idempotency_key', current_setting('acceptance.join_key'),
    'membership', jsonb_build_object(
      'plan_id', current_setting('acceptance.plan'),
      'pricing_option_id', current_setting('acceptance.option'),
      'period_start', CURRENT_DATE,
      'fee_amount', 1,
      'period_end', CURRENT_DATE + 1,
      'list_price', 1,
      'discount_type', 'amount',
      'discount_value', 200,
      'discount_amount', 0,
      'standard_period_end', CURRENT_DATE + 1,
      'bonus_months', 1
    ),
    'selections', '[]'::JSONB,
    'collection', jsonb_build_object(
      'collect_now', FALSE,
      'timing', 'full',
      'method', 'cash',
      'paid_at', CURRENT_TIMESTAMP
    )
  ))::TEXT,
  TRUE
);
SELECT set_config(
  'acceptance.membership',
  current_setting('acceptance.join_result')::JSONB->>'membership_id',
  TRUE
);
SELECT set_config(
  'acceptance.join_invoice',
  current_setting('acceptance.join_result')::JSONB->>'invoice_id',
  TRUE
);

DO $$
DECLARE
  v_period public.membership_periods%ROWTYPE;
  v_standard_end DATE := CURRENT_DATE + INTERVAL '1 month';
BEGIN
  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = current_setting('acceptance.membership')::UUID
  ORDER BY created_at, id
  LIMIT 1;

  PERFORM pg_temp.assert_checkout(v_period.list_price = 1200,
    'join list price must include the configured setup fee');
  PERFORM pg_temp.assert_checkout(v_period.discount_type = 'amount'
      AND v_period.discount_value = 200
      AND v_period.discount_amount = 200
      AND v_period.fee_amount = 1000,
    'join discount snapshot must be derived from configured price');
  PERFORM pg_temp.assert_checkout(v_period.standard_period_end = v_standard_end
      AND v_period.period_end = v_standard_end + INTERVAL '1 month'
      AND v_period.bonus_months = 1,
    'join expiry must be derived from option duration and bonus intent');

  IF (
    SELECT count(*) FROM public.payments
    WHERE invoice_id = current_setting('acceptance.join_invoice')::UUID
  ) <> 0 THEN
    RAISE EXCEPTION 'deferred conversion unexpectedly recorded payment';
  END IF;
  IF (
    SELECT count(*) FROM public.membership_installment_plans
    WHERE invoice_id = current_setting('acceptance.join_invoice')::UUID
  ) <> 0 THEN
    RAISE EXCEPTION 'deferred conversion unexpectedly recorded installment promise';
  END IF;
END;
$$;

-- Seed an old, membership-scoped credit after the first invoice exists.
RESET ROLE;
INSERT INTO public.member_credit_entries (
  account_id, membership_id, contact_id, amount, source, note, created_by
) VALUES (
  current_setting('acceptance.account')::UUID,
  current_setting('acceptance.membership')::UUID,
  current_setting('acceptance.contact')::UUID,
  200, 'trainer_reassignment',
  'Rollback-scoped credit for post-credit installment acceptance',
  current_setting('acceptance.actor')::UUID
);
SET LOCAL ROLE authenticated;

-- Renewal excludes setup fee, applies a one-cycle offer, consumes credit,
-- and splits the remaining combined cash balance exactly 60/40.
SELECT set_config(
  'acceptance.renew_result',
  public.perform_member_checkout(jsonb_build_object(
    'mode', 'membership_renewal',
    'account_id', current_setting('acceptance.account'),
    'contact_id', current_setting('acceptance.contact'),
    'membership_id', current_setting('acceptance.membership'),
    'idempotency_key', current_setting('acceptance.renew_key'),
    'membership', jsonb_build_object(
      'plan_id', current_setting('acceptance.plan'),
      'pricing_option_id', current_setting('acceptance.option'),
      'period_start', (
        SELECT period_end FROM public.membership_periods
        WHERE membership_id = current_setting('acceptance.membership')::UUID
        ORDER BY created_at, id LIMIT 1
      ),
      'fee_amount', 1,
      'period_end', CURRENT_DATE + 2,
      'discount_type', 'percentage',
      'discount_value', 10,
      'bonus_months', 1
    ),
    'selections', '[]'::JSONB,
    'collection', jsonb_build_object(
      'collect_now', TRUE,
      'timing', 'installments',
      'method', 'upi',
      'paid_at', CURRENT_TIMESTAMP
    )
  ))::TEXT,
  TRUE
);
SELECT set_config(
  'acceptance.renew_invoice',
  current_setting('acceptance.renew_result')::JSONB->>'invoice_id',
  TRUE
);

DO $$
DECLARE
  v_period public.membership_periods%ROWTYPE;
  v_line public.invoice_lines%ROWTYPE;
  v_installment public.membership_installment_plans%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_join_end DATE;
  v_standard_end DATE;
BEGIN
  SELECT period_end INTO v_join_end
  FROM public.membership_periods
  WHERE membership_id = current_setting('acceptance.membership')::UUID
  ORDER BY created_at, id
  LIMIT 1;
  v_standard_end := v_join_end + INTERVAL '1 month';

  SELECT * INTO v_period
  FROM public.membership_periods
  WHERE membership_id = current_setting('acceptance.membership')::UUID
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  SELECT * INTO v_line FROM public.invoice_lines
  WHERE id = v_period.invoice_line_id;
  SELECT * INTO v_installment FROM public.membership_installment_plans
  WHERE invoice_id = current_setting('acceptance.renew_invoice')::UUID;
  SELECT * INTO v_payment FROM public.payments
  WHERE id = v_installment.first_payment_id;

  PERFORM pg_temp.assert_checkout(v_period.list_price = 1000
      AND v_period.discount_type = 'percentage'
      AND v_period.discount_value = 10
      AND v_period.discount_amount = 100
      AND v_period.fee_amount = 900,
    'renewal offer must use option price without setup fee');
  PERFORM pg_temp.assert_checkout(v_period.standard_period_end = v_standard_end
      AND v_period.period_end = v_standard_end + INTERVAL '1 month'
      AND v_period.bonus_months = 1,
    'renewal period must snapshot standard and bonus-adjusted expiry');
  PERFORM pg_temp.assert_checkout(v_line.list_amount = 1000
      AND v_line.unit_amount = 900 AND v_line.line_amount = 900,
    'renewal membership invoice line must retain list and offered amounts');
  PERFORM pg_temp.assert_checkout(
    (current_setting('acceptance.renew_result')::JSONB->>'total')::NUMERIC = 900
      AND (current_setting('acceptance.renew_result')::JSONB->>'credit_applied')::NUMERIC = 200
      AND (current_setting('acceptance.renew_result')::JSONB->>'cash_paid')::NUMERIC = 420
      AND (current_setting('acceptance.renew_result')::JSONB->>'balance')::NUMERIC = 280,
    'renewal result must reconcile offer, credit, and 60/40 cash collection');
  PERFORM pg_temp.assert_checkout(v_installment.first_amount = 420
      AND v_installment.second_amount = 280
      AND v_payment.amount = 420
      AND v_installment.second_due_on =
        ((v_payment.paid_at AT TIME ZONE COALESCE((
          SELECT timezone FROM public.accounts
          WHERE id = current_setting('acceptance.account')::UUID
        ), 'Asia/Kolkata'))::DATE + 28),
    'renewal installment must use the post-credit cash balance and local due date');
  PERFORM pg_temp.assert_checkout((
      SELECT balance FROM public.invoice_balances
      WHERE id = current_setting('acceptance.join_invoice')::UUID
    ) = 1000,
    'renewal must leave the earlier invoice arrears unchanged');
END;
$$;

CREATE TEMP TABLE shared_checkout_counts_before_retry AS
SELECT
  (SELECT count(*) FROM public.membership_periods
    WHERE membership_id = current_setting('acceptance.membership')::UUID) AS periods,
  (SELECT count(*) FROM public.invoices
    WHERE membership_id = current_setting('acceptance.membership')::UUID) AS invoices,
  (SELECT count(*) FROM public.payments
    WHERE membership_id = current_setting('acceptance.membership')::UUID) AS payments,
  (SELECT count(*) FROM public.membership_installment_plans
    WHERE membership_id = current_setting('acceptance.membership')::UUID) AS installments;

SELECT pg_temp.assert_checkout(
  public.perform_member_checkout(jsonb_build_object(
    'mode', 'membership_renewal',
    'account_id', current_setting('acceptance.account'),
    'contact_id', current_setting('acceptance.contact'),
    'membership_id', current_setting('acceptance.membership'),
    'idempotency_key', current_setting('acceptance.renew_key'),
    'membership', jsonb_build_object(
      'plan_id', current_setting('acceptance.plan'),
      'pricing_option_id', current_setting('acceptance.option'),
      'period_start', CURRENT_DATE,
      'discount_type', 'percentage',
      'discount_value', 10,
      'bonus_months', 1
    ),
    'selections', '[]'::JSONB,
    'collection', jsonb_build_object(
      'collect_now', TRUE, 'timing', 'installments', 'method', 'upi'
    )
  ))->>'invoice_id' = current_setting('acceptance.renew_invoice'),
  'idempotent retry must return the original invoice'
);

SELECT pg_temp.assert_checkout(
  before.periods = after.periods
    AND before.invoices = after.invoices
    AND before.payments = after.payments
    AND before.installments = after.installments,
  'idempotent retry must not duplicate checkout facts'
)
FROM shared_checkout_counts_before_retry before
CROSS JOIN LATERAL (
  SELECT
    (SELECT count(*) FROM public.membership_periods
      WHERE membership_id = current_setting('acceptance.membership')::UUID) AS periods,
    (SELECT count(*) FROM public.invoices
      WHERE membership_id = current_setting('acceptance.membership')::UUID) AS invoices,
    (SELECT count(*) FROM public.payments
      WHERE membership_id = current_setting('acceptance.membership')::UUID) AS payments,
    (SELECT count(*) FROM public.membership_installment_plans
      WHERE membership_id = current_setting('acceptance.membership')::UUID) AS installments
) after;

DO $$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.renew_membership_transaction(
      current_setting('acceptance.membership')::UUID,
      current_setting('acceptance.plan')::UUID,
      CURRENT_DATE + 365,
      CURRENT_DATE + 395,
      1, 0, 'cash', FALSE, gen_random_uuid(),
      current_setting('acceptance.option')::UUID
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  PERFORM pg_temp.assert_checkout(v_denied,
    'authenticated callers must not execute the legacy renewal RPC directly');
END;
$$;

ROLLBACK;
