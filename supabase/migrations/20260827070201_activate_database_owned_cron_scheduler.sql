-- The protected application aggregator has been deployed and exercised from
-- Production through pg_net. Activate the two independently scheduled jobs.

DO $$
DECLARE
  v_ops_job_id BIGINT;
  v_renewals_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_ops_job_id
  FROM cron.job
  WHERE jobname = 'usefuldesk-ops-cron';

  SELECT jobid INTO v_renewals_job_id
  FROM cron.job
  WHERE jobname = 'usefuldesk-renewals-cron';

  IF v_ops_job_id IS NULL OR v_renewals_job_id IS NULL THEN
    RAISE EXCEPTION 'database-owned cron jobs must exist before activation';
  END IF;

  PERFORM cron.alter_job(job_id := v_ops_job_id, active := TRUE);
  PERFORM cron.alter_job(job_id := v_renewals_job_id, active := TRUE);
END;
$$;
