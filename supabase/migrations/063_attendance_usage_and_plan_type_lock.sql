-- ============================================================
-- 063_attendance_usage_and_plan_type_lock.sql — 062 follow-up fixes.
--
--   * attendance_usage_counts(): server-side GROUP BY for the check-in
--     page's per-membership usage counts, each membership against its
--     OWN window start. Replaces a client-side raw-rows fetch over the
--     global earliest window, which the PostgREST max-rows cap (1000)
--     could silently truncate into an UNDERCOUNT — a member at 12/12
--     reading 7/12 and never triggering the over-limit warning.
--     SECURITY INVOKER: RLS on attendance scopes the caller to their
--     own account's rows, so the counts can't leak across tenants.
--
--   * idx_attendance_membership_time: the 062 check-in features filter
--     attendance by membership_id + checked_in_at range on every
--     check-in tap, member-sheet open, and check-in list load; the bare
--     idx_attendance_membership (032) forced a heap-filter over a
--     member's whole visit history. The composite index supersedes it.
--
--   * lock_live_plan_type: the plan editor's "type locks once members
--     reference the plan" rule was UI-only (an async count disabling
--     the picker — racy, and absent for direct PostgREST calls).
--     Flipping a live plan's type re-interprets every membership on it
--     (renewal chase membership, session math), so the invariant now
--     lives in the DB per the both-layers rule.
--
-- Idempotent: CREATE OR REPLACE functions, IF NOT EXISTS / IF EXISTS
-- DDL, drop-then-create trigger.
-- ============================================================

-- ============================================================
-- BATCHED USAGE COUNTS (check-in page)
-- ============================================================
CREATE OR REPLACE FUNCTION public.attendance_usage_counts(
  p_membership_ids UUID[],
  p_window_starts TIMESTAMPTZ[]
)
RETURNS TABLE(membership_id UUID, used BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT t.membership_id, COUNT(a.id) AS used
  FROM unnest(p_membership_ids, p_window_starts) AS t(membership_id, window_start)
  LEFT JOIN public.attendance a
    ON a.membership_id = t.membership_id
   AND a.checked_in_at >= t.window_start
  GROUP BY t.membership_id;
$$;

REVOKE EXECUTE ON FUNCTION public.attendance_usage_counts(UUID[], TIMESTAMPTZ[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_usage_counts(UUID[], TIMESTAMPTZ[])
  TO authenticated;

-- ============================================================
-- COMPOSITE ATTENDANCE INDEX (hot: usage window counts)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_attendance_membership_time
  ON attendance(membership_id, checked_in_at DESC);
DROP INDEX IF EXISTS idx_attendance_membership;

-- ============================================================
-- PLAN TYPE LOCK (DB layer of the editor's UI lock)
-- ============================================================
CREATE OR REPLACE FUNCTION lock_live_plan_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.plan_type IS DISTINCT FROM OLD.plan_type
     AND EXISTS (SELECT 1 FROM memberships WHERE plan_id = OLD.id) THEN
    RAISE EXCEPTION 'This plan''s type is locked — members are on it. Archive it and create a new plan instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_live_plan_type ON membership_plans;
CREATE TRIGGER lock_live_plan_type BEFORE UPDATE ON membership_plans
  FOR EACH ROW EXECUTE FUNCTION lock_live_plan_type();
