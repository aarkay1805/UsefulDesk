-- No-send regression harness for the post-expiry lifecycle migrations.
-- Run with a privileged migration connection. It reads a real account/contact
-- only to satisfy foreign keys, creates one synthetic queue row, and rolls it
-- back. It never changes a customer, membership, invoice, schedule, or sends.
BEGIN;

DO $$
DECLARE
  v_account UUID;
  v_contact UUID;
  v_job UUID;
  v_follow_up_count INTEGER;
BEGIN
  SELECT c.account_id, c.id INTO v_account, v_contact
  FROM public.contacts c
  JOIN public.accounts a ON a.id = c.account_id
  ORDER BY c.created_at
  LIMIT 1;
  IF v_account IS NULL THEN
    RAISE NOTICE 'No account/contact available; schema-only assertions still run.';
    RETURN;
  END IF;

  INSERT INTO public.lifecycle_reminder_jobs(
    account_id, contact_id, kind, subject_cycle_id, milestone_key, business_key,
    effective_due_on, coordination_on, activation_generation, state, escalation_state, escalated_at
  ) VALUES (
    v_account, v_contact, 'membership_post_expiry',
    'rollback-post-expiry-cycle', 'expired-7',
    'rollback-post-expiry-' || gen_random_uuid()::text,
    CURRENT_DATE - 7, CURRENT_DATE, gen_random_uuid(), 'accepted', 'created', NOW()
  ) RETURNING id INTO v_job;

  IF NOT EXISTS (
    SELECT 1 FROM public.lifecycle_reminder_jobs
    WHERE id = v_job AND membership_id IS NULL AND member_service_id IS NULL
      AND escalation_state = 'created' AND escalated_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'post-expiry queue columns are not writable as expected'; END IF;
  IF NOT has_function_privilege('service_role', 'public.escalate_post_expiry_reminder(uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.escalate_post_expiry_reminder(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.escalate_post_expiry_reminder(uuid)', 'execute') THEN
    RAISE EXCEPTION 'post-expiry escalation RPC grants are unsafe';
  END IF;

  -- Direct re-entry after a durable outcome must return that outcome without
  -- creating or reopening a follow-up. Set only the transaction-local service
  -- JWT claim; no user, customer, or message is created.
  SELECT COUNT(*) INTO v_follow_up_count
  FROM public.follow_ups WHERE account_id = v_account AND contact_id = v_contact;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  IF public.escalate_post_expiry_reminder(v_job) <> 'created' THEN
    RAISE EXCEPTION 'post-expiry escalation did not preserve its durable outcome';
  END IF;
  IF (SELECT COUNT(*) FROM public.follow_ups WHERE account_id = v_account AND contact_id = v_contact) <> v_follow_up_count THEN
    RAISE EXCEPTION 'terminal escalation re-entry created a follow-up';
  END IF;
END $$;

ROLLBACK;
