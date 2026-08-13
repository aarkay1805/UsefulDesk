-- Account-scoped staff references must never point at a global Auth user who
-- is not an active, operational teammate in the same branch. The assignment
-- columns are exposed through PostgREST and are also written with service-role
-- clients, so this invariant belongs at the database boundary rather than at
-- individual UI/RPC call sites.

-- Repair any pre-existing invalid references before enabling enforcement.
UPDATE public.contacts AS contact
SET assigned_to = NULL,
    updated_at = now()
WHERE contact.assigned_to IS NOT NULL
  AND NOT private.user_has_account_membership(
    contact.account_id,
    contact.assigned_to,
    'viewer'
  );

UPDATE public.conversations AS conversation
SET assigned_agent_id = NULL,
    updated_at = now()
WHERE conversation.assigned_agent_id IS NOT NULL
  AND NOT private.user_has_account_membership(
    conversation.account_id,
    conversation.assigned_agent_id,
    'viewer'
  );

UPDATE public.follow_ups AS follow_up
SET assigned_to = NULL,
    updated_at = now()
WHERE follow_up.assigned_to IS NOT NULL
  AND NOT private.user_has_account_membership(
    follow_up.account_id,
    follow_up.assigned_to,
    'viewer'
  );

-- Notifications are operational inbox rows, not an immutable audit ledger.
-- Remove rows that would disclose a branch's data to a non-member.
DELETE FROM public.notifications AS notification
WHERE NOT private.user_has_account_membership(
  notification.account_id,
  notification.user_id,
  'viewer'
);

CREATE OR REPLACE FUNCTION private.enforce_account_user_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id UUID;
  v_min_role public.account_role_enum;
BEGIN
  IF TG_NARGS <> 2 THEN
    RAISE EXCEPTION 'account user reference trigger requires column and role arguments';
  END IF;

  v_user_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::UUID;
  v_min_role := TG_ARGV[1]::public.account_role_enum;

  IF v_user_id IS NOT NULL
     AND NOT private.user_has_account_membership(
       NEW.account_id,
       v_user_id,
       v_min_role
     ) THEN
    RAISE EXCEPTION '% must be an active % on this account',
      TG_ARGV[0], v_min_role
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.enforce_account_user_reference() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_account_user_reference()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_contacts_assignee_membership ON public.contacts;
CREATE TRIGGER trg_contacts_assignee_membership
  BEFORE INSERT OR UPDATE OF assigned_to ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_account_user_reference('assigned_to', 'viewer');

DROP TRIGGER IF EXISTS trg_conversations_assignee_membership ON public.conversations;
CREATE TRIGGER trg_conversations_assignee_membership
  BEFORE INSERT OR UPDATE OF assigned_agent_id ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_account_user_reference('assigned_agent_id', 'viewer');

DROP TRIGGER IF EXISTS trg_follow_ups_assignee_membership ON public.follow_ups;
CREATE TRIGGER trg_follow_ups_assignee_membership
  BEFORE INSERT OR UPDATE OF assigned_to ON public.follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_account_user_reference('assigned_to', 'viewer');

-- Notification producers include SECURITY DEFINER triggers and service-role
-- crons. Enforce recipient membership for all of them in one place.
DROP TRIGGER IF EXISTS trg_notifications_recipient_membership ON public.notifications;
CREATE TRIGGER trg_notifications_recipient_membership
  BEFORE INSERT OR UPDATE OF account_id, user_id ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_account_user_reference('user_id', 'viewer');

-- A notification recipient must also retain membership in the referenced
-- branch. This immediately revokes reads after staff removal even if
-- an unexpected producer bypasses the write trigger.
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND public.has_account_membership(account_id)
  );

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND public.has_account_membership(account_id)
  )
  WITH CHECK (
    auth.uid() = user_id
    AND public.has_account_membership(account_id)
  );

-- Staff removal is the ordinary path that previously manufactured stale
-- assignments. Clear operational ownership and old notifications inside the
-- same transaction before deleting the membership.
CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_account UUID := private.requested_account_id();
  v_target_role public.account_role_enum;
  v_fallback RECORD;
BEGIN
  IF auth.uid() IS NULL OR v_account IS NULL
     OR NOT public.is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'This action requires branch admin access'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM public.account_memberships
  WHERE account_id = v_account AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this branch'
      USING ERRCODE = '42501';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Transfer branch ownership before removal'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.contacts
  SET assigned_to = NULL,
      updated_at = now()
  WHERE account_id = v_account
    AND assigned_to = p_user_id;

  UPDATE public.conversations
  SET assigned_agent_id = NULL,
      updated_at = now()
  WHERE account_id = v_account
    AND assigned_agent_id = p_user_id;

  UPDATE public.follow_ups
  SET assigned_to = NULL,
      updated_at = now()
  WHERE account_id = v_account
    AND assigned_to = p_user_id;

  DELETE FROM public.notifications
  WHERE account_id = v_account
    AND user_id = p_user_id;

  DELETE FROM public.account_memberships
  WHERE account_id = v_account AND user_id = p_user_id;

  -- Keep the legacy profile pointer valid without manufacturing or deleting
  -- memberships. Invitation redemption preserves the user's personal branch,
  -- so a fallback normally exists.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_user_id AND account_id = v_account
  ) THEN
    SELECT am.account_id, am.role INTO v_fallback
    FROM public.account_memberships am
    WHERE am.user_id = p_user_id
    ORDER BY am.created_at, am.account_id
    LIMIT 1;
    IF v_fallback.account_id IS NULL THEN
      RAISE EXCEPTION 'Removal would leave the user without a branch'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.profiles
    SET account_id = v_fallback.account_id,
        account_role = v_fallback.role
    WHERE user_id = p_user_id;
  END IF;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  SELECT a.organization_id, a.id, auth.uid(), 'branch.member_removed',
         jsonb_build_object('user_id', p_user_id, 'role', v_target_role)
  FROM public.accounts a WHERE a.id = v_account;
  RETURN v_account;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;
