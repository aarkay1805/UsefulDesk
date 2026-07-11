-- ============================================================
-- 056_member_profile_fields.sql
--
-- Member detail sheet 3.0: richer profile fields + a hard-delete
-- path for a member record.
--
-- 1. New nullable columns on `contacts` backing:
--    - the BMI widget (height_cm, weight_kg — metric canonical,
--      converted for imperial accounts at the UI layer). A future
--      "Vitals" section reads/writes these same columns.
--    - the Personal Information section (date_of_birth, nickname,
--      full postal address). `name`/`phone`/`email`/`gender`
--      already exist and are reused as-is.
--
-- 2. delete_member(contact_id) — a SECURITY DEFINER purge. The
--    generic contacts_delete RLS policy (017) is agent-level, but
--    deleting a MEMBER is a stricter product action gated to
--    owner/admin. Enforcing that in SQL (not just the UI) keeps the
--    gate real. It also purges the `payments` ledger, which would
--    otherwise be orphaned (payments.contact_id is ON DELETE SET
--    NULL, not CASCADE) — the rest (memberships, attendance,
--    contact_notes, follow_ups) cascades off the contact row.
-- ============================================================

-- 1. Profile columns ----------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS height_cm      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS weight_kg      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS date_of_birth  DATE,
  ADD COLUMN IF NOT EXISTS nickname       TEXT,
  ADD COLUMN IF NOT EXISTS address_line1  TEXT,
  ADD COLUMN IF NOT EXISTS address_line2  TEXT,
  ADD COLUMN IF NOT EXISTS city           TEXT,
  ADD COLUMN IF NOT EXISTS state          TEXT,
  ADD COLUMN IF NOT EXISTS postal_code    TEXT,
  ADD COLUMN IF NOT EXISTS country        TEXT;

-- 2. Owner/admin member purge -------------------------------------------------
CREATE OR REPLACE FUNCTION delete_member(p_contact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM contacts WHERE id = p_contact_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Stricter than contacts_delete RLS (agent) — member removal is
  -- an owner/admin action.
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Only an owner or admin can delete a member';
  END IF;

  -- payments FK is SET NULL, so cascade would leave dangling ledger
  -- rows — purge them explicitly while the contact still exists.
  DELETE FROM payments WHERE contact_id = p_contact_id;

  -- Cascades memberships, attendance, contact_notes, follow_ups.
  DELETE FROM contacts WHERE id = p_contact_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_member(UUID) TO authenticated;
