-- Read-only operator recheck through the approved Production database connector.
-- Saved email-send evidence does not establish inbox receipt or customer reading.
-- No PDF bytes, party addresses, credentials, or email addresses are returned.
BEGIN READ ONLY;

SELECT
  now() AS checked_at,
  a.organization_id,
  a.id AS account_id,
  a.name AS branch_name,
  a.branch_status,
  a.readiness_state,
  a.setup_reviewed_at,
  a.setup_reviewed_by,
  a.branch_status = 'active'
    AND a.readiness_state = 'ready'
    AND a.setup_reviewed_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.membership_plans p
      JOIN public.plan_pricing_options price
        ON price.account_id = p.account_id AND price.plan_id = p.id
      WHERE p.account_id = a.id AND p.is_active AND price.is_active
    ) AS setup_complete,
  jsonb_build_object(
    'name', entity.name,
    'legal_name', entity.legal_name,
    'currency', a.default_currency,
    'locale', a.locale,
    'timezone', a.timezone,
    'upi_configured', NULLIF(btrim(a.upi_vpa), '') IS NOT NULL
      AND NULLIF(btrim(a.upi_payee_name), '') IS NOT NULL
  ) AS configuration,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'is_active', p.is_active,
      'plan_type', p.plan_type,
      'pricing_options', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', price.id, 'duration_count', price.duration_count,
          'duration_unit', price.duration_unit, 'price', price.price,
          'setup_fee', price.setup_fee, 'is_active', price.is_active
        ) ORDER BY price.sort_order, price.id)
        FROM public.plan_pricing_options price
        WHERE price.account_id = a.id AND price.plan_id = p.id
      )
    ) ORDER BY p.id)
    FROM public.membership_plans p WHERE p.account_id = a.id
  ) AS plans,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'issue_id', i.issue_id, 'issued_at', i.issued_at,
      'invoice_number', i.invoice_number, 'receipt_number', i.receipt_number,
      'invoice_bytes', octet_length(i.invoice_pdf),
      'receipt_bytes', octet_length(i.receipt_pdf),
      'invoice_sha256', i.invoice_sha256, 'receipt_sha256', i.receipt_sha256,
      'invoice_hash_matches', i.invoice_sha256 = encode(extensions.digest(i.invoice_pdf, 'sha256'), 'hex'),
      'receipt_hash_matches', i.receipt_sha256 = encode(extensions.digest(i.receipt_pdf, 'sha256'), 'hex'),
      'amount_minor', i.snapshot->'amount_minor', 'currency', i.snapshot->'currency',
      'period_start', i.snapshot->'period_start',
      'paid_through_end', i.snapshot->'paid_through_end'
    ) ORDER BY i.issued_at)
    FROM private.subscription_live_document_issues i
    WHERE i.organization_id = a.organization_id
      AND i.issue_id = '5bea21ad-70e5-4b70-a7de-8ab74f2c222f'
  ) AS issued_documents,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'audit_id', l.id, 'recorded_at', l.created_at,
      'channel', l.details->'channel', 'sent_at', l.details->'sent_at',
      'provider_state', l.details->'provider_state',
      'gmail_message_id', l.details->'gmail_message_id',
      'registered_recipient_matches', l.details->>'recipient' = owner.email,
      'customer_receipt_or_read', l.details->'customer_receipt_or_read'
    ) ORDER BY l.created_at)
    FROM public.organization_audit_log l
    WHERE l.organization_id = a.organization_id AND l.account_id = a.id
      AND l.operation = 'subscription.documents_sent'
      AND l.details->>'issue_id' = '5bea21ad-70e5-4b70-a7de-8ab74f2c222f'
  ) AS email_send_records,
  (SELECT count(*) FROM public.whatsapp_config w WHERE w.account_id = a.id)
    AS whatsapp_configuration_rows,
  (
    SELECT jsonb_build_object(
      'version', access.version, 'suspended_at', access.suspended_at,
      'access_starts_at', access.access_starts_at,
      'access_ends_at', access.access_ends_at
    ) FROM private.organization_product_access access
    WHERE access.organization_id = a.organization_id
  ) AS preserved_access
FROM public.accounts a
JOIN public.legal_entities entity ON entity.id = a.legal_entity_id
JOIN auth.users owner ON owner.id = a.owner_user_id
WHERE a.id = 'ffca6ffb-691b-4fa9-9b7f-481a22d00a2e'
  AND a.organization_id = '4c549182-7ad3-4f0b-8977-ff8ca79d2992';

COMMIT;
