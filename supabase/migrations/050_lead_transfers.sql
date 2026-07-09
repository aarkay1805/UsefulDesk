-- ============================================================
-- 050_lead_transfers.sql — role-gated lead ownership transfer
--
-- Two conventional patterns, split by role (see
-- PRDs/lead_ownership_transfer.md):
--
--   * Managerial reassign (instant) — owner/admin routes any lead to
--     anyone; no acceptance needed.
--   * Peer handoff (request → accept) — an agent transferring a lead
--     they OWN creates a pending request the target must accept before
--     ownership moves.
--
-- "Ownership" here = `contacts.user_id`, surfaced as the **Received by**
-- column: the human teammate who owns the lead. `received_via` stays the
-- immutable origin CHANNEL (manual/import/whatsapp/meta/…); only
-- human-received leads (received_via NULL/manual/import) can be
-- transferred — system-generated captures are locked.
--
-- Invariant: a lead is NEVER ownerless. `contacts.user_id` flips only on
-- acceptance; pending/declined/cancelled leave the current owner
-- untouched. (The separate `assigned_to` "assignment" field is not
-- touched by transfers.)
--
-- All mutations run through SECURITY DEFINER RPCs (role rules + state
-- machine live server-side); the table is SELECT-only from clients,
-- same posture as `notifications` (027) and `redeem_invitation` (049).
--
-- Builds on: 017 (is_account_member), 027 (notifications + realtime),
-- 047 (assigned_to → auth.users, notify_lead_assigned self-guard),
-- 049 (pending_invitation overlay).
--
-- Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1) lead_transfers — request state machine + audit trail
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_transfers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Current owner at request time. SET NULL keeps the audit row if that
  -- teammate is later removed (their leads already fall to NULL via 047).
  from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Proposed new owner. CASCADE: if the target is removed while a request
  -- is still pending, the dangling request disappears cleanly.
  to_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','declined',
                                   'cancelled','superseded')),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- At most ONE pending transfer per lead — a re-request supersedes the old.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_transfer_pending
  ON lead_transfers(contact_id) WHERE status = 'pending';

-- "Requests waiting on me" (receiver inbox) + the leads-list badge scan.
CREATE INDEX IF NOT EXISTS idx_lead_transfers_incoming
  ON lead_transfers(to_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lead_transfers_account_pending
  ON lead_transfers(account_id) WHERE status = 'pending';

ALTER TABLE lead_transfers ENABLE ROW LEVEL SECURITY;

-- Account-scoped read, matching contacts_select — enough for the leads
-- badge, the receiver inbox, and any audit view. All writes go through
-- the definer RPCs below, so there is no client write policy.
DROP POLICY IF EXISTS lead_transfers_select ON lead_transfers;
CREATE POLICY lead_transfers_select ON lead_transfers FOR SELECT
  USING (is_account_member(account_id));

REVOKE INSERT, UPDATE, DELETE ON lead_transfers FROM authenticated;

-- ------------------------------------------------------------
-- 2) notifications — new transfer types + a generic subject pointer
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned','lead_assigned','follow_up_reminder',
                  'lead_transfer_request','lead_transfer_accepted',
                  'lead_transfer_declined','lead_transfer_cancelled'));

-- Generic deep-link target (here: the transfer id, so the notification's
-- inline Accept/Decline buttons know which request to resolve). Nullable,
-- no FK — keeps notifications decoupled from every subject table.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id UUID;

-- Full replica identity is already set on notifications (027) for realtime.

-- ------------------------------------------------------------
-- 3) request_lead_transfer — the single entry point
--    Returns 'accepted' (instant, managerial/self-claim) or 'pending'.
-- ------------------------------------------------------------
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

  -- Ownership = contacts.user_id (the "Received by" teammate).
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

  -- Only human-received leads are transferable. System-generated captures
  -- (whatsapp/meta/api/automation) have no human owner to hand off.
  IF v_received_via IS NOT NULL
     AND v_received_via NOT IN ('manual', 'import') THEN
    RAISE EXCEPTION 'System-generated leads cannot be transferred'
      USING ERRCODE = '22023';
  END IF;

  -- Target must be a real, non-viewer member of this account.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = p_to_user AND account_id = v_account_id
      AND account_role <> 'viewer'
  ) THEN
    RAISE EXCEPTION 'Transfer target must be a teammate on this account'
      USING ERRCODE = '22023';
  END IF;

  -- No-op / self-transfer.
  IF p_to_user = v_owner THEN
    RAISE EXCEPTION 'That teammate already owns this lead'
      USING ERRCODE = '22023';
  END IF;

  v_is_admin := is_account_member(v_account_id, 'admin');

  -- ---- Instant path (managerial) ----------------------------------------
  -- Admin/owner move ownership immediately; the new owner is notified
  -- (they didn't act). Any in-flight request for this lead is superseded.
  IF v_is_admin THEN
    UPDATE lead_transfers
      SET status = 'superseded', resolved_at = NOW(), resolved_by = v_uid
      WHERE contact_id = p_contact_id AND status = 'pending';

    UPDATE contacts
      SET user_id = p_to_user, updated_at = NOW()
      WHERE id = p_contact_id;

    INSERT INTO lead_transfers (
      account_id, contact_id, from_user_id, to_user_id, requested_by,
      status, note, resolved_at, resolved_by
    ) VALUES (
      v_account_id, p_contact_id, v_owner, p_to_user, v_uid,
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

  -- ---- Pending path (agent peer handoff) --------------------------------
  -- Only the current owner may hand off their own lead.
  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the current owner or an admin can transfer this lead'
      USING ERRCODE = '42501';
  END IF;

  UPDATE lead_transfers
    SET status = 'superseded', resolved_at = NOW(), resolved_by = v_uid
    WHERE contact_id = p_contact_id AND status = 'pending';

  INSERT INTO lead_transfers (
    account_id, contact_id, from_user_id, to_user_id, requested_by, note
  ) VALUES (
    v_account_id, p_contact_id, v_owner, p_to_user, v_uid, p_note
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
-- 4) respond_lead_transfer — accept / decline a pending request
--    Caller must be the target, or an admin (force-resolve).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_lead_transfer(
  p_transfer_id UUID,
  p_accept      BOOLEAN
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

  SELECT * INTO v_t FROM lead_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found' USING ERRCODE = '22023';
  END IF;
  IF v_t.status <> 'pending' THEN
    RAISE EXCEPTION 'This transfer has already been resolved'
      USING ERRCODE = '22023';
  END IF;

  v_is_admin := is_account_member(v_t.account_id, 'admin');
  IF v_uid <> v_t.to_user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only the invited teammate or an admin can respond'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(TRIM(name), ''), phone, 'a lead')
    INTO v_contact_name FROM contacts WHERE id = v_t.contact_id;
  SELECT full_name INTO v_actor_name FROM profiles WHERE user_id = v_uid;

  IF p_accept THEN
    -- Ownership (contacts.user_id) moves now.
    UPDATE contacts
      SET user_id = v_t.to_user_id, updated_at = NOW()
      WHERE id = v_t.contact_id;

    UPDATE lead_transfers
      SET status = 'accepted', resolved_at = NOW(), resolved_by = v_uid
      WHERE id = v_t.id;

    -- Tell the requester (and the prior owner, if different) it landed.
    INSERT INTO notifications (account_id, user_id, type, contact_id,
                               actor_user_id, reference_id, title, body)
    SELECT v_t.account_id, uid, 'lead_transfer_accepted', v_t.contact_id,
           v_uid, v_t.id, 'Lead transfer accepted',
           COALESCE(NULLIF(v_actor_name, ''), 'A teammate')
             || ' accepted ' || v_contact_name
    FROM (SELECT DISTINCT uid FROM unnest(
            ARRAY[v_t.requested_by, v_t.from_user_id]
          ) AS uid WHERE uid IS NOT NULL AND uid <> v_uid) recipients;

    -- An admin force-accepting for someone else → tell the new owner too
    -- (there's no assigned_to trigger firing on a user_id change).
    IF v_uid <> v_t.to_user_id THEN
      INSERT INTO notifications (account_id, user_id, type, contact_id,
                                 actor_user_id, title, body)
      VALUES (v_t.account_id, v_t.to_user_id, 'lead_assigned', v_t.contact_id,
              v_uid, 'Lead assigned to you', v_contact_name);
    END IF;

    RETURN 'accepted';
  ELSE
    UPDATE lead_transfers
      SET status = 'declined', resolved_at = NOW(), resolved_by = v_uid
      WHERE id = v_t.id;

    IF v_t.requested_by IS NOT NULL AND v_t.requested_by <> v_uid THEN
      INSERT INTO notifications (account_id, user_id, type, contact_id,
                                 actor_user_id, reference_id, title, body)
      VALUES (v_t.account_id, v_t.requested_by, 'lead_transfer_declined',
              v_t.contact_id, v_uid, v_t.id, 'Lead transfer declined',
              COALESCE(NULLIF(v_actor_name, ''), 'A teammate')
                || ' declined ' || v_contact_name);
    END IF;

    RETURN 'declined';
  END IF;
END;
$$;

ALTER FUNCTION public.respond_lead_transfer(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.respond_lead_transfer(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_lead_transfer(UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 5) cancel_lead_transfer — requester or admin withdraws a request
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_lead_transfer(
  p_transfer_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_t          lead_transfers%ROWTYPE;
  v_actor_name TEXT;
  v_contact_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_t FROM lead_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found' USING ERRCODE = '22023';
  END IF;
  IF v_t.status <> 'pending' THEN
    RAISE EXCEPTION 'This transfer has already been resolved'
      USING ERRCODE = '22023';
  END IF;

  IF v_uid <> v_t.requested_by AND NOT is_account_member(v_t.account_id, 'admin') THEN
    RAISE EXCEPTION 'Only the requester or an admin can cancel'
      USING ERRCODE = '42501';
  END IF;

  UPDATE lead_transfers
    SET status = 'cancelled', resolved_at = NOW(), resolved_by = v_uid
    WHERE id = v_t.id;

  -- Let the target know the request was withdrawn (if someone else did it).
  IF v_t.to_user_id <> v_uid THEN
    SELECT full_name INTO v_actor_name FROM profiles WHERE user_id = v_uid;
    SELECT COALESCE(NULLIF(TRIM(name), ''), phone, 'a lead')
      INTO v_contact_name FROM contacts WHERE id = v_t.contact_id;
    INSERT INTO notifications (account_id, user_id, type, contact_id,
                               actor_user_id, reference_id, title, body)
    VALUES (v_t.account_id, v_t.to_user_id, 'lead_transfer_cancelled',
            v_t.contact_id, v_uid, v_t.id, 'Lead transfer withdrawn',
            COALESCE(NULLIF(v_actor_name, ''), 'A teammate')
              || ' withdrew the transfer of ' || v_contact_name);
  END IF;

  RETURN 'cancelled';
END;
$$;

ALTER FUNCTION public.cancel_lead_transfer(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_lead_transfer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_lead_transfer(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 6) realtime — incoming-request badge + list overlay update live
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'lead_transfers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE lead_transfers;
  END IF;
END $$;
