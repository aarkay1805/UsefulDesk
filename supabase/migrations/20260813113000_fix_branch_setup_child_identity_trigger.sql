-- Repair the branch-setup authored-child identity trigger on databases where
-- the original migration is already applied. A polymorphic trigger record
-- cannot safely resolve table-specific NEW/OLD fields, even behind a
-- TG_TABLE_NAME guard. JSONB field access keeps the shared trigger generic.

CREATE OR REPLACE FUNCTION private.protect_authored_child_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'automation_steps'
     AND (pg_catalog.to_jsonb(NEW)->>'automation_id')
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)->>'automation_id') THEN
    RAISE EXCEPTION 'Automation step parent is immutable'
      USING ERRCODE = '22023';
  ELSIF TG_TABLE_NAME = 'flow_nodes'
        AND (pg_catalog.to_jsonb(NEW)->>'flow_id')
          IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)->>'flow_id') THEN
    RAISE EXCEPTION 'Flow node parent is immutable'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.protect_authored_child_parent() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.protect_authored_child_parent()
  FROM PUBLIC, anon, authenticated, service_role;
