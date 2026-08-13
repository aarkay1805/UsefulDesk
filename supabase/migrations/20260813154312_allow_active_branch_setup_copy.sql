-- Branch readiness is owner-defined and must not block safe configuration copy.
-- Keep the existing review metadata for compatibility, but source eligibility now
-- depends only on objective lifecycle, tenancy, size, pack, and currency checks.

DO $migration$
DECLARE
  v_definition TEXT;
  v_original TEXT;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.preview_organization_branch_setup(uuid,uuid,text,uuid,text[])'::REGPROCEDURE
  ) INTO v_definition;
  v_original := v_definition;

  v_definition := pg_catalog.replace(
    v_definition,
    $ready_gate$  IF v_source.readiness_state <> 'ready' THEN
    v_eligible := FALSE;
    v_reasons := v_reasons || '"SOURCE_NOT_READY"'::JSONB;
  END IF;
$ready_gate$,
    ''
  );
  IF v_definition = v_original
     AND pg_catalog.strpos(v_definition, 'SOURCE_NOT_READY') > 0 THEN
    RAISE EXCEPTION 'Could not remove preview readiness gate safely';
  END IF;

  v_original := v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    $review_gate$  IF v_source.setup_reviewed_at IS NULL THEN
    v_eligible := FALSE;
    v_reasons := v_reasons || '"SOURCE_NOT_REVIEWED"'::JSONB;
  END IF;
$review_gate$,
    ''
  );
  IF v_definition = v_original
     AND pg_catalog.strpos(v_definition, 'SOURCE_NOT_REVIEWED') > 0 THEN
    RAISE EXCEPTION 'Could not remove preview review gate safely';
  END IF;

  IF v_definition IS DISTINCT FROM pg_catalog.pg_get_functiondef(
    'public.preview_organization_branch_setup(uuid,uuid,text,uuid,text[])'::REGPROCEDURE
  ) THEN
    EXECUTE v_definition;
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.create_organization_branch_from_setup(uuid,uuid,uuid,text,text,uuid,text[])'::REGPROCEDURE
  ) INTO v_definition;
  v_original := v_definition;

  v_definition := pg_catalog.replace(
    v_definition,
    $create_gate$    IF v_copy_source.branch_status <> 'active'
       OR v_copy_source.readiness_state <> 'ready'
       OR v_copy_source.setup_reviewed_at IS NULL THEN
      RAISE EXCEPTION 'Copy source must be active, ready, and reviewed'
        USING ERRCODE = '22023';
    END IF;
$create_gate$,
    $active_gate$    IF v_copy_source.branch_status <> 'active' THEN
      RAISE EXCEPTION 'Copy source must be active'
        USING ERRCODE = '22023';
    END IF;
$active_gate$
  );
  IF v_definition = v_original
     AND pg_catalog.strpos(v_definition, 'Copy source must be active, ready, and reviewed') > 0 THEN
    RAISE EXCEPTION 'Could not replace creation readiness gate safely';
  END IF;

  IF v_definition IS DISTINCT FROM pg_catalog.pg_get_functiondef(
    'public.create_organization_branch_from_setup(uuid,uuid,uuid,text,text,uuid,text[])'::REGPROCEDURE
  ) THEN
    EXECUTE v_definition;
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.preview_organization_branch_setup(
  UUID, UUID, TEXT, UUID, TEXT[]
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_organization_branch_setup(
  UUID, UUID, TEXT, UUID, TEXT[]
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_organization_branch_from_setup(
  UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT[]
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_organization_branch_from_setup(
  UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT[]
) TO authenticated;
