-- Consolidate the Leads table/board page, exact total, quick-filter facets,
-- related-field sorting, and rendered row hydration into one RLS-preserving
-- statement. Ordinary table/board reads are bounded; ids/export are explicit
-- user actions that preserve select-all and CSV semantics.

CREATE INDEX IF NOT EXISTS idx_contact_tags_tag_contact
  ON public.contact_tags(tag_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_custom_values_field_value_contact
  ON public.contact_custom_values(custom_field_id, value, contact_id);

-- These child reads previously invoked is_account_member for every link/value.
-- Keep the same parent-contact and selected-account boundary while moving the
-- row-independent authorization lookup into an initPlan.
DROP POLICY IF EXISTS contact_tags_select ON public.contact_tags;
DROP POLICY IF EXISTS contact_tags_modify ON public.contact_tags;
DROP POLICY IF EXISTS contact_tags_insert ON public.contact_tags;
DROP POLICY IF EXISTS contact_tags_update ON public.contact_tags;
DROP POLICY IF EXISTS contact_tags_delete ON public.contact_tags;
CREATE POLICY contact_tags_select ON public.contact_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_tags.contact_id
        AND contact.account_id = (
          SELECT private.authorized_selected_account_id()
        )
    )
  );

CREATE POLICY contact_tags_insert ON public.contact_tags
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_tags.contact_id
        AND public.is_account_member(contact.account_id, 'agent')
    )
  );
CREATE POLICY contact_tags_update ON public.contact_tags
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_tags.contact_id
        AND public.is_account_member(contact.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_tags.contact_id
        AND public.is_account_member(contact.account_id, 'agent')
    )
  );
CREATE POLICY contact_tags_delete ON public.contact_tags
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_tags.contact_id
        AND public.is_account_member(contact.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS contact_custom_values_select
  ON public.contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_modify
  ON public.contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_insert
  ON public.contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_update
  ON public.contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_delete
  ON public.contact_custom_values;
CREATE POLICY contact_custom_values_select ON public.contact_custom_values
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_custom_values.contact_id
        AND contact.account_id = (
          SELECT private.authorized_selected_account_id()
        )
    )
  );

CREATE POLICY contact_custom_values_insert ON public.contact_custom_values
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_custom_values.contact_id
        AND public.is_account_member(contact.account_id, 'agent')
    )
  );
CREATE POLICY contact_custom_values_update ON public.contact_custom_values
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_custom_values.contact_id
        AND public.is_account_member(contact.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_custom_values.contact_id
        AND public.is_account_member(contact.account_id, 'agent')
    )
  );
CREATE POLICY contact_custom_values_delete ON public.contact_custom_values
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = contact_custom_values.contact_id
        AND public.is_account_member(contact.account_id, 'agent')
    )
  );

CREATE OR REPLACE FUNCTION public.lead_listing_snapshot(
  p_account_id UUID,
  p_mode TEXT,
  p_search TEXT,
  p_owner_ids UUID[],
  p_assigned_ids UUID[],
  p_include_unassigned BOOLEAN,
  p_pending_invitation_ids UUID[],
  p_created_by_ids UUID[],
  p_lead_statuses TEXT[],
  p_sources TEXT[],
  p_tag_ids UUID[],
  p_genders TEXT[],
  p_created_since TIMESTAMPTZ,
  p_custom_filters JSONB,
  p_quick_filter TEXT,
  p_today_start TIMESTAMPTZ,
  p_tomorrow_start TIMESTAMPTZ,
  p_sort_key TEXT,
  p_sort_direction TEXT,
  p_sort_custom_field_id UUID,
  p_page INTEGER,
  p_page_size INTEGER,
  p_active_custom_field_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mode TEXT := COALESCE(p_mode, 'table');
  v_search TEXT := pg_catalog.btrim(COALESCE(p_search, ''));
  v_owner_ids UUID[] := COALESCE(p_owner_ids, ARRAY[]::UUID[]);
  v_assigned_ids UUID[] := COALESCE(p_assigned_ids, ARRAY[]::UUID[]);
  v_include_unassigned BOOLEAN := COALESCE(p_include_unassigned, FALSE);
  v_pending_invitation_ids UUID[] := COALESCE(
    p_pending_invitation_ids,
    ARRAY[]::UUID[]
  );
  v_created_by_ids UUID[] := COALESCE(p_created_by_ids, ARRAY[]::UUID[]);
  v_lead_statuses TEXT[] := COALESCE(p_lead_statuses, ARRAY[]::TEXT[]);
  v_sources TEXT[] := COALESCE(p_sources, ARRAY[]::TEXT[]);
  v_tag_ids UUID[] := COALESCE(p_tag_ids, ARRAY[]::UUID[]);
  v_genders TEXT[] := COALESCE(p_genders, ARRAY[]::TEXT[]);
  v_custom_filters JSONB := COALESCE(p_custom_filters, '{}'::JSONB);
  v_quick_filter TEXT := COALESCE(p_quick_filter, 'all');
  v_sort_key TEXT := COALESCE(p_sort_key, 'created_at');
  v_sort_direction TEXT := COALESCE(p_sort_direction, 'desc');
  v_active_custom_field_ids UUID[] := COALESCE(
    p_active_custom_field_ids,
    ARRAY[]::UUID[]
  );
  v_custom_sort_numeric BOOLEAN := FALSE;
  v_offset INTEGER;
  v_result JSONB;
BEGIN
  IF NOT public.is_account_member(p_account_id) THEN
    RAISE EXCEPTION 'Selected branch access is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_mode NOT IN ('table', 'board', 'ids', 'export') THEN
    RAISE EXCEPTION 'Lead listing mode is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_page IS NULL OR p_page < 0 THEN
    RAISE EXCEPTION 'Lead listing page must be zero or greater'
      USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'table'
     AND (p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 1000) THEN
    RAISE EXCEPTION 'Lead table page size must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'board'
     AND (p_page <> 0 OR p_page_size IS NULL
       OR p_page_size < 1 OR p_page_size > 500) THEN
    RAISE EXCEPTION 'Lead board reads must start at page zero and contain at most 500 rows'
      USING ERRCODE = '22023';
  END IF;
  IF v_mode IN ('ids', 'export')
     AND (p_page <> 0 OR p_page_size IS NOT NULL) THEN
    RAISE EXCEPTION 'Unbounded lead actions must start at page zero'
      USING ERRCODE = '22023';
  END IF;
  IF v_quick_filter NOT IN (
    'all', 'no_followup', 'unassigned', 'mine', 'new_today'
  ) THEN
    RAISE EXCEPTION 'Lead quick filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_today_start IS NULL
     OR p_tomorrow_start IS NULL
     OR p_tomorrow_start <= p_today_start THEN
    RAISE EXCEPTION 'Lead quick-filter day bounds are invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_key NOT IN (
    'name',
    'lead_status',
    'phone',
    'email',
    'company',
    'source',
    'gender',
    'received_via',
    'created_at',
    'assigned_name',
    'created_by_name',
    'tag_name',
    'custom'
  ) THEN
    RAISE EXCEPTION 'Lead listing sort is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Lead listing sort direction is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF (v_sort_key = 'custom') <> (p_sort_custom_field_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Custom lead sort requires exactly one custom field'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.cardinality(v_owner_ids) > 1000
     OR pg_catalog.cardinality(v_assigned_ids) > 1000
     OR pg_catalog.cardinality(v_pending_invitation_ids) > 1000
     OR pg_catalog.cardinality(v_created_by_ids) > 1000
     OR pg_catalog.cardinality(v_lead_statuses) > 1000
     OR pg_catalog.cardinality(v_sources) > 1000
     OR pg_catalog.cardinality(v_tag_ids) > 1000
     OR pg_catalog.cardinality(v_genders) > 1000
     OR pg_catalog.cardinality(v_active_custom_field_ids) > 1000 THEN
    RAISE EXCEPTION 'Lead listing filter is too large'
      USING ERRCODE = '54000';
  END IF;
  IF pg_catalog.jsonb_typeof(v_custom_filters) <> 'object' THEN
    RAISE EXCEPTION 'Lead custom filters must be an object'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(v_custom_filters)
      AS dimension(field_id, selected_values)
    WHERE pg_catalog.jsonb_typeof(dimension.selected_values) <> 'array'
      OR pg_catalog.jsonb_array_length(dimension.selected_values) = 0
      OR pg_catalog.jsonb_array_length(dimension.selected_values) > 1000
      OR dimension.field_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(dimension.selected_values)
          AS item(value)
        WHERE pg_catalog.jsonb_typeof(item.value) <> 'string'
      )
  ) THEN
    RAISE EXCEPTION 'Lead custom filter dimensions are invalid'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(v_custom_filters) AS dimension(field_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.custom_fields AS field
      WHERE field.id = dimension.field_id::UUID
        AND field.account_id = p_account_id
    )
  ) THEN
    RAISE EXCEPTION 'Lead custom filter field is outside the selected branch'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(v_tag_ids) AS selected(tag_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.tags AS tag
      WHERE tag.id = selected.tag_id
        AND tag.account_id = p_account_id
    )
  ) THEN
    RAISE EXCEPTION 'Lead tag filter is outside the selected branch'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(v_active_custom_field_ids) AS selected(field_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.custom_fields AS field
      WHERE field.id = selected.field_id
        AND field.account_id = p_account_id
    )
  ) THEN
    RAISE EXCEPTION 'Active lead custom field is outside the selected branch'
      USING ERRCODE = '22023';
  END IF;

  IF v_sort_key = 'custom' THEN
    SELECT field.field_type IN ('number', 'currency')
    INTO v_custom_sort_numeric
    FROM public.custom_fields AS field
    WHERE field.id = p_sort_custom_field_id
      AND field.account_id = p_account_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lead custom sort field is outside the selected branch'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_offset := CASE
    WHEN p_page_size IS NULL THEN 0
    ELSE p_page * p_page_size
  END;

  WITH filtered_leads AS MATERIALIZED (
    SELECT
      contact.*,
      NULLIF(pg_catalog.btrim(assignee.full_name), '') AS assigned_name,
      NULLIF(pg_catalog.btrim(creator.full_name), '') AS created_by_name,
      tag_key.value AS tag_name,
      custom_key.value AS custom_sort_value,
      (
        contact.lead_status IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.follow_ups AS follow_up
          WHERE follow_up.account_id = p_account_id
            AND follow_up.contact_id = contact.id
            AND follow_up.status = 'open'
        )
      ) AS is_no_followup,
      (
        (contact.lead_status IS NULL OR contact.lead_status <> 'lost')
        AND contact.assigned_to IS NULL
        AND contact.pending_invitation_id IS NULL
      ) AS is_unassigned,
      (
        (contact.lead_status IS NULL OR contact.lead_status <> 'lost')
        AND contact.assigned_to = auth.uid()
      ) AS is_mine,
      (
        contact.lead_status IS NULL
        AND contact.created_at >= p_today_start
        AND contact.created_at < p_tomorrow_start
      ) AS is_new_today
    FROM public.contacts AS contact
    LEFT JOIN public.profiles AS assignee
      ON assignee.user_id = contact.assigned_to
     AND assignee.account_id = p_account_id
    LEFT JOIN public.profiles AS creator
      ON creator.user_id = contact.created_by
     AND creator.account_id = p_account_id
    LEFT JOIN LATERAL (
      SELECT MIN(tag.name) AS value
      FROM public.contact_tags AS link
      JOIN public.tags AS tag ON tag.id = link.tag_id
      WHERE v_sort_key = 'tag_name'
        AND link.contact_id = contact.id
        AND tag.account_id = p_account_id
    ) AS tag_key ON TRUE
    LEFT JOIN LATERAL (
      SELECT NULLIF(pg_catalog.btrim(value.value), '') AS value
      FROM public.contact_custom_values AS value
      WHERE v_sort_key = 'custom'
        AND value.contact_id = contact.id
        AND value.custom_field_id = p_sort_custom_field_id
    ) AS custom_key ON TRUE
    WHERE contact.account_id = p_account_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.memberships AS membership
        WHERE membership.account_id = p_account_id
          AND membership.contact_id = contact.id
      )
      AND (
        v_search = ''
        OR contact.name ILIKE '%' || v_search || '%'
        OR contact.phone ILIKE '%' || v_search || '%'
        OR contact.email ILIKE '%' || v_search || '%'
      )
      AND (
        pg_catalog.cardinality(v_owner_ids) = 0
        OR contact.user_id = ANY(v_owner_ids)
      )
      AND (
        pg_catalog.cardinality(v_created_by_ids) = 0
        OR contact.created_by = ANY(v_created_by_ids)
      )
      AND (
        pg_catalog.cardinality(v_lead_statuses) = 0
        OR (
          'new' = ANY(v_lead_statuses)
          AND contact.lead_status IS NULL
        )
        OR contact.lead_status = ANY(v_lead_statuses)
      )
      AND (
        pg_catalog.cardinality(v_sources) = 0
        OR contact.source = ANY(v_sources)
      )
      AND (
        pg_catalog.cardinality(v_genders) = 0
        OR contact.gender = ANY(v_genders)
      )
      AND (
        NOT v_include_unassigned
        AND pg_catalog.cardinality(v_assigned_ids) = 0
        AND pg_catalog.cardinality(v_pending_invitation_ids) = 0
        OR v_include_unassigned AND contact.assigned_to IS NULL
        OR contact.assigned_to = ANY(v_assigned_ids)
        OR contact.pending_invitation_id = ANY(v_pending_invitation_ids)
      )
      AND (p_created_since IS NULL OR contact.created_at >= p_created_since)
      AND (
        pg_catalog.cardinality(v_tag_ids) = 0
        OR EXISTS (
          SELECT 1
          FROM public.contact_tags AS link
          WHERE link.contact_id = contact.id
            AND link.tag_id = ANY(v_tag_ids)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_each(v_custom_filters)
          AS dimension(field_id, selected_values)
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.contact_custom_values AS stored
          WHERE stored.contact_id = contact.id
            AND stored.custom_field_id = dimension.field_id::UUID
            AND stored.value IN (
              SELECT pg_catalog.jsonb_array_elements_text(
                dimension.selected_values
              )
            )
        )
      )
  ),
  active_leads AS MATERIALIZED (
    SELECT filtered.*
    FROM filtered_leads AS filtered
    WHERE v_quick_filter = 'all'
      OR v_quick_filter = 'no_followup' AND filtered.is_no_followup
      OR v_quick_filter = 'unassigned' AND filtered.is_unassigned
      OR v_quick_filter = 'mine' AND filtered.is_mine
      OR v_quick_filter = 'new_today' AND filtered.is_new_today
  ),
  ordered AS (
    SELECT
      active.*,
      pg_catalog.row_number() OVER (
        ORDER BY
          CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'asc'
            THEN active.name END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'desc'
            THEN active.name END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'lead_status' AND v_sort_direction = 'asc'
            THEN active.lead_status END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'lead_status' AND v_sort_direction = 'desc'
            THEN active.lead_status END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'phone' AND v_sort_direction = 'asc'
            THEN active.phone END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'phone' AND v_sort_direction = 'desc'
            THEN active.phone END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'email' AND v_sort_direction = 'asc'
            THEN active.email END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'email' AND v_sort_direction = 'desc'
            THEN active.email END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'company' AND v_sort_direction = 'asc'
            THEN active.company END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'company' AND v_sort_direction = 'desc'
            THEN active.company END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'source' AND v_sort_direction = 'asc'
            THEN active.source END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'source' AND v_sort_direction = 'desc'
            THEN active.source END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'gender' AND v_sort_direction = 'asc'
            THEN active.gender END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'gender' AND v_sort_direction = 'desc'
            THEN active.gender END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'received_via' AND v_sort_direction = 'asc'
            THEN active.received_via END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'received_via' AND v_sort_direction = 'desc'
            THEN active.received_via END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'asc'
            THEN active.created_at END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'desc'
            THEN active.created_at END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'assigned_name' AND v_sort_direction = 'asc'
            THEN active.assigned_name END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'assigned_name' AND v_sort_direction = 'desc'
            THEN active.assigned_name END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'created_by_name' AND v_sort_direction = 'asc'
            THEN active.created_by_name END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'created_by_name' AND v_sort_direction = 'desc'
            THEN active.created_by_name END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'tag_name' AND v_sort_direction = 'asc'
            THEN active.tag_name END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'tag_name' AND v_sort_direction = 'desc'
            THEN active.tag_name END DESC NULLS LAST,
          CASE
            WHEN v_sort_key = 'custom'
              AND v_custom_sort_numeric
              AND v_sort_direction = 'asc'
            THEN CASE
              WHEN active.custom_sort_value IS NULL THEN NULL
              WHEN active.custom_sort_value
                ~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
              THEN active.custom_sort_value::NUMERIC
              ELSE 0
            END
          END ASC NULLS LAST,
          CASE
            WHEN v_sort_key = 'custom'
              AND v_custom_sort_numeric
              AND v_sort_direction = 'desc'
            THEN CASE
              WHEN active.custom_sort_value IS NULL THEN NULL
              WHEN active.custom_sort_value
                ~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
              THEN active.custom_sort_value::NUMERIC
              ELSE 0
            END
          END DESC NULLS LAST,
          CASE
            WHEN v_sort_key = 'custom'
              AND NOT v_custom_sort_numeric
              AND v_sort_direction = 'asc'
            THEN active.custom_sort_value
          END ASC NULLS LAST,
          CASE
            WHEN v_sort_key = 'custom'
              AND NOT v_custom_sort_numeric
              AND v_sort_direction = 'desc'
            THEN active.custom_sort_value
          END DESC NULLS LAST,
          active.created_at DESC,
          active.id
      ) AS row_order
    FROM active_leads AS active
  ),
  page_rows AS MATERIALIZED (
    SELECT ordered.*
    FROM ordered
    ORDER BY ordered.row_order
    LIMIT p_page_size
    OFFSET v_offset
  ),
  page_tags AS MATERIALIZED (
    SELECT
      link.contact_id,
      pg_catalog.jsonb_agg(pg_catalog.to_jsonb(tag) ORDER BY tag.name, tag.id)
        AS tags
    FROM public.contact_tags AS link
    JOIN public.tags AS tag ON tag.id = link.tag_id
    JOIN page_rows AS page ON page.id = link.contact_id
    WHERE v_mode <> 'ids'
      AND tag.account_id = p_account_id
    GROUP BY link.contact_id
  ),
  page_custom_values AS MATERIALIZED (
    SELECT
      stored.contact_id,
      pg_catalog.jsonb_object_agg(
        stored.custom_field_id::TEXT,
        COALESCE(stored.value, '')
      ) AS values
    FROM public.contact_custom_values AS stored
    JOIN page_rows AS page ON page.id = stored.contact_id
    WHERE v_mode = 'table'
      AND stored.custom_field_id = ANY(v_active_custom_field_ids)
    GROUP BY stored.contact_id
  ),
  payload_rows AS (
    SELECT
      page.row_order,
      CASE
        WHEN v_mode = 'ids' THEN pg_catalog.jsonb_build_object('id', page.id)
        ELSE (
          pg_catalog.to_jsonb(page)
            - ARRAY[
              'assigned_name',
              'created_by_name',
              'tag_name',
              'custom_sort_value',
              'is_no_followup',
              'is_unassigned',
              'is_mine',
              'is_new_today',
              'row_order'
            ]::TEXT[]
        ) || pg_catalog.jsonb_build_object(
          'tags', COALESCE(tag_values.tags, '[]'::JSONB),
          'customValues', COALESCE(custom_values.values, '{}'::JSONB)
        )
      END AS value
    FROM page_rows AS page
    LEFT JOIN page_tags AS tag_values ON tag_values.contact_id = page.id
    LEFT JOIN page_custom_values AS custom_values
      ON custom_values.contact_id = page.id
  ),
  aggregate_counts AS (
    SELECT
      COUNT(*) FILTER (
        WHERE v_quick_filter = 'all'
          OR v_quick_filter = 'no_followup' AND filtered.is_no_followup
          OR v_quick_filter = 'unassigned' AND filtered.is_unassigned
          OR v_quick_filter = 'mine' AND filtered.is_mine
          OR v_quick_filter = 'new_today' AND filtered.is_new_today
      ) AS total_count,
      CASE WHEN v_mode IN ('table', 'board')
        THEN COUNT(*) FILTER (WHERE filtered.is_no_followup)
        ELSE 0
      END AS no_followup_count,
      CASE WHEN v_mode IN ('table', 'board')
        THEN COUNT(*) FILTER (WHERE filtered.is_unassigned)
        ELSE 0
      END AS unassigned_count,
      CASE WHEN v_mode IN ('table', 'board')
        THEN COUNT(*) FILTER (WHERE filtered.is_mine)
        ELSE 0
      END AS mine_count,
      CASE WHEN v_mode IN ('table', 'board')
        THEN COUNT(*) FILTER (WHERE filtered.is_new_today)
        ELSE 0
      END AS new_today_count
    FROM filtered_leads AS filtered
  )
  SELECT pg_catalog.jsonb_build_object(
    'rows', COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(payload.value ORDER BY payload.row_order)
        FROM payload_rows AS payload
      ),
      '[]'::JSONB
    ),
    'totalCount', aggregate.total_count,
    'quickFilterCounts', pg_catalog.jsonb_build_object(
      'no_followup', aggregate.no_followup_count,
      'unassigned', aggregate.unassigned_count,
      'mine', aggregate.mine_count,
      'new_today', aggregate.new_today_count
    )
  )
  INTO v_result
  FROM aggregate_counts AS aggregate;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.lead_listing_snapshot(
  UUID, TEXT, TEXT, UUID[], UUID[], BOOLEAN, UUID[], UUID[], TEXT[], TEXT[],
  UUID[], TEXT[], TIMESTAMPTZ, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  TEXT, UUID, INTEGER, INTEGER, UUID[]
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.lead_listing_snapshot(
  UUID, TEXT, TEXT, UUID[], UUID[], BOOLEAN, UUID[], UUID[], TEXT[], TEXT[],
  UUID[], TEXT[], TIMESTAMPTZ, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  TEXT, UUID, INTEGER, INTEGER, UUID[]
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.lead_listing_snapshot(
  UUID, TEXT, TEXT, UUID[], UUID[], BOOLEAN, UUID[], UUID[], TEXT[], TEXT[],
  UUID[], TEXT[], TIMESTAMPTZ, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  TEXT, UUID, INTEGER, INTEGER, UUID[]
) TO authenticated;

COMMENT ON FUNCTION public.lead_listing_snapshot(
  UUID, TEXT, TEXT, UUID[], UUID[], BOOLEAN, UUID[], UUID[], TEXT[], TEXT[],
  UUID[], TEXT[], TIMESTAMPTZ, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  TEXT, UUID, INTEGER, INTEGER, UUID[]
) IS 'One bounded RLS-preserving selected-branch Leads table/board snapshot; explicit ids/export modes preserve user-triggered bulk actions.';
