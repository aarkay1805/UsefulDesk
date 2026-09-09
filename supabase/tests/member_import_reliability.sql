-- Database acceptance for 20260909120000_member_import_reliability.sql.
-- Apply that migration to an approved test database first, then run this file
-- through an administrator connection. Every fixture and import is rolled
-- back. It deliberately exercises the authenticated RPC boundary.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_member_import_reliability(
  p_condition BOOLEAN,
  p_message TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'member import reliability acceptance failed: %', p_message;
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

SELECT pg_temp.assert_member_import_reliability(
  NULLIF(current_setting('acceptance.actor', TRUE), '') IS NOT NULL
    AND NULLIF(current_setting('acceptance.account', TRUE), '') IS NOT NULL,
  'test project must contain an active account with an agent'
);
SELECT set_config('acceptance.other_actor', id::TEXT, TRUE)
FROM auth.users
WHERE id <> current_setting('acceptance.actor')::UUID
ORDER BY id
LIMIT 1;
SELECT pg_temp.assert_member_import_reliability(
  NULLIF(current_setting('acceptance.other_actor', TRUE), '') IS NOT NULL,
  'test project must contain a second auth user to probe draft ownership'
);

SELECT set_config('acceptance.job', gen_random_uuid()::TEXT, TRUE),
  set_config('acceptance.plan', gen_random_uuid()::TEXT, TRUE),
  set_config('acceptance.option', gen_random_uuid()::TEXT, TRUE),
  set_config('acceptance.key', gen_random_uuid()::TEXT, TRUE),
  set_config('acceptance.source_key', gen_random_uuid()::TEXT, TRUE),
  set_config(
    'acceptance.phone',
    '+919' || lpad(
      substring(regexp_replace(gen_random_uuid()::TEXT, '[^0-9]', '', 'g') FROM 1 FOR 9),
      9,
      '0'
    ),
    TRUE
  );

-- An existing author draft is only replaced within this rollback transaction.
UPDATE public.member_import_drafts
SET status = 'cleanup'
WHERE account_id = current_setting('acceptance.account')::UUID
  AND author_id = current_setting('acceptance.actor')::UUID
  AND status = 'active';

INSERT INTO public.member_import_drafts (
  id, account_id, author_id, source_filename, source_kind, source_size,
  source_sha256, object_path, status, expires_at
) VALUES (
  current_setting('acceptance.job')::UUID,
  current_setting('acceptance.account')::UUID,
  current_setting('acceptance.actor')::UUID,
  'member-import-reliability.csv', 'csv', 1, repeat('a', 64),
  current_setting('acceptance.account') || '/' || current_setting('acceptance.actor')
    || '/member-import-reliability.csv',
  'active', NOW() + INTERVAL '1 hour'
);

INSERT INTO public.membership_plans (
  id, account_id, name, price, duration_days, description, is_active,
  plan_type, attendance_limit_count, attendance_limit_interval
) VALUES (
  current_setting('acceptance.plan')::UUID,
  current_setting('acceptance.account')::UUID,
  'Reliability acceptance ' || substring(current_setting('acceptance.plan'), 1, 8),
  100, 30, 'Rollback-scoped reliability fixture', TRUE,
  'recurring', NULL, NULL
);

INSERT INTO public.plan_pricing_options (
  id, account_id, plan_id, duration_count, duration_unit,
  price, setup_fee, is_active, sort_order
) VALUES (
  current_setting('acceptance.option')::UUID,
  current_setting('acceptance.account')::UUID,
  current_setting('acceptance.plan')::UUID,
  1, 'month', 100, 0, TRUE, 0
);

SELECT set_config(
  'acceptance.payload',
  jsonb_build_object(
    'account_id', current_setting('acceptance.account'),
    'import_job_id', current_setting('acceptance.job'),
    'idempotency_key', current_setting('acceptance.key'),
    'contact', jsonb_build_object('phone', current_setting('acceptance.phone'), 'name', 'Reliability acceptance'),
    'rows', jsonb_build_array(jsonb_build_object(
      'source_key', current_setting('acceptance.source_key'),
      'source_row', 1,
      'idempotency_key', gen_random_uuid(),
      'total', 100, 'amount_paid', 0, 'balance', 100, 'payment_method', 'cash',
      'membership', jsonb_build_object(
        'plan_id', current_setting('acceptance.plan'),
        'pricing_option_id', current_setting('acceptance.option'),
        'start_date', CURRENT_DATE, 'end_date', CURRENT_DATE + 30,
        'status', 'active', 'fee_amount', 100, 'list_price', 100,
        'discount_type', NULL, 'discount_value', NULL, 'discount_amount', 0,
        'historical_price', FALSE
      ),
      'service', NULL
    ))
  )::TEXT,
  TRUE
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('acceptance.actor'), 'role', 'authenticated')::TEXT,
  TRUE
);
SELECT set_config(
  'request.headers',
  jsonb_build_object('x-usefuldesk-account-id', current_setting('acceptance.account'))::TEXT,
  TRUE
);

-- A due active membership succeeds without a cancellation decision, and an
-- exact replay returns the original completed outcome before mutable checks.
SELECT set_config(
  'acceptance.result',
  public.perform_member_import_group(current_setting('acceptance.payload')::JSONB)::TEXT,
  TRUE
);
SELECT pg_temp.assert_member_import_reliability(
  (current_setting('acceptance.result')::JSONB->>'membership_id') IS NOT NULL,
  'active due membership did not import'
);
SELECT pg_temp.assert_member_import_reliability(
  public.perform_member_import_group(current_setting('acceptance.payload')::JSONB)
    = current_setting('acceptance.result')::JSONB,
  'exact replay did not return the completed outcome'
);

-- The original request hash prevents a cancelled intent from replaying as the
-- earlier active one, even though the inner writer sees active in both cases.
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{rows,0,membership,status}', '"cancelled"'::JSONB);
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Conflicting member import idempotency key%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'changed original replay intent was accepted');
END;
$$;

-- New requests must be tied to a live draft owned by their current author.
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{import_job_id}', to_jsonb(gen_random_uuid()::TEXT));
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Import job is not an active draft owned by this author%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'unowned import job was accepted');
END;
$$;

UPDATE public.member_import_drafts
SET expires_at = NOW() - INTERVAL '1 second'
WHERE id = current_setting('acceptance.job')::UUID;
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Import job is not an active draft owned by this author%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'expired import job was accepted');
END;
$$;
UPDATE public.member_import_drafts
SET expires_at = NOW() + INTERVAL '1 hour'
WHERE id = current_setting('acceptance.job')::UUID;

RESET ROLE;
-- The partial unique index permits one active draft per author. Clear any
-- existing active draft for the probe author only inside this rollback scope
-- before assigning the fixture job to that author.
UPDATE public.member_import_drafts
SET status = 'cleanup'
WHERE account_id = current_setting('acceptance.account')::UUID
  AND author_id = current_setting('acceptance.other_actor')::UUID
  AND status = 'active'
  AND id <> current_setting('acceptance.job')::UUID;
UPDATE public.member_import_drafts
SET author_id = current_setting('acceptance.other_actor')::UUID
WHERE id = current_setting('acceptance.job')::UUID;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Import job is not an active draft owned by this author%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'another author''s import job was accepted');
END;
$$;
RESET ROLE;
UPDATE public.member_import_drafts
SET author_id = current_setting('acceptance.actor')::UUID
WHERE id = current_setting('acceptance.job')::UUID;
SET LOCAL ROLE authenticated;

-- A one-paise reconciliation gap is never accepted by the wrapper or the
-- underlying transaction's floating tolerance.
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{contact}', jsonb_build_object('phone', '+919899999999', 'name', 'Paise guard'));
  v_payload := jsonb_set(v_payload, '{rows,0,idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{rows,0,total}', '100'::JSONB);
  v_payload := jsonb_set(v_payload, '{rows,0,amount_paid}', '0'::JSONB);
  v_payload := jsonb_set(v_payload, '{rows,0,balance}', '99.99'::JSONB);
  v_payload := jsonb_set(v_payload, '{rows,0,membership,fee_amount}', '100'::JSONB);
  v_payload := jsonb_set(v_payload, '{rows,0,membership,list_price}', '100'::JSONB);
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Paid, balance, and purchase total do not reconcile%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'one-paise reconciliation gap was accepted');
END;
$$;

-- The selected contact cannot be reused with a now-different source phone.
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{contact}', jsonb_build_object(
    'id', current_setting('acceptance.result')::JSONB->>'contact_id',
    'phone', '+919888888888', 'name', 'Stale selection'
  ));
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Selected customer no longer matches the imported phone%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'stale contact phone was accepted');
END;
$$;

-- A configured price must be used unless the row says it is historical.
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{contact}', jsonb_build_object('phone', '+919777777777', 'name', 'Price guard'));
  v_payload := jsonb_set(v_payload, '{rows,0,idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{rows,0,total}', '101'::JSONB);
  v_payload := jsonb_set(v_payload, '{rows,0,balance}', '101'::JSONB);
  v_payload := jsonb_set(v_payload, '{rows,0,membership,fee_amount}', '101'::JSONB);
  v_payload := jsonb_set(v_payload, '{rows,0,membership,list_price}', '101'::JSONB);
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Configured membership price changed%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'configured-price mismatch was accepted');
END;
$$;

-- A foreign plan/option pair cannot be smuggled into this tenant's import.
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{contact}', jsonb_build_object('phone', '+919666666666', 'name', 'Tenant guard'));
  v_payload := jsonb_set(v_payload, '{rows,0,idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{rows,0,membership,plan_id}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{rows,0,membership,pricing_option_id}', to_jsonb(gen_random_uuid()::TEXT));
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Active membership billing option not found%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'foreign or unknown offering was accepted');
END;
$$;

-- Cancellation with a positive membership-line balance needs the current,
-- fact-bound decision. The first request must roll back; the second proves
-- the explicit write-off reaches cancellation.
DO $$
DECLARE
  v_payload JSONB := current_setting('acceptance.payload')::JSONB;
  v_fingerprint TEXT;
  v_result JSONB;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_payload := jsonb_set(v_payload, '{idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{contact}', jsonb_build_object('phone', '+919555555555', 'name', 'Debt guard'));
  v_payload := jsonb_set(v_payload, '{rows,0,idempotency_key}', to_jsonb(gen_random_uuid()::TEXT));
  v_payload := jsonb_set(v_payload, '{rows,0,membership,status}', '"cancelled"'::JSONB);
  BEGIN
    PERFORM public.perform_member_import_group(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%Cancelled membership debt needs an explicit current write-off decision%';
  END;
  PERFORM pg_temp.assert_member_import_reliability(v_rejected, 'unapproved cancellation debt was accepted');

  v_fingerprint := concat_ws('|',
    current_setting('acceptance.plan'), current_setting('acceptance.option'),
    CURRENT_DATE::TEXT, (CURRENT_DATE + 30)::TEXT, 'cancelled',
    '100.00', '100.00', '', '', '0.00', '0.00', '100.00', '0.00', '100.00'
  );
  v_payload := jsonb_set(v_payload, '{rows,0,cancellation_debt}', jsonb_build_object(
    'decision', 'write_off', 'fingerprint', v_fingerprint
  ));
  v_result := public.perform_member_import_group(v_payload);
  PERFORM pg_temp.assert_member_import_reliability(
    EXISTS (
      SELECT 1 FROM public.memberships
      WHERE id = (v_result->>'membership_id')::UUID AND status = 'cancelled'
    ),
    'approved cancellation did not cancel the imported membership'
  );
END;
$$;

ROLLBACK;

SELECT 'passed: member import reliability acceptance assertions; all fixture and import writes rolled back' AS acceptance;
