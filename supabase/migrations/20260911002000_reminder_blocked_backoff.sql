-- Blocked setup states are recoverable after a bounded pause and do not spend
-- provider attempts. Keep the durable transition inside the lease RPC.
CREATE OR REPLACE FUNCTION public.finish_lifecycle_reminder_job(
  p_job_id UUID, p_worker_id TEXT, p_lease_generation INTEGER, p_state TEXT,
  p_provider_message_id TEXT DEFAULT NULL, p_reason JSONB DEFAULT NULL,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_updated UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     OR p_state NOT IN ('attempting', 'accepted', 'blocked', 'deferred', 'failed', 'skipped', 'ambiguous', 'queued') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.lifecycle_reminder_jobs
  SET state = p_state, provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      reason = p_reason,
      next_attempt_at = COALESCE(p_next_attempt_at, CASE WHEN p_state = 'blocked' THEN NOW() + INTERVAL '1 hour' ELSE next_attempt_at END),
      accepted_at = CASE WHEN p_state = 'accepted' THEN NOW() ELSE accepted_at END,
      lease_owner = CASE WHEN p_state = 'attempting' THEN lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN p_state = 'attempting' THEN NOW() + INTERVAL '30 minutes' ELSE NULL END
  WHERE id = p_job_id AND lease_owner = p_worker_id AND lease_generation = p_lease_generation
    AND state IN ('leased', 'attempting') AND lease_expires_at >= NOW()
  RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN RETURN FALSE; END IF;
  IF p_state IN ('accepted', 'ambiguous') THEN
    UPDATE public.lifecycle_reminder_daily_claims SET state = p_state, updated_at = NOW() WHERE job_id = p_job_id;
  ELSIF p_state <> 'attempting' THEN
    DELETE FROM public.lifecycle_reminder_daily_claims WHERE job_id = p_job_id;
  END IF;
  RETURN TRUE;
END;
$$;
