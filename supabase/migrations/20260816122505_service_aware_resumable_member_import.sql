-- Service-aware, resumable member import.
-- Phase 1 establishes one contact-backed customer row without inventing a
-- membership for customers who only bought duration-based services.

CREATE OR REPLACE VIEW public.member_customer_directory
WITH (security_invoker = true) AS
SELECT
  contact.account_id,
  contact.id AS contact_id,
  CASE
    WHEN membership.id IS NULL THEN 'service'::TEXT
    ELSE 'membership'::TEXT
  END AS customer_kind,
  membership.id AS membership_id,
  membership.member_number,
  membership.user_id AS membership_user_id,
  membership.plan_id,
  membership.pricing_option_id,
  membership.start_date AS membership_start_date,
  membership.end_date AS membership_end_date,
  membership.status AS membership_status,
  membership.fee_amount AS membership_fee_amount,
  membership.fee_status AS membership_fee_status,
  COALESCE(membership.is_trial, false) AS membership_is_trial,
  membership.frozen_at AS membership_frozen_at,
  membership.collection_mode AS membership_collection_mode,
  membership.created_at AS membership_created_at,
  membership.updated_at AS membership_updated_at,
  services.service_expiry,
  CASE
    WHEN membership.id IS NULL THEN services.service_expiry
    ELSE membership.end_date
  END AS display_expiry,
  services.service_count,
  COALESCE(billing.generic_balance, 0)::NUMERIC(12, 2) AS generic_balance,
  follow_ups.open_follow_up_count,
  contact.name AS contact_name,
  contact.phone AS contact_phone,
  contact.email AS contact_email,
  contact.avatar_url AS contact_avatar_url,
  contact.assigned_to AS contact_assigned_to,
  contact.churn_risk AS contact_churn_risk,
  to_jsonb(contact) AS contact,
  CASE WHEN plan.id IS NULL THEN NULL ELSE to_jsonb(plan) END AS plan
FROM public.contacts contact
JOIN public.accounts account ON account.id = contact.account_id
LEFT JOIN LATERAL (
  SELECT candidate.*
  FROM public.memberships candidate
  WHERE candidate.account_id = contact.account_id
    AND candidate.contact_id = contact.id
  ORDER BY candidate.updated_at DESC, candidate.id DESC
  LIMIT 1
) membership ON true
LEFT JOIN public.membership_plans plan ON plan.id = membership.plan_id
JOIN LATERAL (
  SELECT
    COALESCE(
      MIN(service.end_date) FILTER (
        WHERE service.status = 'active'
          AND service.end_date >= (NOW() AT TIME ZONE account.timezone)::DATE
      ),
      MAX(service.end_date)
    ) AS service_expiry,
    COUNT(service.id)::INTEGER AS service_count
  FROM public.member_services service
  WHERE service.account_id = contact.account_id
    AND service.contact_id = contact.id
) services ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(invoice.collectible_balance), 0)::NUMERIC(12, 2)
    AS generic_balance
  FROM public.invoice_balances invoice
  WHERE invoice.account_id = contact.account_id
    AND invoice.contact_id = contact.id
    AND invoice.state = 'open'
) billing ON true
LEFT JOIN LATERAL (
  SELECT COUNT(follow_up.id)::INTEGER AS open_follow_up_count
  FROM public.follow_ups follow_up
  WHERE follow_up.account_id = contact.account_id
    AND follow_up.contact_id = contact.id
    AND follow_up.status = 'open'
) follow_ups ON true
WHERE membership.id IS NOT NULL OR services.service_count > 0;

GRANT SELECT ON public.member_customer_directory TO authenticated, service_role;
REVOKE ALL ON public.member_customer_directory FROM anon;

-- Contact-backed checkout for standalone sales and service renewals. A real
-- membership remains optional and is validated when present; no synthetic
-- membership is created for a service-only customer.
CREATE OR REPLACE FUNCTION public.perform_contact_checkout(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mode TEXT := p_payload->>'mode';
  v_account_id UUID := (p_payload->>'account_id')::UUID;
  v_contact_id UUID := (p_payload->>'contact_id')::UUID;
  v_membership_id UUID := NULLIF(p_payload->>'membership_id', '')::UUID;
  v_key UUID := (p_payload->>'idempotency_key')::UUID;
  v_collection JSONB := COALESCE(p_payload->'collection', '{}'::JSONB);
  v_existing public.invoice_balances%ROWTYPE;
  v_result public.invoice_balances%ROWTYPE;
  v_invoice_id UUID;
  v_payment_id UUID;
  v_collect NUMERIC(12, 2) := COALESCE((v_collection->>'amount')::NUMERIC, 0);
  v_name TEXT;
  v_member_number BIGINT;
  v_currency TEXT;
BEGIN
  IF v_mode NOT IN ('sale', 'service_renewal') THEN
    RAISE EXCEPTION 'Unsupported contact checkout mode';
  END IF;
  IF NOT public.is_account_member(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Agent access is required';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;

  SELECT balance.* INTO v_existing
  FROM public.invoice_balances balance
  JOIN public.invoices invoice ON invoice.id = balance.id
  WHERE invoice.account_id = v_account_id
    AND invoice.idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'membership_id', v_existing.membership_id,
      'member_number', v_existing.member_number_snapshot,
      'invoice_id', v_existing.id,
      'total', v_existing.total,
      'cash_paid', v_existing.amount_paid,
      'credit_applied', v_existing.credit_applied,
      'balance', v_existing.balance
    );
  END IF;

  SELECT contact.name, account.default_currency
  INTO v_name, v_currency
  FROM public.contacts contact
  JOIN public.accounts account ON account.id = contact.account_id
  WHERE contact.id = v_contact_id
    AND contact.account_id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer contact not found';
  END IF;

  IF v_membership_id IS NOT NULL THEN
    SELECT membership.member_number INTO v_member_number
    FROM public.memberships membership
    WHERE membership.id = v_membership_id
      AND membership.account_id = v_account_id
      AND membership.contact_id = v_contact_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membership not found';
    END IF;
  END IF;

  INSERT INTO public.invoices (
    account_id,
    contact_id,
    membership_id,
    source,
    issued_at,
    customer_name_snapshot,
    member_number_snapshot,
    currency,
    created_by,
    idempotency_key
  ) VALUES (
    v_account_id,
    v_contact_id,
    v_membership_id,
    CASE WHEN v_mode = 'service_renewal' THEN 'service_renewal' ELSE 'sale' END,
    COALESCE((p_payload->>'issued_at')::TIMESTAMPTZ, NOW()),
    v_name,
    v_member_number,
    v_currency,
    (SELECT auth.uid()),
    v_key
  ) RETURNING id INTO v_invoice_id;

  PERFORM public.append_catalog_selections(
    v_invoice_id,
    v_membership_id,
    v_contact_id,
    COALESCE(p_payload->'selections', '[]'::JSONB)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_lines WHERE invoice_id = v_invoice_id
  ) THEN
    RAISE EXCEPTION 'Select at least one product or service';
  END IF;

  IF v_membership_id IS NOT NULL THEN
    PERFORM public.apply_oldest_member_credit(v_invoice_id);
  END IF;

  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  WHERE balance.id = v_invoice_id;
  IF v_collect < 0 OR v_collect > v_result.balance THEN
    RAISE EXCEPTION 'Collected amount must be between zero and the invoice balance';
  END IF;

  IF v_collect > 0 THEN
    PERFORM set_config('app.payment_purpose', 'sale', TRUE);
    INSERT INTO public.payments (
      account_id,
      membership_id,
      contact_id,
      user_id,
      invoice_id,
      amount,
      method,
      status,
      paid_at,
      receipt_bucket,
      screenshot_path,
      note,
      idempotency_key
    ) VALUES (
      v_account_id,
      v_membership_id,
      v_contact_id,
      (SELECT auth.uid()),
      v_invoice_id,
      v_collect,
      COALESCE(NULLIF(v_collection->>'method', ''), 'cash'),
      'paid',
      COALESCE((v_collection->>'paid_at')::TIMESTAMPTZ, NOW()),
      CASE
        WHEN NULLIF(v_collection->>'receipt_path', '') IS NULL THEN NULL
        ELSE 'payment-receipts'
      END,
      NULLIF(v_collection->>'receipt_path', ''),
      NULLIF(BTRIM(v_collection->>'note'), ''),
      v_key
    ) RETURNING id INTO v_payment_id;
    PERFORM set_config('app.payment_purpose', '', TRUE);
  END IF;

  SELECT balance.* INTO v_result
  FROM public.invoice_balances balance
  WHERE balance.id = v_invoice_id;
  RETURN jsonb_build_object(
    'membership_id', v_membership_id,
    'member_number', v_member_number,
    'invoice_id', v_result.id,
    'total', v_result.total,
    'cash_paid', v_result.amount_paid,
    'credit_applied', v_result.credit_applied,
    'balance', v_result.balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.perform_contact_checkout(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_contact_checkout(JSONB)
  TO authenticated;
