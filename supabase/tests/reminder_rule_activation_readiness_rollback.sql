-- No-send acceptance harness for the activation readiness trigger.
-- Run only against a non-ready, disabled invoice-collection fixture. Every
-- write is rolled back; this never calls a provider or leaves a rule enabled.

BEGIN;

DO $$
DECLARE
  v_account_id UUID;
  v_service_enabled BOOLEAN;
  v_trigger_rejected BOOLEAN := FALSE;
BEGIN
  SELECT account_id, service_enabled
  INTO v_account_id, v_service_enabled
  FROM public.renewal_reminder_settings
  WHERE invoice_collection_enabled = FALSE
  ORDER BY account_id
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No disabled invoice-collection fixture is available';
  END IF;

  IF public.reminder_rule_templates_ready(
    v_account_id,
    ARRAY['invoice_due', 'invoice_overdue']
  ) THEN
    RAISE EXCEPTION 'Fixture is ready; refusing a successful activation test';
  END IF;

  BEGIN
    UPDATE public.renewal_reminder_settings
    SET invoice_collection_enabled = TRUE
    WHERE account_id = v_account_id;
  EXCEPTION WHEN check_violation THEN
    v_trigger_rejected := TRUE;
  END;

  IF NOT v_trigger_rejected THEN
    RAISE EXCEPTION 'Expected activation readiness trigger to reject setup';
  END IF;

  -- A config no-op remains permitted and cannot change another rule.
  UPDATE public.renewal_reminder_settings
  SET days_before = days_before
  WHERE account_id = v_account_id;

  IF (SELECT service_enabled FROM public.renewal_reminder_settings WHERE account_id = v_account_id)
       IS DISTINCT FROM v_service_enabled THEN
    RAISE EXCEPTION 'Unrelated rule setting changed during no-op save';
  END IF;
END;
$$;

ROLLBACK;
