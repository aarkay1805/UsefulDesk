-- ============================================================
-- 052_lead_assignment_requests.sql — owner-approved assignment changes
--
-- Second approval flow, distinct from ownership transfer (050):
--
--   · Ownership (Received by / contacts.user_id) — an agent hands off;
--     the TARGET accepts. (050, kind='ownership')
--   · Assignment (Assigned to / contacts.assigned_to) — the OWNER
--     delegates who works the lead. A non-owner agent changing it needs
--     the lead's OWNER (the Received-by person) to approve — NOT the
--     target. (this migration, kind='assignment')
--
-- Rules (agreed): owner (contacts.user_id = caller) or admin/owner →
-- instant; any other agent → pending request to the owner. Approver =
-- the owner OR any admin. Applies to any change (reassign or unassign).
--
-- Reuses the lead_transfers table with a `kind` discriminator + an
-- `approver_user_id` (the owner at request time). A lead may have one
-- pending row PER KIND at a time.
--
-- Idempotent.
-- ============================================================

-- 1) Discriminator + approver, and allow a NULL target (unassign request).
ALTER TABLE lead_transfers
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'ownership'
    CHECK (kind IN ('ownership', 'assignment')),
  ADD COLUMN IF NOT EXISTS approver_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE lead_transfers ALTER COLUMN to_user_id DROP NOT NULL;

-- Assignment requests resolve to approved/rejected (ownership used
-- accepted/declined in 050) — widen the status check.
ALTER TABLE lead_transfers DROP CONSTRAINT IF EXISTS lead_transfers_status_check;
ALTER TABLE lead_transfers ADD CONSTRAINT lead_transfers_status_check
  CHECK (status IN ('pending','accepted','declined','approved','rejected',
                    'cancelled','superseded'));

-- One pending row per (contact, kind) — a lead can have a pending
-- ownership transfer AND a pending assignment request simultaneously.
DROP INDEX IF EXISTS uniq_lead_transfer_pending;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_transfer_pending_kind
  ON lead_transfers(contact_id, kind) WHERE status = 'pending';

-- 2) notifications — assignment lifecycle types.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned','lead_assigned','follow_up_reminder',
                  'lead_transfer_request','lead_transfer_accepted',
                  'lead_transfer_declined','lead_transfer_cancelled',
                  'lead_assignment_request','lead_assignment_approved',
                  'lead_assignment_rejected','lead_assignment_cancelled'));

-- 3) request_lead_transfer — repointed to also scope its supersede to
--    kind='ownership' (so an ownership request can't clobber a pending
--    assignment) and stamp kind explicitly. Otherwise unchanged from 050.
CREATE OR REPLACE FUNCTION public.request_lead_transfer(
  p_contact_id UUID,
  p_to_user    UUID,
  p_note       TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_account_id     UUID;
  v_owner          UUID;
  v_received_via   TEXT;
  v_is_admin       BOOLEAN;
  v_transfer_id    UUID;
  v_contact_name   TEXT;
  v_actor_name     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, user_id, received_via,
         COALESCE(NULLIF(TRIM(name), ''), phone, 'a lead')
    INTO v_account_id, v_owner, v_received_via, v_contact_name
  FROM contacts WHERE id = p_contact_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_received_via IS NOT NULL
     AND v_received_via NOT IN ('manual', 'import') THEN
    RAISE EXCEPTION 'System-generated leads cannot be transferred'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = p_to_user AND account_id = v_account_id
      AND account_role <> 'viewer'
  ) THEN
    RAISE EXCEPTION 'Transfer target must be a teammate on this account'
      USING ERRCODE = '22023';
  END IF;

  IF p_to_user = v_owner THEN
    RAISE EXCEPTION 'That teammate already owns this lead'
      USING ERRCODE = '22023';
  END IF;

  v_is_admin := is_account_member(v_account_id, 'admin');

  IF v_is_admin THEN
    UPDATE lead_transfers
      SET status = 'superseded', resolved_at = NOW(), resolved_by = v_uid
      WHERE contact_id = p_contact_id AND status = 'pending'
        AND kind = 'ownership';

    UPDATE contacts
      SET user_id = p_to_user, updated_at = NOW()
      WHERE id = p_contact_id;

    INSERT INTO lead_transfers (
      account_id, contact_id, kind, from_user_id, to_user_id, requested_by,
      status, note, resolved_at, resolved_by
    ) VALUES (
      v_account_id, p_contact_id, 'ownership', v_owner, p_to_user, v_uid,
      'accepted', p_note, NOW(), v_uid
    );

    IF p_to_user <> v_uid THEN
      SELECT full_name INTO v_actor_name FROM profiles WHERE user_id = v_uid;
      INSERT INTO notifications (account_id, user_id, type, contact_id,
                                 actor_user_id, title, body)
      VALUES (v_account_id, p_to_user, 'lead_assigned', p_contact_id, v_uid,
              'Lead assigned to you',
              v_contact_name || CASE
                WHEN v_actor_name IS NOT NULL AND v_actor_name <> ''
                THEN ' — assigned by ' || v_actor_name ELSE '' END);
    END IF;

    RETURN 'accepted';
  END IF;

  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the current owner or an admin can transfer this lead'
      USING ERRCODE = '42501';
  END IF;

  UPDATE lead_transfers
    SET status = 'superseded', resolved_at = NOW(), resolved_by = v_uid
    WHERE contact_id = p_contact_id AND status = 'pending'
      AND kind = 'ownership';

  INSERT INTO lead_transfers (
    account_id, contact_id, kind, from_user_id, to_user_id, requested_by, note
  ) VALUES (
    v_account_id, p_contact_id, 'ownership', v_owner, p_to_user, v_uid, p_note
  ) RETURNING id INTO v_transfer_id;

  SELECT full_name INTO v_actor_name FROM profiles WHERE user_id = v_uid;

  INSERT INTO notifications (
    account_id, user_id, type, contact_id, actor_user_id,
    reference_id, title, body
  ) VALUES (
    v_account_id, p_to_user, 'lead_transfer_request', p_contact_id, v_uid,
    v_transfer_id, 'Lead transfer request',
    COALESCE(NULLIF(v_actor_name, ''), 'A teammate')
      || ' wants to transfer ' || v_contact_name || ' to you'
  );

  RETURN 'pending';
END;
$$;

ALTER FUNCTION public.request_lead_transfer(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_lead_transfer(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_lead_transfer(UUID, UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 4) request_lead_assignment — change contacts.assigned_to.
--    Owner (contacts.user_id = caller) or admin → instant. Any other
--    agent → pending request to the owner. p_to_assignee NULL = unassign.
--    Returns 'approved' (instant) or 'pending'.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_lead_assignment(
  p_contact_id  UUID,
  p_to_assignee UUID,
  p_note        TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_account_id   UUID;
  v_owner        UUID;
  v_current      UUID;
  v_is_admin     BOOLEAN;
  v_request_id   UUID;
  v_contact_name TEXT;
  v_actor_name   TEXT;
  v_target_name  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, user_id, assigned_to,
         COALESCE(NULLIF(TRIM(name), ''), phone, 'a lead')
    INTO v_account_id, v_owner, v_current, v_contact_name
  FROM contacts WHERE id = p_contact_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Target (when set) must be a real, non-viewer member. NULL = unassign.
  IF p_to_assignee IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = p_to_assignee AND account_id = v_account_id
      AND account_role <> 'viewer'
  ) THEN
    RAISE EXCEPTION 'Assignee must be a teammate on this account'
      USING ERRCODE = '22023';
  END IF;

  IF p_to_assignee IS NOT DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'Already assigned that way' USING ERRCODE = '22023';
  END IF;

  v_is_admin := is_account_member(v_account_id, 'admin');

  -- ---- Instant path: owner or admin -------------------------------------
  IF v_is_admin OR v_owner IS NOT DISTINCT FROM v_uid THEN
    UPDATE lead_transfers
      SET status = 'superseded', resolved_at = NOW(), resolved_by = v_uid
      WHERE contact_id = p_contact_id AND status = 'pending'
        AND kind = 'assignment';

    -- assigned_to change fires notify_lead_assigned (new assignee notified,
    -- self-assignment guarded). Clear any pending-invite overlay (049).
    UPDATE contacts
      SET assigned_to = p_to_assignee,
          pending_invitation_id = NULL,
          pending_assignee_name = NULL,
          updated_at = NOW()
      WHERE id = p_contact_id;

    INSERT INTO lead_transfers (
      account_id, contact_id, kind, from_user_id, to_user_id, requested_by,
      approver_user_id, status, note, resolved_at, resolved_by
    ) VALUES (
      v_account_id, p_contact_id, 'assignment', v_current, p_to_assignee,
      v_uid, v_owner, 'approved', p_note, NOW(), v_uid
    );

    RETURN 'approved';
  END IF;

  -- ---- Pending path: a non-owner agent asks the owner -------------------
  UPDATE lead_transfers
    SET status = 'superseded', resolved_at = NOW(), resolved_by = v_uid
    WHERE contact_id = p_contact_id AND status = 'pending'
      AND kind = 'assignment';

  INSERT INTO lead_transfers (
    account_id, contact_id, kind, from_user_id, to_user_id, requested_by,
    approver_user_id, note
  ) VALUES (
    v_account_id, p_contact_id, 'assignment', v_current, p_to_assignee, v_uid,
    v_owner, p_note
  ) RETURNING id INTO v_request_id;

  SELECT full_name INTO v_actor_name FROM profiles WHERE user_id = v_uid;
  IF p_to_assignee IS NOT NULL THEN
    SELECT full_name INTO v_target_name FROM profiles WHERE user_id = p_to_assignee;
  END IF;

  -- Notify the owner (approver). If the lead has no human owner, nothing to
  -- notify — but such leads are system-generated and non-owner agents
  -- shouldn't reach here; guard anyway.
  IF v_owner IS NOT NULL AND v_owner <> v_uid THEN
    INSERT INTO notifications (account_id, user_id, type, contact_id,
                               actor_user_id, reference_id, title, body)
    VALUES (v_account_id, v_owner, 'lead_assignment_request', p_contact_id,
            v_uid, v_request_id, 'Assignment approval needed',
            COALESCE(NULLIF(v_actor_name, ''), 'A teammate')
              || ' wants to assign ' || v_contact_name || ' to '
              || COALESCE(NULLIF(v_target_name, ''), 'no one'));
  END IF;

  RETURN 'pending';
END;
$$;

ALTER FUNCTION public.request_lead_assignment(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_lead_assignment(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_lead_assignment(UUID, UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5) respond_lead_assignment — the owner (or an admin) approves/rejects.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_lead_assignment(
  p_request_id UUID,
  p_approve    BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_t            lead_transfers%ROWTYPE;
  v_is_admin     BOOLEAN;
  v_contact_name TEXT;
  v_actor_name   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_t FROM lead_transfers WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_t.kind <> 'assignment' THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = '22023';
  END IF;
  IF v_t.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been resolved'
      USING ERRCODE = '22023';
  END IF;

  -- Approver = the lead's owner (approver_user_id) OR any admin.
  v_is_admin := is_account_member(v_t.account_id, 'admin');
  IF v_uid IS DISTINCT FROM v_t.approver_user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only the lead owner or an admin can approve this'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(TRIM(name), ''), phone, 'a lead')
    INTO v_contact_name FROM contacts WHERE id = v_t.contact_id;
  SELECT full_name INTO v_actor_name FROM profiles WHERE user_id = v_uid;

  IF p_approve THEN
    -- Applies the assignment; assigned_to change fires notify_lead_assigned.
    UPDATE contacts
      SET assigned_to = v_t.to_user_id,
          pending_invitation_id = NULL,
          pending_assignee_name = NULL,
          updated_at = NOW()
      WHERE id = v_t.contact_id;

    UPDATE lead_transfers
      SET status = 'approved', resolved_at = NOW(), resolved_by = v_uid
      WHERE id = v_t.id;

    IF v_t.requested_by IS NOT NULL AND v_t.requested_by <> v_uid THEN
      INSERT INTO notifications (account_id, user_id, type, contact_id,
                                 actor_user_id, reference_id, title, body)
      VALUES (v_t.account_id, v_t.requested_by, 'lead_assignment_approved',
              v_t.contact_id, v_uid, v_t.id, 'Assignment approved',
              COALESCE(NULLIF(v_actor_name, ''), 'The owner')
                || ' approved your assignment of ' || v_contact_name);
    END IF;

    RETURN 'approved';
  ELSE
    UPDATE lead_transfers
      SET status = 'rejected', resolved_at = NOW(), resolved_by = v_uid
      WHERE id = v_t.id;

    IF v_t.requested_by IS NOT NULL AND v_t.requested_by <> v_uid THEN
      INSERT INTO notifications (account_id, user_id, type, contact_id,
                                 actor_user_id, reference_id, title, body)
      VALUES (v_t.account_id, v_t.requested_by, 'lead_assignment_rejected',
              v_t.contact_id, v_uid, v_t.id, 'Assignment rejected',
              COALESCE(NULLIF(v_actor_name, ''), 'The owner')
                || ' rejected your assignment of ' || v_contact_name);
    END IF;

    RETURN 'rejected';
  END IF;
END;
$$;

ALTER FUNCTION public.respond_lead_assignment(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.respond_lead_assignment(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_lead_assignment(UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 6) cancel_lead_assignment — the requester (or an admin) withdraws.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_lead_assignment(
  p_request_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_t   lead_transfers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_t FROM lead_transfers WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_t.kind <> 'assignment' THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = '22023';
  END IF;
  IF v_t.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been resolved'
      USING ERRCODE = '22023';
  END IF;

  IF v_uid IS DISTINCT FROM v_t.requested_by
     AND NOT is_account_member(v_t.account_id, 'admin') THEN
    RAISE EXCEPTION 'Only the requester or an admin can cancel'
      USING ERRCODE = '42501';
  END IF;

  UPDATE lead_transfers
    SET status = 'cancelled', resolved_at = NOW(), resolved_by = v_uid
    WHERE id = v_t.id;

  RETURN 'cancelled';
END;
$$;

ALTER FUNCTION public.cancel_lead_assignment(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_lead_assignment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_lead_assignment(UUID) TO authenticated;
