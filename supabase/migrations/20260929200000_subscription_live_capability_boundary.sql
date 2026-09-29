-- Dark Live grant recognition for the existing named capability predicate.
-- The separate capabilities_enabled switch remains false. The same database
-- predicate drives RLS, service writes and the web/native account snapshot.
CREATE OR REPLACE FUNCTION private.subscription_capability_allowed(
  p_account_id UUID,p_capability TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT
   p_capability=ANY(ARRAY['standard_renewal_reminders','custom_renewal_schedules',
     'bulk_campaigns','configurable_automations','gym_payment_links','gym_autopay'])
   AND private.account_has_product_access(ac.id)
   AND CASE
     WHEN NOT s.capabilities_enabled THEN TRUE
     WHEN private.product_access_status(a) IN ('trial','complimentary') THEN TRUE
     WHEN private.product_access_status(a)<>'active' THEN FALSE
     WHEN g.organization_id IS NOT NULL AND lg.organization_id IS NOT NULL THEN FALSE
     WHEN lg.organization_id IS NOT NULL THEN
       a.mode='manual'
       AND a.access_starts_at IS NOT DISTINCT FROM lg.period_start
       AND a.access_ends_at IS NOT DISTINCT FROM lg.paid_through_end
       AND lg.refund_confirmed_at IS NULL
       AND (p_capability='standard_renewal_reminders'
         OR lg.tier IN ('growth','ultimate'))
     WHEN g.organization_id IS NULL THEN TRUE -- grandfathered manual term
     WHEN a.mode<>'manual' OR a.access_starts_at IS DISTINCT FROM g.period_start THEN FALSE
     WHEN (a.access_ends_at=g.paid_through_end OR (
       a.access_ends_at=g.paid_through_end+interval '72 hours' AND EXISTS(
         SELECT 1 FROM private.organization_subscription_intents i
         WHERE i.organization_id=g.organization_id AND i.kind='renewal'
           AND i.source_period_end=g.paid_through_end AND i.first_failed_at IS NOT NULL
           AND i.expected_access_version=a.version))) IS NOT TRUE THEN FALSE
     ELSE p_capability='standard_renewal_reminders' OR g.tier IN ('growth','ultimate')
   END
 FROM public.accounts ac
 JOIN private.organization_product_access a ON a.organization_id=ac.organization_id
 CROSS JOIN private.subscription_billing_settings s
 LEFT JOIN private.organization_paid_subscription_grants g
   ON g.organization_id=ac.organization_id
 LEFT JOIN private.subscription_live_grants lg
   ON lg.organization_id=ac.organization_id
 WHERE ac.id=p_account_id AND s.singleton),FALSE);
$$;
REVOKE ALL ON FUNCTION private.subscription_capability_allowed(UUID,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_capability_allowed(UUID,TEXT) OWNER TO postgres;
