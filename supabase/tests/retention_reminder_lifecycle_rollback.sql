-- No-send Step 6 schema and authorization harness. Run through the approved
-- SQL connector; every mutation is rolled back and it never invokes a worker.
BEGIN;

DO $$
DECLARE
  v_account UUID;
  v_membership UUID;
  v_contact UUID;
  v_owner UUID;
  v_return_on DATE := CURRENT_DATE + 7;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='memberships' AND column_name='planned_return_on')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='renewal_reminder_settings' AND column_name='session_pack_reminders_enabled') THEN
    RAISE EXCEPTION 'Step 6 retention schema is missing';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.create_freeze_return_follow_up(uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.create_freeze_return_follow_up(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.create_freeze_return_follow_up(uuid)', 'execute') THEN
    RAISE EXCEPTION 'Freeze return follow-up RPC grants are unsafe';
  END IF;

  SELECT membership.account_id, membership.id, membership.contact_id, account.owner_user_id
    INTO v_account, v_membership, v_contact, v_owner
  FROM public.memberships membership
  JOIN public.accounts account ON account.id=membership.account_id
  JOIN public.account_memberships branch_member ON branch_member.account_id=membership.account_id AND branch_member.user_id=account.owner_user_id
  WHERE membership.status='active'
  LIMIT 1;
  IF v_membership IS NULL THEN
    RAISE NOTICE 'No active membership with a branch-valid owner; schema/grant assertions passed.';
    RETURN;
  END IF;

  -- The direct freeze flow records a date and a branch-valid staff owner; it
  -- does not alter end_date, payment rows, or attendance.
  UPDATE public.memberships
  SET status='frozen', frozen_at=CURRENT_DATE,
      planned_return_on=v_return_on, planned_return_owner_id=v_owner
  WHERE id=v_membership;
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE id=v_membership AND status='frozen' AND planned_return_on=v_return_on AND planned_return_owner_id=v_owner) THEN
    RAISE EXCEPTION 'planned return was not retained on a frozen membership';
  END IF;
  UPDATE public.memberships SET status='active', frozen_at=NULL WHERE id=v_membership;
  IF EXISTS (SELECT 1 FROM public.memberships WHERE id=v_membership AND (planned_return_on IS NOT NULL OR planned_return_owner_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'planned return survived membership resumption';
  END IF;

  -- A synthetic task outcome only checks the service boundary and is rolled
  -- back. It is intentionally not eligible to create a staff follow-up.
  INSERT INTO public.lifecycle_reminder_jobs(account_id, contact_id, membership_id, kind, subject_cycle_id, milestone_key, business_key, effective_due_on, coordination_on, activation_generation, state)
  VALUES(v_account, v_contact, v_membership, 'freeze_return', 'rollback-return-cycle', 'return-day-follow-up', 'rollback-return-' || gen_random_uuid()::TEXT, v_return_on, CURRENT_DATE, gen_random_uuid(), 'queued');
END $$;

-- Exercise the actual service-only return-day effect, then prove a completed
-- task, edited return date, and disabled schedule cannot create a second task.
DO $$
DECLARE
  v_account UUID;
  v_membership UUID;
  v_contact UUID;
  v_owner UUID;
  v_generation UUID;
  v_return_on DATE;
  v_job UUID;
  v_result TEXT;
  v_count INTEGER;
BEGIN
  SELECT membership.account_id, membership.id, membership.contact_id, account.owner_user_id,
    (clock_timestamp() AT TIME ZONE account.timezone)::DATE
  INTO v_account, v_membership, v_contact, v_owner, v_return_on
  FROM public.memberships membership
  JOIN public.accounts account ON account.id = membership.account_id
  JOIN public.account_memberships branch_member
    ON branch_member.account_id = membership.account_id
   AND branch_member.user_id = account.owner_user_id
  WHERE membership.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.follow_ups task
      WHERE task.account_id = membership.account_id
        AND task.contact_id = membership.contact_id
        AND task.status = 'open'
    )
  LIMIT 1;
  IF v_membership IS NULL THEN
    RAISE NOTICE 'No active membership without an open task; replay assertions skipped.';
    RETURN;
  END IF;

  INSERT INTO public.renewal_reminder_settings(account_id)
  VALUES (v_account)
  ON CONFLICT (account_id) DO NOTHING;
  UPDATE public.renewal_reminder_settings
  SET freeze_return_reminders_enabled = TRUE
  WHERE account_id = v_account;
  SELECT freeze_return_reminders_generation INTO v_generation
  FROM public.renewal_reminder_settings WHERE account_id = v_account;

  UPDATE public.memberships
  SET status = 'frozen', frozen_at = v_return_on,
      planned_return_on = v_return_on, planned_return_owner_id = v_owner
  WHERE id = v_membership;
  INSERT INTO public.lifecycle_reminder_jobs(
    account_id, contact_id, membership_id, kind, subject_cycle_id,
    milestone_key, business_key, effective_due_on, coordination_on,
    activation_generation, state
  ) VALUES (
    v_account, v_contact, v_membership, 'freeze_return',
    v_membership::TEXT || ':' || v_return_on::TEXT || ':' || v_generation::TEXT,
    'return-day-follow-up', 'rollback-return-live-' || gen_random_uuid()::TEXT,
    v_return_on, v_return_on, v_generation, 'leased'
  ) RETURNING id INTO v_job;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  SELECT public.create_freeze_return_follow_up(v_job) INTO v_result;
  IF v_result <> 'created' THEN
    RAISE EXCEPTION 'expected one created return task, got %', v_result;
  END IF;
  UPDATE public.follow_ups SET status = 'done', outcome = 'other', completed_at = NOW()
  WHERE account_id = v_account AND contact_id = v_contact AND membership_id = v_membership;
  SELECT public.create_freeze_return_follow_up(v_job) INTO v_result;
  IF v_result <> 'created' THEN
    RAISE EXCEPTION 'completed task replay created a new follow-up: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.follow_ups
  WHERE account_id = v_account AND contact_id = v_contact AND membership_id = v_membership;
  IF v_count <> 1 THEN RAISE EXCEPTION 'return-day replay created % follow-ups', v_count; END IF;

  -- An edited date makes the old subject cycle terminal before it can create work.
  INSERT INTO public.lifecycle_reminder_jobs(
    account_id, contact_id, membership_id, kind, subject_cycle_id,
    milestone_key, business_key, effective_due_on, coordination_on,
    activation_generation, state
  ) VALUES (
    v_account, v_contact, v_membership, 'freeze_return',
    v_membership::TEXT || ':' || v_return_on::TEXT || ':' || v_generation::TEXT,
    'return-day-follow-up', 'rollback-return-edited-' || gen_random_uuid()::TEXT,
    v_return_on, v_return_on, v_generation, 'leased'
  ) RETURNING id INTO v_job;
  UPDATE public.memberships SET planned_return_on = v_return_on + 1 WHERE id = v_membership;
  SELECT public.create_freeze_return_follow_up(v_job) INTO v_result;
  IF v_result <> 'stopped' THEN RAISE EXCEPTION 'edited return date was not terminal: %', v_result; END IF;

  -- A disabled setting is also durable terminal work, never a delayed send/task.
  UPDATE public.renewal_reminder_settings
  SET freeze_return_reminders_enabled = FALSE WHERE account_id = v_account;
  INSERT INTO public.lifecycle_reminder_jobs(
    account_id, contact_id, membership_id, kind, subject_cycle_id,
    milestone_key, business_key, effective_due_on, coordination_on,
    activation_generation, state
  ) VALUES (
    v_account, v_contact, v_membership, 'freeze_return',
    v_membership::TEXT || ':' || (v_return_on + 1)::TEXT || ':' || v_generation::TEXT,
    'return-day-follow-up', 'rollback-return-disabled-' || gen_random_uuid()::TEXT,
    v_return_on + 1, v_return_on, v_generation, 'leased'
  ) RETURNING id INTO v_job;
  SELECT public.create_freeze_return_follow_up(v_job) INTO v_result;
  IF v_result <> 'stopped' THEN RAISE EXCEPTION 'disabled return schedule was not terminal: %', v_result; END IF;
END $$;

ROLLBACK;
