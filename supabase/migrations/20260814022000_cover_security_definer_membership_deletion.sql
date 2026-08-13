-- Preserve the caller's authenticated JWT identity as well as current_user
-- when deciding whether a membership lifecycle write came from staff. This
-- keeps invoker RPCs protected today and prevents a future definer wrapper from
-- bypassing the boundary by changing current_user to its function owner.

CREATE OR REPLACE FUNCTION private.enforce_membership_provider_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_has_blocking_mandate BOOLEAN;
  v_is_staff_request BOOLEAN := current_user IN ('anon', 'authenticated')
    OR (SELECT auth.uid()) IS NOT NULL;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.payment_mandates
    WHERE membership_id = v_membership_id
      AND status IN ('creating', 'pending', 'active', 'paused', 'orphaned')
  ) INTO v_has_blocking_mandate;

  IF v_is_staff_request
     AND v_has_blocking_mandate
     AND (
       TG_OP = 'DELETE'
       OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
       OR NEW.pricing_option_id IS DISTINCT FROM OLD.pricing_option_id
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.fee_amount IS DISTINCT FROM OLD.fee_amount
       OR NEW.is_trial IS DISTINCT FROM OLD.is_trial
       OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
       OR NEW.collection_mode IS DISTINCT FROM OLD.collection_mode
     ) THEN
    RAISE EXCEPTION
      'Resolve the member''s AutoPay mandate before changing or deleting the membership'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.collection_mode = 'auto'
       AND (NEW.status <> 'active' OR NEW.is_trial) THEN
      RAISE EXCEPTION
        'Automatic collection requires an active non-trial membership'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status <> 'active'
       AND NEW.status = 'active'
       AND v_has_blocking_mandate THEN
      RAISE EXCEPTION
        'A blocking AutoPay mandate cannot reactivate the membership'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

ALTER FUNCTION private.enforce_membership_provider_lifecycle() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_membership_provider_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;
