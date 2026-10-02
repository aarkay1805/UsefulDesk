SET LOCAL ROLE authenticated;
DO $$
DECLARE
  snapshot JSONB;
  sort_key TEXT;
  direction TEXT;
  listing_mode TEXT;
  wanted UUID;
BEGIN
  -- RLS permits only the current user's profile: the cross-branch teammate
  -- must resolve through the authorized roster function instead.
  IF (SELECT count(*) FROM public.profiles) <> 1 THEN
    RAISE EXCEPTION 'Fixture must hide the other branch profile under RLS';
  END IF;
  IF (SELECT full_name FROM public.list_account_members('00000000-0000-4000-8000-000000000020') WHERE user_id = '00000000-0000-4000-8000-000000000002') <> 'Asha' THEN
    RAISE EXCEPTION 'Branch roster failed to resolve the cross-branch name';
  END IF;

  FOREACH sort_key IN ARRAY ARRAY['assigned_name', 'created_by_name'] LOOP
    FOREACH direction IN ARRAY ARRAY['asc', 'desc'] LOOP
      FOREACH listing_mode IN ARRAY ARRAY['table', 'board', 'ids', 'export'] LOOP
        snapshot := public.lead_listing_snapshot(
          '00000000-0000-4000-8000-000000000020', listing_mode, '',
          '{}', '{}', false, '{}', '{}', '{}', '{}', '{}', '{}', NULL,
          '{}', 'all', '2026-09-28', '2026-09-29', sort_key, direction,
          NULL, 0, CASE WHEN listing_mode IN ('ids', 'export') THEN NULL ELSE 50 END, '{}'
        );
        wanted := CASE WHEN direction = 'asc'
          THEN '00000000-0000-4000-8000-000000000102'::UUID
          ELSE '00000000-0000-4000-8000-000000000101'::UUID END;
        IF (snapshot->'rows'->0->>'id')::UUID IS DISTINCT FROM wanted THEN
          RAISE EXCEPTION '% % % returned wrong first enquiry: %', listing_mode, sort_key, direction, snapshot->'rows'->0->>'id';
        END IF;
        IF (snapshot->>'totalCount')::INT <> 2 THEN
          RAISE EXCEPTION 'Name sorting changed the enquiry cohort';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  BEGIN
    PERFORM public.list_account_members('00000000-0000-4000-8000-000000000010');
    RAISE EXCEPTION 'Unauthorized branch roster was readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
