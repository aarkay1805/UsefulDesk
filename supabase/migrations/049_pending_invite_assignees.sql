-- ============================================================
-- 049_pending_invite_assignees.sql
--
-- Lets the Leads CSV import assign leads to a teammate who does
-- NOT exist yet — a "pending invite" — resolved later when that
-- person redeems their link. Reuses the existing
-- `account_invitations` machinery (bearer token links) rather
-- than a parallel pending-staff table.
--
-- Why this shape (see PRDs/import_leads_ux.md §10a):
--   * contacts.assigned_to is FK -> auth.users(id); a pending
--     invite has no auth user, so it CANNOT go in assigned_to.
--     A second, nullable slot (pending_invitation_id) holds the
--     parked assignment; assigned_to stays the importer as the
--     always-present fallback owner (so revoking/expiring an
--     invite never leaves a lead ownerless).
--   * The leads table renders "Invite pending · <name>" for
--     agents too, but account_invitations is admin-only — so the
--     display name is denormalized onto the contact
--     (pending_assignee_name) to avoid widening invite RLS.
--   * On redeem, the parked leads are handed to the new user and
--     the overlay cleared. The reassign assigns to the *caller
--     themselves*, so notify_lead_assigned's self-assignment
--     guard (auth.uid() = NEW.assigned_to) suppresses the per-row
--     notification flood automatically — no trigger change.
--
-- Idempotent.
-- ============================================================

-- 1) A display name for the invited person (import fills this;
--    the manual "invite member" dialog leaves it null and keeps
--    using `label` as a free-text memo).
ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS full_name TEXT;

-- 2) Parked assignment on the lead. ON DELETE SET NULL so revoking
--    an invite cleanly drops the overlay (the lead falls back to
--    its assigned_to = importer).
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pending_invitation_id UUID,
  ADD COLUMN IF NOT EXISTS pending_assignee_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_pending_invitation_id_fkey'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_pending_invitation_id_fkey
      FOREIGN KEY (pending_invitation_id)
      REFERENCES account_invitations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Partial index: the redeem reassign and the "pending" leads
-- filter both scan by this, and only a small slice of rows are
-- ever pending.
CREATE INDEX IF NOT EXISTS idx_contacts_pending_invitation
  ON contacts(pending_invitation_id)
  WHERE pending_invitation_id IS NOT NULL;

-- 3) redeem_invitation — same as 019, plus a final step handing the
--    parked leads to the freshly-joined teammate. Reproduced whole
--    (CREATE OR REPLACE) since plpgsql bodies aren't patchable.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  -- the joined account_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- NEW (049): hand any leads parked on this invite to the joiner.
  -- assigned_to := the caller themselves, so notify_lead_assigned's
  -- self-assignment guard skips the per-row notification. Clears the
  -- pending overlay so the lead reads as a normal assignment.
  UPDATE contacts
  SET assigned_to = v_caller_id,
      pending_invitation_id = NULL,
      pending_assignee_name = NULL
  WHERE account_id = v_inv.account_id
    AND pending_invitation_id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
