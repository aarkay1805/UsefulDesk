-- ============================================================
-- 047_lead_ownership_ops.sql — lead ownership + first-response infra
--
-- Four tightly-related pieces behind the "every lead has an owner and
-- a next action" PRD rules:
--
-- 1) contacts.assigned_to FK repoint — 039 pointed it at profiles(id),
--    but every consumer (staff pickers, the leads Assigned filter,
--    follow_ups.assigned_to, conversations.assigned_agent_id) keys
--    staff by the AUTH user id (profiles.user_id). The column was
--    all-NULL until now (no write UI existed), so repointing to
--    auth.users(id) is a no-op for data and makes the app's writes
--    valid.
--
-- 2) notifications.type gains 'lead_assigned' + 'follow_up_reminder'.
--
-- 3) notify_lead_assigned trigger — assigning a lead notifies the new
--    owner in-app (skips self-assignment), mirroring 027's
--    conversation-assignment trigger. SECURITY DEFINER because
--    clients have no INSERT policy on notifications.
--
-- 4) lead_status_changed_at + trigger — stage-aging for reporting
--    ("how long has this lead sat in Contacted?"). Backfilled lazily:
--    NULL means "unchanged since creation"; readers COALESCE to
--    created_at.
--
-- 5) follow_ups.reminder_sent_at — claim column for the reminder
--    delivery runner (claim-first UPDATE ... WHERE reminder_sent_at
--    IS NULL, so overlapping cron runs can't double-notify).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1) assigned_to → auth.users(id)
-- ------------------------------------------------------------

-- Defensive: NULL any value that wouldn't satisfy the new FK (none
-- expected — the column had no write path before this migration).
UPDATE contacts SET assigned_to = NULL
WHERE assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = contacts.assigned_to);

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_assigned_to_fkey;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_assigned_to_fkey'
  ) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_assigned_to_fkey
      FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) notification types
-- ------------------------------------------------------------

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'lead_assigned', 'follow_up_reminder'));

-- ------------------------------------------------------------
-- 3) notify the new owner on lead assignment
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_lead_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_to IS NULL
       OR NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Self-assignment (manual create defaults to the creator) — nothing
  -- to notify. auth.uid() is NULL under the service-role client
  -- (automations), which SHOULD notify, so only skip a real self-pick.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_to THEN
    RETURN NEW;
  END IF;

  v_contact_name := COALESCE(NULLIF(TRIM(NEW.name), ''), NEW.phone, 'a lead');
  SELECT full_name INTO v_actor_name FROM profiles WHERE user_id = auth.uid();

  INSERT INTO notifications (account_id, user_id, type, contact_id, actor_user_id, title, body)
  VALUES (
    NEW.account_id,
    NEW.assigned_to,
    'lead_assigned',
    NEW.id,
    auth.uid(),
    'Lead assigned to you',
    v_contact_name
      || CASE WHEN v_actor_name IS NOT NULL AND v_actor_name <> ''
              THEN ' — assigned by ' || v_actor_name
              ELSE '' END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_notify_lead_assigned ON contacts;
CREATE TRIGGER trg_contacts_notify_lead_assigned
  AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION notify_lead_assigned();

-- ------------------------------------------------------------
-- 4) stage aging
-- ------------------------------------------------------------

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_status_changed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION touch_lead_status_changed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lead_status IS NOT NULL THEN
      NEW.lead_status_changed_at := NOW();
    END IF;
  ELSIF NEW.lead_status IS DISTINCT FROM OLD.lead_status THEN
    NEW.lead_status_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_lead_status_changed ON contacts;
CREATE TRIGGER trg_contacts_lead_status_changed
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION touch_lead_status_changed_at();

-- ------------------------------------------------------------
-- 5) reminder delivery claim
-- ------------------------------------------------------------

ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- The runner's scan: open tasks whose reminder is due and unclaimed.
CREATE INDEX IF NOT EXISTS idx_follow_ups_reminder_due
  ON follow_ups(remind_at)
  WHERE status = 'open' AND remind_at IS NOT NULL AND reminder_sent_at IS NULL;

-- ------------------------------------------------------------
-- 6) funnel + conversion aggregates for the dashboard
--
-- SECURITY INVOKER: both run under the caller's RLS, so contacts /
-- memberships are already scoped to their account — no account param
-- (same posture as filter_contacts_by_tags, 025). SQL-side GROUP BY
-- keeps counts exact past PostgREST's row cap.
-- ------------------------------------------------------------

-- Per-status lead counts + how long those leads have sat in their
-- current status (stage aging). NULL lead_status = the "New" bucket;
-- lead_status_changed_at falls back to created_at (pre-047 rows).
CREATE OR REPLACE FUNCTION public.lead_funnel_stats()
RETURNS TABLE (lead_status TEXT, lead_count BIGINT, avg_days_in_stage NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.lead_status,
    count(*) AS lead_count,
    round(
      (avg(EXTRACT(EPOCH FROM (now() - COALESCE(c.lead_status_changed_at, c.created_at)))) / 86400)::numeric,
      1
    ) AS avg_days_in_stage
  FROM contacts c
  WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.contact_id = c.id)
  GROUP BY c.lead_status;
$$;

ALTER FUNCTION public.lead_funnel_stats() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lead_funnel_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lead_funnel_stats() TO authenticated;

-- Acquisition performance: per source, how many contacts are still
-- leads vs converted to members. NULL source groups as 'unknown'.
CREATE OR REPLACE FUNCTION public.lead_source_conversion()
RETURNS TABLE (source TEXT, leads BIGINT, members BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(TRIM(c.source), ''), 'unknown') AS source,
    count(*) FILTER (
      WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.contact_id = c.id)
    ) AS leads,
    count(*) FILTER (
      WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.contact_id = c.id)
    ) AS members
  FROM contacts c
  GROUP BY 1;
$$;

ALTER FUNCTION public.lead_source_conversion() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lead_source_conversion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lead_source_conversion() TO authenticated;
