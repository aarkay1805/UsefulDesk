-- Rollback-scoped acceptance for collecting the first payment during a
-- mid-cycle membership plan change. Safe to run against an initialized
-- project: every fixture and ledger write rolls back.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_change_plan_collection(
  p_condition BOOLEAN,
  p_message TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'change-plan collection acceptance failed: %', p_message;
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

SELECT pg_temp.assert_change_plan_collection(
  NULLIF(current_setting('acceptance.actor', TRUE), '') IS NOT NULL
    AND NULLIF(current_setting('acceptance.account', TRUE), '') IS NOT NULL,
  'Test project must contain an agent-accessible active account'
);

SELECT set_config('acceptance.contact', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.membership', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.source_plan', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.source_option', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.target_plan', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.target_option', gen_random_uuid()::TEXT, TRUE);
SELECT set_config('acceptance.change_key', gen_random_uuid()::TEXT, TRUE);

INSERT INTO public.contacts (
  id, account_id, user_id, phone, name, created_by
) VALUES (
  current_setting('acceptance.contact')::UUID,
  current_setting('acceptance.account')::UUID,
  current_setting('acceptance.actor')::UUID,
  '+918' || substring(replace(current_setting('acceptance.contact'), '-', ''), 1, 9),
  'Change Plan Collection Acceptance',
  current_setting('acceptance.actor')::UUID
);

INSERT INTO public.membership_plans (
  id, account_id, name, price, duration_days, description, is_active,
  plan_type, attendance_limit_count, attendance_limit_interval
) VALUES
  (
    current_setting('acceptance.source_plan')::UUID,
    current_setting('acceptance.account')::UUID,
    'Change Plan Source ' || substring(current_setting('acceptance.source_plan'), 1, 8),
    1000, 30, 'Rollback-scoped source plan', TRUE,
    'recurring', NULL, NULL
  ),
  (
    current_setting('acceptance.target_plan')::UUID,
    current_setting('acceptance.account')::UUID,
    'Change Plan Target ' || substring(current_setting('acceptance.target_plan'), 1, 8),
    1200, 60, 'Rollback-scoped target plan', TRUE,
    'recurring', NULL, NULL
  );

INSERT INTO public.plan_pricing_options (
  id, account_id, plan_id, duration_count, duration_unit,
  price, setup_fee, is_active, sort_order
) VALUES
  (
    current_setting('acceptance.source_option')::UUID,
    current_setting('acceptance.account')::UUID,
    current_setting('acceptance.source_plan')::UUID,
    1, 'month', 1000, 0, TRUE, 0
  ),
  (
    current_setting('acceptance.target_option')::UUID,
    current_setting('acceptance.account')::UUID,
    current_setting('acceptance.target_plan')::UUID,
    2, 'month', 1200, 0, TRUE, 0
  );

INSERT INTO public.memberships (
  id, account_id, contact_id, user_id, plan_id, pricing_option_id,
  start_date, end_date, status, fee_amount
) VALUES (
  current_setting('acceptance.membership')::UUID,
  current_setting('acceptance.account')::UUID,
  current_setting('acceptance.contact')::UUID,
  current_setting('acceptance.actor')::UUID,
  current_setting('acceptance.source_plan')::UUID,
  current_setting('acceptance.source_option')::UUID,
  CURRENT_DATE,
  (CURRENT_DATE + INTERVAL '1 month')::DATE,
  'active',
  1000
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

SELECT set_config(
  'acceptance.result_membership',
  public.change_membership_plan(
    current_setting('acceptance.membership')::UUID,
    current_setting('acceptance.target_plan')::UUID,
    (CURRENT_DATE + 1)::DATE,
    (CURRENT_DATE + INTERVAL '2 months' + INTERVAL '1 day')::DATE,
    50,
    1200,
    1200,
    'cash',
    current_setting('acceptance.change_key')::UUID,
    current_setting('acceptance.target_option')::UUID
  )::TEXT,
  TRUE
);

SELECT pg_temp.assert_change_plan_collection(
  current_setting('acceptance.result_membership')::UUID =
    current_setting('acceptance.membership')::UUID,
  'plan-change RPC must return the changed membership'
);

SELECT pg_temp.assert_change_plan_collection(
  EXISTS (
    SELECT 1
    FROM public.payments payment
    JOIN public.invoices invoice ON invoice.id = payment.invoice_id
    WHERE payment.membership_id = current_setting('acceptance.membership')::UUID
      AND payment.idempotency_key = current_setting('acceptance.change_key')::UUID
      AND payment.amount = 1200
      AND payment.source = 'manual'
      AND payment.user_id = current_setting('acceptance.actor')::UUID
      AND invoice.account_id = current_setting('acceptance.account')::UUID
  ),
  'first collection must be recorded against the new membership invoice'
);

SELECT pg_temp.assert_change_plan_collection(
  EXISTS (
    SELECT 1
    FROM public.memberships membership
    WHERE membership.id = current_setting('acceptance.membership')::UUID
      AND membership.plan_id = current_setting('acceptance.target_plan')::UUID
      AND membership.pricing_option_id = current_setting('acceptance.target_option')::UUID
  ),
  'membership pointer must move to the selected plan and billing option'
);

ROLLBACK;
