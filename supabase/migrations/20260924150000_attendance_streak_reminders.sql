-- One opt-in check-in for each uninterrupted six-day absence streak.
ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS attendance_streak_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attendance_streak_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_streak_generation UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.lifecycle_reminder_jobs
  DROP CONSTRAINT IF EXISTS lifecycle_reminder_jobs_kind_check;
ALTER TABLE public.lifecycle_reminder_jobs
  ADD CONSTRAINT lifecycle_reminder_jobs_kind_check CHECK (kind IN (
    'invoice_due', 'invoice_overdue', 'installment_overdue',
    'membership_post_expiry', 'service_post_expiry', 'promise_to_pay',
    'payment_link_follow_up', 'payment_confirmation', 'autopay_recovery',
    'session_pack_low', 'session_pack_exhausted', 'freeze_return',
    'membership_win_back', 'service_win_back', 'attendance_absence',
    'attendance_streak'
  ));

CREATE OR REPLACE FUNCTION public.set_attendance_streak_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.attendance_streak_enabled = OLD.attendance_streak_enabled
       AND (NEW.attendance_streak_activated_at IS DISTINCT FROM OLD.attendance_streak_activated_at
         OR NEW.attendance_streak_generation IS DISTINCT FROM OLD.attendance_streak_generation) THEN
      RAISE EXCEPTION 'Extended absence activation fields are system managed' USING ERRCODE = '23514';
    END IF;
    IF NEW.attendance_streak_enabled AND NOT OLD.attendance_streak_enabled THEN
      NEW.attendance_streak_activated_at := clock_timestamp();
      NEW.attendance_streak_generation := gen_random_uuid();
    END IF;
  ELSIF NEW.attendance_streak_enabled THEN
    NEW.attendance_streak_activated_at := clock_timestamp();
    NEW.attendance_streak_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_streak_activation ON public.renewal_reminder_settings;
CREATE TRIGGER trg_attendance_streak_activation
  BEFORE INSERT OR UPDATE ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_attendance_streak_activation();

CREATE OR REPLACE FUNCTION public.enforce_attendance_streak_readiness()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.attendance_streak_enabled
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.attendance_streak_enabled, FALSE))
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_config config
       JOIN public.message_templates template ON template.account_id = config.account_id
       WHERE config.account_id = NEW.account_id AND config.status = 'connected'
         AND template.name = 'gym_extended_absence'
         AND COALESCE(template.language, 'en_US') = 'en_US'
         AND template.status = 'APPROVED'
         AND template.category = 'Marketing'
         AND template.parameter_format = 'POSITIONAL'
         AND template.provider_components_sync_required_at IS NULL
         AND template.header_type IS NULL AND template.header_content IS NULL
         AND template.body_text = 'Hi {{1}}, it''s been a little while since we''ve seen you at {{2}}. Hope you''re doing well!'
         AND template.footer_text IS NULL
         AND public.reminder_template_buttons_match(template.buttons, '[]'::jsonb)
     ) THEN
    RAISE EXCEPTION 'Extended absence reminder needs its exact approved WhatsApp template' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_streak_readiness ON public.renewal_reminder_settings;
CREATE TRIGGER trg_attendance_streak_readiness
  BEFORE INSERT OR UPDATE ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_streak_readiness();

-- The latest real check-in starts a fresh streak. A member who has never
-- checked in starts on the membership's first day. The business key keeps
-- one job per streak, including when the rule was enabled after day six.
CREATE OR REPLACE FUNCTION public.queue_attendance_streak_reminders(p_account_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  WITH config AS (
    SELECT account.id AS account_id, account.timezone,
      setting.attendance_streak_activated_at AS activated_at,
      setting.attendance_streak_generation AS generation,
      setting.invoice_collection_send_window_end AS send_hour,
      (clock_timestamp() AT TIME ZONE account.timezone)::date AS today
    FROM public.accounts account
    JOIN public.renewal_reminder_settings setting ON setting.account_id = account.id
    WHERE account.id = p_account_id AND setting.attendance_streak_enabled
      AND setting.attendance_streak_activated_at IS NOT NULL
  ), candidates AS (
    SELECT config.account_id, config.timezone, config.activated_at,
      config.generation, day.visit_on, member.id AS membership_id,
      member.contact_id,
      GREATEST(member.start_date, COALESCE(last_visit.last_visit_on + 1, member.start_date)) AS streak_start,
      ((day.visit_on::timestamp + make_interval(hours => config.send_hour) + INTERVAL '30 minutes') AT TIME ZONE config.timezone) AS due_at
    FROM config
    CROSS JOIN LATERAL (VALUES (config.today), (config.today - 1)) day(visit_on)
    JOIN public.memberships member ON member.account_id = config.account_id
      AND member.status = 'active' AND member.start_date <= day.visit_on
      AND member.end_date >= day.visit_on
    JOIN public.contacts contact ON contact.id = member.contact_id
      AND contact.account_id = config.account_id
      AND NULLIF(btrim(contact.phone), '') IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT (visit.checked_in_at AT TIME ZONE config.timezone)::date AS last_visit_on
      FROM public.attendance visit
      WHERE visit.account_id = config.account_id
        AND visit.contact_id = member.contact_id
        AND visit.checked_in_at < ((day.visit_on + 1)::timestamp AT TIME ZONE config.timezone)
      ORDER BY visit.checked_in_at DESC
      LIMIT 1
    ) last_visit ON TRUE
  ), inserted AS (
    INSERT INTO public.lifecycle_reminder_jobs (
      account_id, contact_id, membership_id, kind, subject_cycle_id,
      milestone_key, business_key, effective_due_on, coordination_on,
      activation_generation, next_attempt_at, scheduled_for_at
    )
    SELECT account_id, contact_id, membership_id, 'attendance_streak',
      membership_id::text, 'since-' || streak_start::text,
      'attendance_streak:none:' || membership_id::text || ':since-' || streak_start::text,
      visit_on, visit_on, generation, due_at, due_at
    FROM candidates
    WHERE visit_on >= streak_start + 5
      AND due_at >= activated_at AND due_at <= clock_timestamp()
      AND due_at >= clock_timestamp() - INTERVAL '2 hours'
    ON CONFLICT (account_id, business_key) DO NOTHING
    RETURNING id
  ) SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

-- Both attendance rules share the 15-minute worker; collection keeps its
-- independent hourly batch and the daily claim prevents duplicate sends.
CREATE OR REPLACE FUNCTION public.claim_attendance_absence_reminder_jobs(
  p_worker_id TEXT, p_limit INTEGER DEFAULT 200
)
RETURNS SETOF public.lifecycle_reminder_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     OR COALESCE(NULLIF(p_worker_id, ''), '') = '' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.lifecycle_reminder_jobs
  SET state = CASE WHEN state = 'attempting' OR provider_attempt_count > 0
      THEN 'ambiguous' ELSE 'queued' END,
      reason = COALESCE(reason, '{}'::jsonb) || jsonb_build_object(
        'code', CASE WHEN state = 'attempting' OR provider_attempt_count > 0
          THEN 'lease_expired_before_outcome' ELSE 'lease_expired_before_provider' END),
      lease_owner = NULL, lease_expires_at = NULL
  WHERE kind IN ('attendance_absence', 'attendance_streak')
    AND state IN ('leased', 'attempting') AND lease_expires_at < NOW();

  RETURN QUERY
  WITH claimable AS (
    SELECT job.id FROM public.lifecycle_reminder_jobs job
    WHERE job.kind IN ('attendance_absence', 'attendance_streak')
      AND job.provider_attempt_count < 3
      AND job.state IN ('queued', 'deferred', 'blocked')
      AND job.next_attempt_at <= NOW()
    ORDER BY job.next_attempt_at, job.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 200)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.lifecycle_reminder_jobs job
  SET state = 'leased', lease_owner = p_worker_id,
      lease_generation = job.lease_generation + 1,
      lease_expires_at = NOW() + INTERVAL '10 minutes'
  FROM claimable WHERE job.id = claimable.id RETURNING job.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_lifecycle_reminder_jobs(
  p_worker_id TEXT, p_limit INTEGER DEFAULT 100
)
RETURNS SETOF public.lifecycle_reminder_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     OR COALESCE(NULLIF(p_worker_id, ''), '') = '' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.lifecycle_reminder_jobs
  SET state = CASE WHEN state = 'attempting' OR provider_attempt_count > 0
      THEN 'ambiguous' ELSE 'queued' END,
      reason = COALESCE(reason, '{}'::jsonb) || jsonb_build_object(
        'code', CASE WHEN state = 'attempting' OR provider_attempt_count > 0
          THEN 'lease_expired_before_outcome' ELSE 'lease_expired_before_provider' END),
      lease_owner = NULL, lease_expires_at = NULL
  WHERE state IN ('leased', 'attempting') AND lease_expires_at < NOW();

  RETURN QUERY
  WITH claimable AS (
    SELECT job.id FROM public.lifecycle_reminder_jobs job
    WHERE job.kind NOT IN ('attendance_absence', 'attendance_streak')
      AND job.provider_attempt_count < 3
      AND job.state IN ('queued', 'deferred', 'blocked')
      AND job.next_attempt_at <= NOW()
    ORDER BY job.next_attempt_at, job.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.lifecycle_reminder_jobs job
  SET state = 'leased', lease_owner = p_worker_id,
      lease_generation = job.lease_generation + 1,
      lease_expires_at = NOW() + INTERVAL '10 minutes'
  FROM claimable WHERE job.id = claimable.id RETURNING job.*;
END;
$$;

-- Payment collection, then longer absence, then a single missed visit.
CREATE OR REPLACE FUNCTION public.reserve_lifecycle_reminder_daily_claim(
  p_job_id UUID, p_worker_id TEXT, p_lease_generation INTEGER, p_send_on DATE
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.lifecycle_reminder_jobs%ROWTYPE; v_candidate_priority INTEGER; v_existing_day DATE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM public.lifecycle_reminder_jobs
  WHERE id=p_job_id AND lease_owner=p_worker_id AND lease_generation=p_lease_generation
    AND state='leased' AND lease_expires_at>=NOW() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'lost'; END IF;
  SELECT send_on INTO v_existing_day FROM public.lifecycle_reminder_daily_claims WHERE job_id=p_job_id;
  IF v_existing_day IS NOT NULL THEN RETURN CASE WHEN v_existing_day=p_send_on THEN 'reserved' ELSE 'lost' END; END IF;
  v_candidate_priority := CASE v_job.kind WHEN 'installment_overdue' THEN 5 WHEN 'invoice_overdue' THEN 4 WHEN 'invoice_due' THEN 3 WHEN 'attendance_streak' THEN 2 WHEN 'attendance_absence' THEN 1 ELSE 6 END;
  IF EXISTS (SELECT 1 FROM public.lifecycle_reminder_jobs other WHERE other.account_id=v_job.account_id AND other.contact_id=v_job.contact_id AND other.id<>v_job.id AND other.state IN ('queued','leased','deferred','blocked') AND other.next_attempt_at<=NOW() AND (CASE other.kind WHEN 'installment_overdue' THEN 5 WHEN 'invoice_overdue' THEN 4 WHEN 'invoice_due' THEN 3 WHEN 'attendance_streak' THEN 2 WHEN 'attendance_absence' THEN 1 ELSE 6 END)>v_candidate_priority) THEN RETURN 'deferred'; END IF;
  INSERT INTO public.lifecycle_reminder_daily_claims(account_id,contact_id,send_on,job_id) VALUES(v_job.account_id,v_job.contact_id,p_send_on,v_job.id) ON CONFLICT(account_id,contact_id,send_on) DO NOTHING;
  RETURN CASE WHEN EXISTS(SELECT 1 FROM public.lifecycle_reminder_daily_claims WHERE job_id=p_job_id AND send_on=p_send_on) THEN 'reserved' ELSE 'deferred' END;
END;
$$;

REVOKE ALL ON FUNCTION public.set_attendance_streak_activation(),
  public.enforce_attendance_streak_readiness(),
  public.queue_attendance_streak_reminders(UUID),
  public.claim_attendance_absence_reminder_jobs(TEXT, INTEGER),
  public.claim_lifecycle_reminder_jobs(TEXT, INTEGER),
  public.reserve_lifecycle_reminder_daily_claim(UUID, TEXT, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_attendance_streak_reminders(UUID),
  public.claim_attendance_absence_reminder_jobs(TEXT, INTEGER),
  public.claim_lifecycle_reminder_jobs(TEXT, INTEGER),
  public.reserve_lifecycle_reminder_daily_claim(UUID, TEXT, INTEGER, DATE)
  TO service_role;
