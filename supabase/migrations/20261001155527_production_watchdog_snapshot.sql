-- Read-only service snapshot for an external watchdog. No worker dispatch,
-- provider access, Vault reads, tenant data, response bodies or financial writes.
CREATE OR REPLACE FUNCTION public.production_watchdog_snapshot()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row RECORD;
  v_body JSONB;
  v_group TEXT;
  v_summary JSONB;
  v_ops JSONB;
  v_renewals JSONB;
  v_ops_active BOOLEAN;
  v_renewals_active BOOLEAN;
BEGIN
  SELECT COALESCE(bool_or(active),false) INTO v_ops_active
    FROM cron.job WHERE jobname='usefuldesk-ops-cron';
  SELECT COALESCE(bool_or(active),false) INTO v_renewals_active
    FROM cron.job WHERE jobname='usefuldesk-renewals-cron';
  FOR v_row IN SELECT created,status_code,timed_out,content
    FROM net._http_response ORDER BY id DESC LIMIT 200
  LOOP
    BEGIN
      v_body := v_row.content::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN CONTINUE;
    END;
    v_group := v_body->>'group';
    IF v_group NOT IN ('ops','renewals') OR v_group IS NULL THEN CONTINUE; END IF;
    v_summary := jsonb_build_object('group',v_group,
      'active',CASE WHEN v_group='ops' THEN v_ops_active ELSE v_renewals_active END,
      'last_response_at',v_row.created,'status_code',v_row.status_code,
      'timed_out',v_row.timed_out,
      'failed',CASE WHEN jsonb_typeof(v_body->'failed')='number' THEN v_body->'failed' ELSE NULL END,
      'dispatched',CASE WHEN jsonb_typeof(v_body->'dispatched')='number' THEN v_body->'dispatched' ELSE NULL END);
    IF v_group='ops' AND v_ops IS NULL THEN v_ops := v_summary; END IF;
    IF v_group='renewals' AND v_renewals IS NULL THEN v_renewals := v_summary; END IF;
    EXIT WHEN v_ops IS NOT NULL AND v_renewals IS NOT NULL;
  END LOOP;
  RETURN jsonb_build_object('checked_at',now(),'groups',jsonb_build_array(
    COALESCE(v_ops,jsonb_build_object('group','ops','active',v_ops_active,'last_response_at',NULL)),
    COALESCE(v_renewals,jsonb_build_object('group','renewals','active',v_renewals_active,'last_response_at',NULL))));
END;
$$;
REVOKE ALL ON FUNCTION public.production_watchdog_snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_watchdog_snapshot() TO service_role;
