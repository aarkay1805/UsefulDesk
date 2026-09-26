-- Move lifecycle reminder delivery reconciliation into one set-based RPC.
--
-- The worker loaded every accepted job, sent all their WhatsApp message ids in
-- one PostgREST `in` filter (which fails once the URL grows past a few hundred
-- ids), and issued one update per job. This joins accepted jobs to the stored
-- inbox message by provider id, scoped to the job's own account and contact
-- exactly like `automated_message_activity`, and updates them in one statement.
-- Jobs without a final message status stay accepted; that remains truthful.

CREATE INDEX IF NOT EXISTS idx_lifecycle_reminder_jobs_accepted_provider_message
  ON public.lifecycle_reminder_jobs(provider_message_id)
  WHERE state = 'accepted' AND provider_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reconcile_lifecycle_reminder_deliveries()
RETURNS TABLE(delivered_count INTEGER, failed_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH outcome AS (
    SELECT DISTINCT ON (job.id) job.id AS job_id, message.status AS message_status
    FROM public.lifecycle_reminder_jobs job
    JOIN public.messages message ON message.message_id = job.provider_message_id
    JOIN public.conversations conversation ON conversation.id = message.conversation_id
      AND conversation.account_id = job.account_id
      AND conversation.contact_id = job.contact_id
    WHERE job.state = 'accepted' AND job.provider_message_id IS NOT NULL
      AND message.status IN ('delivered', 'read', 'failed')
    ORDER BY job.id, message.created_at DESC
  ), updated AS (
    UPDATE public.lifecycle_reminder_jobs job
    SET state = CASE WHEN outcome.message_status = 'failed' THEN 'failed' ELSE 'delivered' END,
        reason = CASE WHEN outcome.message_status = 'failed'
          THEN jsonb_build_object('code', 'provider_delivery_failed') ELSE job.reason END,
        delivered_at = CASE WHEN outcome.message_status = 'failed'
          THEN job.delivered_at ELSE NOW() END
    FROM outcome
    WHERE job.id = outcome.job_id AND job.state = 'accepted'
    RETURNING job.state AS new_state
  )
  SELECT
    (COUNT(*) FILTER (WHERE updated.new_state = 'delivered'))::INTEGER,
    (COUNT(*) FILTER (WHERE updated.new_state = 'failed'))::INTEGER
  FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_lifecycle_reminder_deliveries()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_lifecycle_reminder_deliveries()
TO service_role;
