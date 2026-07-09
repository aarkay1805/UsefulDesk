-- ============================================================
-- 051_contact_created_by.sql — immutable original creator
--
-- Migration 050 made "ownership" = `contacts.user_id` transferable (the
-- "Received by" owner). That means user_id no longer records WHO first
-- created the lead once it's been handed off. This adds an immutable
-- `created_by` to preserve that audit fact.
--
-- Three distinct facts now:
--   · received_via — origin CHANNEL (manual/import/whatsapp/…), immutable
--   · created_by   — original human creator (auth user), immutable  ← NEW
--   · user_id      — current human owner ("Received by"), transferable
--
-- Set once at INSERT (defaults to user_id, the creator = first owner) and
-- frozen on every UPDATE by a trigger, so no insert path needs editing and
-- a transfer (which rewrites user_id) can never move it.
--
-- Idempotent.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill: for existing rows the creator is (still) user_id. Rows already
-- transferred in testing take the current owner as a best-effort seed — the
-- true creator wasn't recorded before this migration.
UPDATE contacts SET created_by = user_id
  WHERE created_by IS NULL AND user_id IS NOT NULL;

-- Stamp on insert, freeze on update.
CREATE OR REPLACE FUNCTION lock_contact_created_by()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := NEW.user_id;
    END IF;
  ELSE
    -- Immutable: ignore any attempt to change it (e.g. an ownership
    -- transfer rewriting user_id must not touch created_by).
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_lock_created_by ON contacts;
CREATE TRIGGER trg_contacts_lock_created_by
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION lock_contact_created_by();
