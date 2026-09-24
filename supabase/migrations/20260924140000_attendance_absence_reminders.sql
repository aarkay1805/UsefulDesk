-- Opt-in missed-visit messages. A member/date has one durable lifecycle job;
-- check-ins remain the only source of attendance truth.
ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS attendance_absence_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attendance_absence_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_absence_generation UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.lifecycle_reminder_jobs
  DROP CONSTRAINT IF EXISTS lifecycle_reminder_jobs_kind_check;
ALTER TABLE public.lifecycle_reminder_jobs
  ADD COLUMN IF NOT EXISTS scheduled_for_at TIMESTAMPTZ;
ALTER TABLE public.lifecycle_reminder_jobs
  ADD CONSTRAINT lifecycle_reminder_jobs_kind_check CHECK (kind IN (
    'invoice_due', 'invoice_overdue', 'installment_overdue',
    'membership_post_expiry', 'service_post_expiry', 'promise_to_pay',
    'payment_link_follow_up', 'payment_confirmation', 'autopay_recovery',
    'session_pack_low', 'session_pack_exhausted', 'freeze_return',
    'membership_win_back', 'service_win_back', 'attendance_absence'
  ));

CREATE OR REPLACE FUNCTION public.set_attendance_absence_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.attendance_absence_enabled = OLD.attendance_absence_enabled
       AND (NEW.attendance_absence_activated_at IS DISTINCT FROM OLD.attendance_absence_activated_at
         OR NEW.attendance_absence_generation IS DISTINCT FROM OLD.attendance_absence_generation) THEN
      RAISE EXCEPTION 'Missed visit activation fields are system managed' USING ERRCODE = '23514';
    END IF;
    IF NEW.attendance_absence_enabled AND NOT OLD.attendance_absence_enabled THEN
      NEW.attendance_absence_activated_at := clock_timestamp();
      NEW.attendance_absence_generation := gen_random_uuid();
    END IF;
  ELSIF NEW.attendance_absence_enabled THEN
    NEW.attendance_absence_activated_at := clock_timestamp();
    NEW.attendance_absence_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_absence_activation ON public.renewal_reminder_settings;
CREATE TRIGGER trg_attendance_absence_activation
  BEFORE INSERT OR UPDATE ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_attendance_absence_activation();

-- The existing rule-readiness trigger already guards every other rule. This
-- independent edge guard enforces the new exact Marketing contract as well.
CREATE OR REPLACE FUNCTION public.enforce_attendance_absence_readiness()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.attendance_absence_enabled
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.attendance_absence_enabled, FALSE))
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_config config
       JOIN public.message_templates template ON template.account_id = config.account_id
       WHERE config.account_id = NEW.account_id AND config.status = 'connected'
         AND template.name = 'gym_missed_visit'
         AND COALESCE(template.language, 'en_US') = 'en_US'
         AND template.status = 'APPROVED'
         AND template.category = 'Marketing'
         AND template.parameter_format = 'POSITIONAL'
         AND template.provider_components_sync_required_at IS NULL
         AND template.header_type IS NULL AND template.header_content IS NULL
         AND template.body_text = 'Hi {{1}}, we missed you at {{2}} today. Hope all is well! Reply if we can help plan your next visit.'
         AND template.footer_text IS NULL
         AND public.reminder_template_buttons_match(template.buttons, '[]'::jsonb)
     ) THEN
    RAISE EXCEPTION 'Missed visit reminder needs its exact approved WhatsApp template' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_absence_readiness ON public.renewal_reminder_settings;
CREATE TRIGGER trg_attendance_absence_readiness
  BEFORE INSERT OR UPDATE ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_absence_readiness();

-- Queue only recent due visits, so activating the rule never chases old dates.
-- The account-local day is retained as the attendance subject even when a
-- late assigned arrival becomes due after midnight.
CREATE OR REPLACE FUNCTION public.queue_attendance_absence_reminders(p_account_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  WITH config AS (
    SELECT account.id AS account_id, account.timezone,
      setting.attendance_absence_activated_at AS activated_at,
      setting.attendance_absence_generation AS generation,
      setting.invoice_collection_send_window_end AS send_hour,
      (clock_timestamp() AT TIME ZONE account.timezone)::date AS today
    FROM public.accounts account
    JOIN public.renewal_reminder_settings setting ON setting.account_id = account.id
    WHERE account.id = p_account_id AND setting.attendance_absence_enabled
      AND setting.attendance_absence_activated_at IS NOT NULL
  ), candidates AS (
    SELECT config.*, day.visit_on, member.id AS membership_id,
      member.contact_id, contact.assigned_arrival_time,
      CASE WHEN contact.assigned_arrival_time IS NOT NULL THEN
        ((day.visit_on + contact.assigned_arrival_time + INTERVAL '1 hour') AT TIME ZONE config.timezone)
      WHEN config.send_hour = 0 THEN
        ((day.visit_on::timestamp + INTERVAL '30 minutes') AT TIME ZONE config.timezone)
      ELSE
        ((day.visit_on::timestamp + make_interval(hours => config.send_hour) - INTERVAL '30 minutes') AT TIME ZONE config.timezone)
      END AS due_at
    FROM config
    CROSS JOIN LATERAL (VALUES (config.today), (config.today - 1)) day(visit_on)
    JOIN public.memberships member ON member.account_id = config.account_id
      AND member.status = 'active' AND member.start_date <= day.visit_on
      AND member.end_date >= day.visit_on
    JOIN public.contacts contact ON contact.id = member.contact_id
      AND contact.account_id = config.account_id
      AND NULLIF(btrim(contact.phone), '') IS NOT NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM public.attendance visit
      WHERE visit.account_id = config.account_id
        AND visit.contact_id = member.contact_id
        AND visit.checked_in_at >= (day.visit_on::timestamp AT TIME ZONE config.timezone)
        AND visit.checked_in_at < ((day.visit_on + 1)::timestamp AT TIME ZONE config.timezone)
    )
  ), inserted AS (
    INSERT INTO public.lifecycle_reminder_jobs (
      account_id, contact_id, membership_id, kind, subject_cycle_id,
      milestone_key, business_key, effective_due_on, coordination_on,
      activation_generation, next_attempt_at, scheduled_for_at
    )
    SELECT account_id, contact_id, membership_id, 'attendance_absence',
      membership_id::text, 'missed-' || visit_on::text,
      'attendance_absence:none:' || membership_id::text || ':missed-' || visit_on::text,
      visit_on, visit_on, generation, due_at, due_at
    FROM candidates
    WHERE due_at >= activated_at AND due_at <= clock_timestamp()
      AND due_at >= clock_timestamp() - INTERVAL '2 hours'
    ON CONFLICT (account_id, business_key) DO NOTHING
    RETURNING id
  ) SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_attendance_absence_reminders(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_attendance_absence_reminders(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.set_attendance_absence_activation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_attendance_absence_readiness() FROM PUBLIC, anon, authenticated;
