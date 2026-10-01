-- Disposable full-schema only: all fixtures and function changes roll back.
BEGIN;
\ir ../supabase/migrations/20261001155527_production_watchdog_snapshot.sql
\ir ../supabase/migrations/20261001155527_production_watchdog_snapshot.sql
DO $$
DECLARE v JSONB;
BEGIN
  DELETE FROM net._http_response;
  v:=public.production_watchdog_snapshot();
  IF jsonb_array_length(v->'groups')<>2 OR v->'groups'->0->'last_response_at'<>'null'::jsonb THEN
    RAISE EXCEPTION 'Missing-response shape is incorrect'; END IF;
  INSERT INTO net._http_response(id,status_code,timed_out,content,created) VALUES
    (990001,200,false,'{"group":"ops","dispatched":10,"failed":0,"private":"provider-secret"}',now()),
    (990002,200,false,'{"group":"renewals","dispatched":3,"failed":0,"private":"provider-secret"}',now()),
    (990003,500,false,'<html>non-JSON failure</html>',now());
  v:=public.production_watchdog_snapshot();
  IF v::text LIKE '%provider-secret%' OR v->'groups'->0->>'dispatched'<>'10'
    OR v->'groups'->1->>'dispatched'<>'3' THEN RAISE EXCEPTION 'Snapshot failed allowlist or malformed-body handling'; END IF;
  INSERT INTO net._http_response(id,status_code,timed_out,content,created) VALUES
    (990004,503,false,'{"group":"ops","dispatched":10,"failed":1}',now());
  v:=public.production_watchdog_snapshot();
  IF v->'groups'->0->>'failed'<>'1' OR v->'groups'->0->>'status_code'<>'503' THEN
    RAISE EXCEPTION 'Latest failed aggregate was hidden'; END IF;
  IF has_function_privilege('anon','public.production_watchdog_snapshot()','execute')
    OR has_function_privilege('authenticated','public.production_watchdog_snapshot()','execute')
    OR NOT has_function_privilege('service_role','public.production_watchdog_snapshot()','execute') THEN
    RAISE EXCEPTION 'Service-only grant failed'; END IF;
  RAISE NOTICE 'Watchdog SQL replay, absent history, malformed body, latest failure, allowlist and grants passed';
END;
$$;
ROLLBACK;
