-- ============================================================
-- 039_leads.sql — contacts become "leads"
--
-- Product decision: Contacts and Pipelines merge into a single
-- Leads section. A lead IS a contacts row — no new entity. Two
-- new columns carry the pipeline features worth keeping:
--
--   lead_status  — the kanban column / qualification state.
--                  NULL means "New" (not yet assessed); the four
--                  named states are fixed for now (configurable
--                  statuses are a later milestone).
--   assigned_to  — the staff member who owns the lead follow-up
--                  (replaces deals.assigned_to). SET NULL on
--                  profile removal, mirroring deals (002).
--
-- The deals/pipelines tables are left untouched — the UI is
-- retired but historical data stays queryable until we decide
-- to drop it.
--
-- No RLS changes: both columns ride on the existing contacts
-- policies (read = member, write = agent+, migration 017).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_status TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lead_status_check'
  ) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_lead_status_check
      CHECK (
        lead_status IS NULL
        OR lead_status IN ('interested', 'not_interested', 'high_opportunity', 'low_opportunity')
      );
  END IF;
END $$;

-- The Leads board groups by status within an account; the assignee
-- index serves "my leads" filtering later.
CREATE INDEX IF NOT EXISTS idx_contacts_lead_status ON contacts(account_id, lead_status);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned_to ON contacts(assigned_to);

-- ------------------------------------------------------------
-- filter_contacts_by_tags gains p_exclude_members so the Leads
-- list (leads = contacts WITHOUT a membership) can keep using the
-- server-side tag filter from 025. Postgres would treat the new
-- defaulted parameter as an overload (ambiguous from PostgREST),
-- so drop the old signature first.
--
-- Still SECURITY INVOKER: the memberships subquery runs under the
-- caller's RLS, same account scoping as contacts itself.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.filter_contacts_by_tags(UUID[], TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_exclude_members BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    -- Distinct contacts having ANY of the selected tags (OR),
    -- narrowed by the same name/phone/email search as the list.
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
      AND (
        NOT p_exclude_members
        OR NOT EXISTS (
          SELECT 1 FROM memberships m WHERE m.contact_id = c.id
        )
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, BOOLEAN) TO authenticated;
