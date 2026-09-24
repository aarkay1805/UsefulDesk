-- The 15-minute missed-visit worker leases only its own jobs. The hourly
-- lifecycle worker remains a backup through the existing general claim RPC.
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
  WHERE kind = 'attendance_absence'
    AND state IN ('leased', 'attempting') AND lease_expires_at < NOW();

  RETURN QUERY
  WITH claimable AS (
    SELECT job.id FROM public.lifecycle_reminder_jobs job
    WHERE job.kind = 'attendance_absence'
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

REVOKE ALL ON FUNCTION public.claim_attendance_absence_reminder_jobs(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_absence_reminder_jobs(TEXT, INTEGER)
  TO service_role;
