-- Retention is deliberately the lowest automatic chase priority. Extend the
-- existing atomic reservation without changing any schedule or queue state.
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
  v_candidate_priority := CASE v_job.kind
    WHEN 'installment_overdue' THEN 4 WHEN 'invoice_overdue' THEN 3
    WHEN 'invoice_due' THEN 2 WHEN 'membership_post_expiry' THEN 1
    WHEN 'service_post_expiry' THEN 1 ELSE 5 END;
  IF EXISTS (
    SELECT 1 FROM public.lifecycle_reminder_jobs other
    WHERE other.account_id=v_job.account_id AND other.contact_id=v_job.contact_id
      AND other.id<>v_job.id AND other.state IN ('queued','leased','deferred','blocked')
      AND other.next_attempt_at<=NOW()
      AND (CASE other.kind WHEN 'installment_overdue' THEN 4 WHEN 'invoice_overdue' THEN 3
        WHEN 'invoice_due' THEN 2 WHEN 'membership_post_expiry' THEN 1
        WHEN 'service_post_expiry' THEN 1 ELSE 5 END)>v_candidate_priority
  ) THEN RETURN 'deferred'; END IF;
  INSERT INTO public.lifecycle_reminder_daily_claims(account_id,contact_id,send_on,job_id)
  VALUES(v_job.account_id,v_job.contact_id,p_send_on,v_job.id)
  ON CONFLICT(account_id,contact_id,send_on) DO NOTHING;
  RETURN CASE WHEN EXISTS(SELECT 1 FROM public.lifecycle_reminder_daily_claims WHERE job_id=p_job_id AND send_on=p_send_on)
    THEN 'reserved' ELSE 'deferred' END;
END;
$$;
