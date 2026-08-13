-- A cron invocation used to move a due execution from pending to running with
-- no expiry. If the process stopped before completion, that execution could
-- never be claimed again. Owner leases make the claim atomic and recoverable.

ALTER TABLE public.automation_pending_executions
  ADD COLUMN IF NOT EXISTS lease_owner UUID,
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

ALTER TABLE public.automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_lease_pair_check;
ALTER TABLE public.automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_lease_pair_check
  CHECK (
    (lease_owner IS NULL AND lease_until IS NULL)
    OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS automation_pending_executions_recovery_idx
  ON public.automation_pending_executions (run_at, lease_until, created_at, id)
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION public.claim_due_automation_executions(
  p_lease_owner UUID,
  p_limit INTEGER DEFAULT 50,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.automation_pending_executions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_lease_owner IS NULL
     OR p_limit < 1
     OR p_limit > 100
     OR p_lease_seconds < 30
     OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'Invalid delayed automation claim';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT pending.id
    FROM public.automation_pending_executions AS pending
    WHERE pending.run_at <= clock_timestamp()
      AND (
        pending.status = 'pending'
        OR (
          pending.status = 'running'
          AND (
            pending.lease_until IS NULL
            OR pending.lease_until <= clock_timestamp()
          )
        )
      )
    ORDER BY pending.run_at, pending.created_at, pending.id
    LIMIT p_limit
    FOR UPDATE OF pending SKIP LOCKED
  ), claimed AS (
    UPDATE public.automation_pending_executions AS pending
    SET status = 'running',
        lease_owner = p_lease_owner,
        lease_until = clock_timestamp()
          + make_interval(secs => p_lease_seconds)
    FROM candidates
    WHERE pending.id = candidates.id
    RETURNING pending.*
  )
  SELECT claimed.*
  FROM claimed
  ORDER BY claimed.run_at, claimed.created_at, claimed.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_automation_execution(
  p_execution_id UUID,
  p_lease_owner UUID,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_lease_owner IS NULL OR p_status NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'Invalid delayed automation completion';
  END IF;

  UPDATE public.automation_pending_executions AS pending
  SET status = p_status,
      lease_owner = NULL,
      lease_until = NULL
  WHERE pending.id = p_execution_id
    AND pending.status = 'running'
    AND pending.lease_owner = p_lease_owner;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_due_automation_executions(
  UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_automation_execution(
  UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_due_automation_executions(
  UUID, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_automation_execution(
  UUID, UUID, TEXT
) TO service_role;

COMMENT ON FUNCTION public.claim_due_automation_executions(
  UUID, INTEGER, INTEGER
) IS 'Service-only owner-leased claim for due or expired delayed automation executions.';
COMMENT ON FUNCTION public.finish_automation_execution(
  UUID, UUID, TEXT
) IS 'Service-only owner-CAS terminal transition for a delayed automation execution.';
