-- A Razorpay subscription keeps charging independently of local membership
-- rows. Until UsefulDesk has a provider pause/cancel/rebind operation, a
-- browser lifecycle write must not move the local plan, cycle, or status while
-- a setup/live subscription can still emit callbacks.

CREATE OR REPLACE FUNCTION private.enforce_membership_provider_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_has_blocking_mandate BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.payment_mandates
    WHERE membership_id = v_membership_id
      AND status IN ('creating', 'pending', 'active', 'paused', 'orphaned')
  ) INTO v_has_blocking_mandate;

  IF current_user IN ('anon', 'authenticated')
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
    -- A delayed subscription.authenticated callback must not switch a frozen,
    -- cancelled, or trial membership back to automatic collection.
    IF NEW.collection_mode = 'auto'
       AND (NEW.status <> 'active' OR NEW.is_trial) THEN
      RAISE EXCEPTION
        'Automatic collection requires an active non-trial membership'
        USING ERRCODE = '55000';
    END IF;

    -- A confirmed later charge must never manufacture a new cycle by turning
    -- a locally frozen/cancelled membership active again.
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

DROP TRIGGER IF EXISTS trg_memberships_provider_lifecycle_update
  ON public.memberships;
CREATE TRIGGER trg_memberships_provider_lifecycle_update
  BEFORE UPDATE OF plan_id, pricing_option_id, start_date, end_date,
    status, fee_amount, is_trial, frozen_at, collection_mode
  ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_membership_provider_lifecycle();

DROP TRIGGER IF EXISTS trg_memberships_provider_lifecycle_delete
  ON public.memberships;
CREATE TRIGGER trg_memberships_provider_lifecycle_delete
  BEFORE DELETE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_membership_provider_lifecycle();

-- The charge RPC already catches ledger-insertion failures and preserves the
-- provider-confirmed debit in gateway_charge_exceptions. Rejecting the insert
-- here therefore converts a charge against a frozen/cancelled/trial member
-- into an operator-visible exception instead of settling or reactivating it.
CREATE OR REPLACE FUNCTION private.enforce_auto_payment_membership_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
BEGIN
  IF NEW.source <> 'auto' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_membership
  FROM public.memberships
  WHERE id = NEW.membership_id;

  IF NOT FOUND
     OR v_membership.status <> 'active'
     OR v_membership.is_trial THEN
    RAISE EXCEPTION
      'Automatic payments require an active non-trial membership'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.enforce_auto_payment_membership_state() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_auto_payment_membership_state()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_payments_enforce_auto_membership_state
  ON public.payments;
CREATE TRIGGER trg_payments_enforce_auto_membership_state
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_auto_payment_membership_state();
