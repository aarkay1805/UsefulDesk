-- Keep each activation boundary system-managed even when another reminder
-- schedule is toggled in the same settings update.

CREATE OR REPLACE FUNCTION public.set_invoice_collection_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_timezone TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.invoice_collection_enabled = OLD.invoice_collection_enabled
      AND (NEW.invoice_collection_activated_on IS DISTINCT FROM OLD.invoice_collection_activated_on
        OR NEW.invoice_collection_activated_at IS DISTINCT FROM OLD.invoice_collection_activated_at
        OR NEW.invoice_collection_generation IS DISTINCT FROM OLD.invoice_collection_generation) THEN
      RAISE EXCEPTION 'Invoice collection activation fields are system managed';
    END IF;
    IF NEW.membership_post_expiry_enabled = OLD.membership_post_expiry_enabled
      AND (NEW.membership_post_expiry_activated_on IS DISTINCT FROM OLD.membership_post_expiry_activated_on
        OR NEW.membership_post_expiry_activated_at IS DISTINCT FROM OLD.membership_post_expiry_activated_at
        OR NEW.membership_post_expiry_generation IS DISTINCT FROM OLD.membership_post_expiry_generation) THEN
      RAISE EXCEPTION 'Membership post-expiry activation fields are system managed';
    END IF;
    IF NEW.service_post_expiry_enabled = OLD.service_post_expiry_enabled
      AND (NEW.service_post_expiry_activated_on IS DISTINCT FROM OLD.service_post_expiry_activated_on
        OR NEW.service_post_expiry_activated_at IS DISTINCT FROM OLD.service_post_expiry_activated_at
        OR NEW.service_post_expiry_generation IS DISTINCT FROM OLD.service_post_expiry_generation) THEN
      RAISE EXCEPTION 'Service post-expiry activation fields are system managed';
    END IF;
  END IF;

  SELECT timezone INTO v_timezone FROM public.accounts WHERE id = NEW.account_id;
  IF NEW.invoice_collection_enabled AND NOT COALESCE(OLD.invoice_collection_enabled, FALSE) THEN
    NEW.invoice_collection_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.invoice_collection_activated_at := NOW();
    NEW.invoice_collection_generation := gen_random_uuid();
  END IF;
  IF NEW.membership_post_expiry_enabled AND NOT COALESCE(OLD.membership_post_expiry_enabled, FALSE) THEN
    NEW.membership_post_expiry_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.membership_post_expiry_activated_at := NOW();
    NEW.membership_post_expiry_generation := gen_random_uuid();
  END IF;
  IF NEW.service_post_expiry_enabled AND NOT COALESCE(OLD.service_post_expiry_enabled, FALSE) THEN
    NEW.service_post_expiry_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.service_post_expiry_activated_at := NOW();
    NEW.service_post_expiry_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END; $$;
