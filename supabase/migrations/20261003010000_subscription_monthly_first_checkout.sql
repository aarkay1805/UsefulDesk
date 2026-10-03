-- Closed monthly-first foundation only. No offer, evidence, owner review or
-- opening authority is seeded. Existing NULL identities remain Starter v1.
CREATE TABLE IF NOT EXISTS private.subscription_monthly_catalog (
 contract_version TEXT NOT NULL CHECK(contract_version='monthly_first_v1'),
 catalog_version TEXT NOT NULL CHECK(catalog_version='monthly_inr_2026_10_v1'),
 tier TEXT NOT NULL CHECK(tier IN ('starter','growth','ultimate')),
 amount_minor BIGINT NOT NULL,
 currency TEXT NOT NULL CHECK(currency='INR'),
 included_branches INTEGER NOT NULL,
 paid_extra_branch_slots INTEGER NOT NULL CHECK(paid_extra_branch_slots=0),
 PRIMARY KEY(contract_version,catalog_version,tier),
 UNIQUE(contract_version,catalog_version,tier,amount_minor,currency,included_branches,paid_extra_branch_slots),
 CHECK((tier='starter' AND amount_minor=79900 AND included_branches=1)
    OR (tier='growth' AND amount_minor=149900 AND included_branches=1)
    OR (tier='ultimate' AND amount_minor=399900 AND included_branches=5))
);
INSERT INTO private.subscription_monthly_catalog
 (contract_version,catalog_version,tier,amount_minor,currency,included_branches,paid_extra_branch_slots)
VALUES ('monthly_first_v1','monthly_inr_2026_10_v1','starter',79900,'INR',1,0),
 ('monthly_first_v1','monthly_inr_2026_10_v1','growth',149900,'INR',1,0),
 ('monthly_first_v1','monthly_inr_2026_10_v1','ultimate',399900,'INR',5,0)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS private.subscription_monthly_offer_sets (
 offer_set_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 billing_account_id UUID NOT NULL REFERENCES public.accounts(id),
 merchant_id TEXT NOT NULL CHECK(merchant_id ~ '^acc_[A-Za-z0-9]+$'),
 owner_user_id UUID NOT NULL REFERENCES auth.users(id),
 source_access_version INTEGER NOT NULL CHECK(source_access_version>0),
 active_account_ids UUID[] NOT NULL CHECK(cardinality(active_account_ids)>=1),
 source_snapshot TEXT NOT NULL CHECK(source_snapshot ~ '^[0-9a-f]{64}$'),
 commercial_snapshot TEXT NOT NULL CHECK(commercial_snapshot ~ '^[0-9a-f]{64}$'),
 operator_user_id UUID NOT NULL REFERENCES auth.users(id),
 release_sha TEXT NOT NULL CHECK(release_sha ~ '^[0-9a-f]{40}$'),
 migration_manifest_sha256 TEXT NOT NULL CHECK(migration_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 2000),
 buyer_geography_reference TEXT NOT NULL CHECK(length(btrim(buyer_geography_reference)) BETWEEN 1 AND 2000),
 issuer_financial_year_reference TEXT NOT NULL CHECK(length(btrim(issuer_financial_year_reference)) BETWEEN 1 AND 2000),
 tax_receipt_review_reference TEXT NOT NULL CHECK(length(btrim(tax_receipt_review_reference)) BETWEEN 1 AND 2000),
 provider_acceptance_reference TEXT NOT NULL CHECK(length(btrim(provider_acceptance_reference)) BETWEEN 1 AND 2000),
 backup_recovery_reference TEXT NOT NULL CHECK(length(btrim(backup_recovery_reference)) BETWEEN 1 AND 2000),
 capability_readiness_reference TEXT NOT NULL CHECK(length(btrim(capability_readiness_reference)) BETWEEN 1 AND 2000),
 reminder_policy_version TEXT NOT NULL CHECK(length(btrim(reminder_policy_version))>0),
 owner_review_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT owner_review_enabled),
 opening_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT opening_enabled),
 opened_at TIMESTAMPTZ CHECK(opened_at IS NULL OR isfinite(opened_at)),
 prepared_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK(isfinite(prepared_at)),
 revoked_at TIMESTAMPTZ CHECK(revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=prepared_at)),
 UNIQUE(offer_set_id,organization_id,billing_account_id,merchant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_monthly_one_active_offer_set
 ON private.subscription_monthly_offer_sets(organization_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS private.subscription_monthly_offers (
 monthly_offer_id UUID PRIMARY KEY,
 offer_set_id UUID NOT NULL,
 organization_id UUID NOT NULL,
 billing_account_id UUID NOT NULL,
 merchant_id TEXT NOT NULL,
 contract_version TEXT NOT NULL,
 catalog_version TEXT NOT NULL,
 tier TEXT NOT NULL,
 amount_minor BIGINT NOT NULL,
 currency TEXT NOT NULL,
 included_branches INTEGER NOT NULL,
 paid_extra_branch_slots INTEGER NOT NULL,
 approval_id UUID NOT NULL UNIQUE,
 customer_tax_note TEXT NOT NULL CHECK(length(btrim(customer_tax_note)) BETWEEN 1 AND 2000),
 customer_terms_note TEXT NOT NULL CHECK(length(btrim(customer_terms_note)) BETWEEN 1 AND 2000),
 customer_refund_note TEXT NOT NULL CHECK(length(btrim(customer_refund_note)) BETWEEN 1 AND 2000),
 document_treatment TEXT NOT NULL CHECK(document_treatment='usefulmade_unregistered_invoice_receipt_v1'),
 UNIQUE(offer_set_id,tier),
 UNIQUE(monthly_offer_id,organization_id,billing_account_id,merchant_id),
 FOREIGN KEY(offer_set_id,organization_id,billing_account_id,merchant_id)
  REFERENCES private.subscription_monthly_offer_sets(offer_set_id,organization_id,billing_account_id,merchant_id),
 FOREIGN KEY(contract_version,catalog_version,tier,amount_minor,currency,included_branches,paid_extra_branch_slots)
  REFERENCES private.subscription_monthly_catalog(contract_version,catalog_version,tier,amount_minor,currency,included_branches,paid_extra_branch_slots),
 FOREIGN KEY(approval_id,organization_id,merchant_id)
  REFERENCES private.subscription_live_offer_approvals(approval_id,organization_id,merchant_id)
);
ALTER TABLE private.subscription_live_offer_approvals
 ADD COLUMN IF NOT EXISTS offer_contract_version TEXT,
 ADD COLUMN IF NOT EXISTS catalog_version TEXT;
ALTER TABLE private.subscription_live_customer_preparations
 ADD COLUMN IF NOT EXISTS monthly_offer_id UUID REFERENCES private.subscription_monthly_offers(monthly_offer_id);
ALTER TABLE private.subscription_live_customer_reviews
 ADD COLUMN IF NOT EXISTS monthly_offer_id UUID REFERENCES private.subscription_monthly_offers(monthly_offer_id);
ALTER TABLE private.subscription_live_quotes
 ADD COLUMN IF NOT EXISTS monthly_offer_id UUID REFERENCES private.subscription_monthly_offers(monthly_offer_id),
 ADD COLUMN IF NOT EXISTS offer_contract_version TEXT,
 ADD COLUMN IF NOT EXISTS catalog_version TEXT;

-- Catalog cannot be rewritten, deleted or truncated, even by the migration role.
CREATE OR REPLACE FUNCTION private.subscription_monthly_immutable_catalog()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Monthly catalog is immutable' USING ERRCODE='55000'; END;
$$;
DROP TRIGGER IF EXISTS subscription_monthly_immutable_catalog ON private.subscription_monthly_catalog;
CREATE TRIGGER subscription_monthly_immutable_catalog BEFORE UPDATE OR DELETE ON private.subscription_monthly_catalog
 FOR EACH ROW EXECUTE FUNCTION private.subscription_monthly_immutable_catalog();
DROP TRIGGER IF EXISTS subscription_monthly_no_catalog_truncate ON private.subscription_monthly_catalog;
CREATE TRIGGER subscription_monthly_no_catalog_truncate BEFORE TRUNCATE ON private.subscription_monthly_catalog
 FOR EACH STATEMENT EXECUTE FUNCTION private.subscription_monthly_immutable_catalog();

-- The later reviewed operator/owner transactions replace these closed guards.
-- No partial identity can grant a monthly contract through an original writer.
CREATE OR REPLACE FUNCTION private.subscription_monthly_closed_attachment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ref JSONB:=to_jsonb(NEW);
BEGIN
 IF ref->>'monthly_offer_id' IS NOT NULL OR ref->>'offer_contract_version' IS NOT NULL OR ref->>'catalog_version' IS NOT NULL THEN
  RAISE EXCEPTION 'Monthly owner authority is not installed' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION private.subscription_monthly_freeze_authority()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR TG_OP='TRUNCATE' OR TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Monthly operator authority is not installed' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='subscription_monthly_offers' THEN
  RAISE EXCEPTION 'Monthly offer authority is immutable' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR
  (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
  RAISE EXCEPTION 'Monthly offer authority is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;
DO $$ DECLARE t TEXT; f TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['subscription_monthly_catalog','subscription_monthly_offer_sets','subscription_monthly_offers'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON private.%I TO service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['subscription_monthly_offer_sets','subscription_monthly_offers'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS subscription_monthly_freeze_authority ON private.%I',t);
  EXECUTE format('CREATE TRIGGER subscription_monthly_freeze_authority BEFORE INSERT OR UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.subscription_monthly_freeze_authority()',t);
  EXECUTE format('DROP TRIGGER IF EXISTS subscription_monthly_no_authority_truncate ON private.%I',t);
  EXECUTE format('CREATE TRIGGER subscription_monthly_no_authority_truncate BEFORE TRUNCATE ON private.%I FOR EACH STATEMENT EXECUTE FUNCTION private.subscription_monthly_freeze_authority()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['subscription_live_offer_approvals','subscription_live_customer_preparations','subscription_live_customer_reviews','subscription_live_quotes'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS subscription_monthly_closed_attachment ON private.%I',t);
  EXECUTE format('CREATE TRIGGER subscription_monthly_closed_attachment BEFORE INSERT OR UPDATE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.subscription_monthly_closed_attachment()',t);
 END LOOP;
 FOREACH f IN ARRAY ARRAY['subscription_monthly_immutable_catalog','subscription_monthly_closed_attachment','subscription_monthly_freeze_authority'] LOOP
  EXECUTE format('ALTER FUNCTION private.%I() OWNER TO postgres',f);
  EXECUTE format('REVOKE ALL ON FUNCTION private.%I() FROM PUBLIC,anon,authenticated,service_role',f);
 END LOOP;
END $$;

-- Reviewed operator preparation. Payment, owner materialization and opening stay closed.
ALTER TABLE private.subscription_monthly_offer_sets
 DROP CONSTRAINT IF EXISTS subscription_monthly_offer_sets_owner_review_enabled_check;

CREATE OR REPLACE FUNCTION private.subscription_monthly_source_context(p_organization_id UUID,p_billing_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c JSONB; facts JSONB; missing JSONB; b JSONB; l JSONB;
BEGIN
 c:=private.subscription_starter_signup_context(p_organization_id);
 SELECT to_jsonb(s)-ARRAY['updated_at'] INTO b FROM private.subscription_billing_settings s WHERE singleton;
 SELECT jsonb_build_object('merchant_id',s.merchant_id,'pilot_organization_id',s.pilot_organization_id,
  'webhook_intake_enabled',s.webhook_intake_enabled,'settlements_enabled',s.settlements_enabled)
 INTO l FROM private.subscription_live_settings s WHERE singleton;
 missing:=(c->'missing_facts')-ARRAY['one_active_branch','inr_branch','buyer_details','gym_setup'];
 IF jsonb_array_length(c->'branches')=0 THEN missing:=missing||'"active_branch"'::JSONB; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c->'branches') a WHERE a->>'account_id'=p_billing_account_id::TEXT) THEN
  missing:=missing||'"billing_branch"'::JSONB; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'branches') a WHERE a->>'currency' IS DISTINCT FROM 'INR') THEN
  missing:=missing||'"inr_branch"'::JSONB; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'branches') a WHERE a->>'buyer_complete' IS DISTINCT FROM 'true') THEN
  missing:=missing||'"buyer_details"'::JSONB; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'branches') a WHERE a->>'setup_complete' IS DISTINCT FROM 'true') THEN
  missing:=missing||'"gym_setup"'::JSONB; END IF;
 IF p_organization_id::TEXT=l->>'pilot_organization_id'
  OR p_organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID THEN missing:=missing||'"internal_organization"'::JSONB; END IF;
 facts:=(c-ARRAY['snapshot_token','commercial_token','missing_facts'])||jsonb_build_object(
  'billing_account_id',p_billing_account_id,'live_readiness',l,
  'reminders',jsonb_build_object('approved',b->'standard_reminder_policy_approved',
   'version',b->'standard_reminder_policy_version','days',b->'standard_reminder_days_before','hour',b->'standard_reminder_hour_local'));
 RETURN facts||jsonb_build_object('missing_facts',missing,
  'snapshot_token',encode(extensions.digest(facts::TEXT,'sha256'),'hex'),
  'commercial_token',encode(extensions.digest((facts-'access')::TEXT,'sha256'),'hex'));
END;
$$;

-- New/moved source rows serialize before becoming visible, including first preparation.
-- Existing source edits are protected by the NOWAIT row locks below.
CREATE OR REPLACE FUNCTION private.subscription_monthly_serialize_source_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ref JSONB:=to_jsonb(NEW); old_ref JSONB; org UUID; old_org UUID;
BEGIN
 IF ref ? 'organization_id' THEN org:=(ref->>'organization_id')::UUID;
 ELSE SELECT organization_id INTO org FROM public.accounts WHERE id=(ref->>'account_id')::UUID; END IF;
 IF TG_OP='UPDATE' THEN
  old_ref:=to_jsonb(OLD);
  IF old_ref ? 'organization_id' THEN old_org:=(old_ref->>'organization_id')::UUID;
  ELSE SELECT organization_id INTO old_org FROM public.accounts WHERE id=(old_ref->>'account_id')::UUID; END IF;
  IF old_org IS NOT DISTINCT FROM org THEN RETURN NEW; END IF;
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE NOWAIT;
 RETURN NEW;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Prepared facts are being edited. Refresh and try again.' USING ERRCODE='40001';
END;
$$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['organization_memberships','accounts','legal_entities','invoice_profiles','membership_plans','plan_pricing_options'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS subscription_monthly_serialize_source_write ON public.%I',t);
  EXECUTE format('CREATE TRIGGER subscription_monthly_serialize_source_write BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.subscription_monthly_serialize_source_write()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION private.subscription_monthly_lock_sources(p_organization_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Gym business not found' USING ERRCODE='22023'; END IF;
 -- Reuse the established organization-first source row locks and retry behavior.
 PERFORM private.subscription_lock_starter_preparation_sources(p_organization_id);
 PERFORM 1 FROM private.subscription_monthly_offer_sets WHERE organization_id=p_organization_id FOR UPDATE NOWAIT;
 PERFORM 1 FROM private.subscription_live_offer_approvals WHERE organization_id=p_organization_id FOR UPDATE NOWAIT;
 PERFORM 1 FROM private.subscription_live_customer_preparations WHERE organization_id=p_organization_id FOR SHARE NOWAIT;
 PERFORM 1 FROM private.subscription_live_customer_reviews WHERE organization_id=p_organization_id FOR SHARE NOWAIT;
 PERFORM 1 FROM private.subscription_live_customer_scopes WHERE organization_id=p_organization_id FOR SHARE NOWAIT;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Prepared facts are being edited. Refresh and try again.' USING ERRCODE='40001';
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_monthly_freeze_authority()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE set_row private.subscription_monthly_offer_sets; approval private.subscription_live_offer_approvals;
BEGIN
 IF TG_OP IN ('TRUNCATE','DELETE') THEN RAISE EXCEPTION 'Monthly offer authority is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.offer_set_id IS NULL OR current_setting('app.subscription_monthly_prepare',TRUE) IS DISTINCT FROM NEW.offer_set_id::TEXT THEN
   RAISE EXCEPTION 'Reviewed monthly preparation required' USING ERRCODE='55000'; END IF;
  PERFORM private.require_platform_admin();
  IF TG_TABLE_NAME='subscription_monthly_offers' THEN
   SELECT * INTO set_row FROM private.subscription_monthly_offer_sets WHERE offer_set_id=NEW.offer_set_id;
   SELECT * INTO approval FROM private.subscription_live_offer_approvals WHERE approval_id=NEW.approval_id;
   IF set_row.revoked_at IS NOT NULL OR approval.revoked_at IS NOT NULL OR approval.organization_id IS DISTINCT FROM NEW.organization_id
    OR approval.merchant_id IS DISTINCT FROM NEW.merchant_id OR approval.tier IS DISTINCT FROM NEW.tier
    OR approval.amount_minor IS DISTINCT FROM NEW.amount_minor OR approval.currency IS DISTINCT FROM NEW.currency
    OR approval.offer_contract_version IS DISTINCT FROM NEW.contract_version OR approval.catalog_version IS DISTINCT FROM NEW.catalog_version
    OR approval.customer_tax_note IS DISTINCT FROM NEW.customer_tax_note OR approval.customer_terms_note IS DISTINCT FROM NEW.customer_terms_note THEN
    RAISE EXCEPTION 'Monthly approval does not match offer' USING ERRCODE='55000'; END IF;
  ELSE
   IF NEW.opening_enabled OR NEW.opened_at IS NOT NULL OR NEW.operator_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Monthly opening remains closed' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='subscription_monthly_offers' THEN
  RAISE EXCEPTION 'Monthly offer authority is immutable' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR
  (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
  RAISE EXCEPTION 'Monthly offer authority is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;

-- Only the approval attachment is installed here. Owner reviews and quotes still fail closed.
CREATE OR REPLACE FUNCTION private.subscription_monthly_closed_attachment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ref JSONB:=to_jsonb(NEW);
BEGIN
 IF TG_TABLE_NAME='subscription_live_offer_approvals' THEN
  IF TG_OP='UPDATE' AND (NEW.offer_contract_version IS DISTINCT FROM OLD.offer_contract_version
    OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version) THEN
   RAISE EXCEPTION 'Offer identity is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.offer_contract_version IS NULL AND NEW.catalog_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.offer_contract_version IS DISTINCT FROM 'monthly_first_v1' OR NEW.catalog_version IS DISTINCT FROM 'monthly_inr_2026_10_v1' THEN
   RAISE EXCEPTION 'Unknown monthly identity' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
   PERFORM private.require_platform_admin();
   IF NOT EXISTS(SELECT 1 FROM private.subscription_monthly_offer_sets s
    WHERE s.offer_set_id::TEXT=current_setting('app.subscription_monthly_prepare',TRUE)
     AND s.organization_id=NEW.organization_id AND s.merchant_id=NEW.merchant_id AND s.revoked_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM private.subscription_monthly_catalog c WHERE c.contract_version=NEW.offer_contract_version
     AND c.catalog_version=NEW.catalog_version AND c.tier=NEW.tier AND c.amount_minor=NEW.amount_minor AND c.currency=NEW.currency) THEN
    RAISE EXCEPTION 'Reviewed monthly approval required' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals a
  WHERE a.approval_id=(ref->>'offer_approval_id')::UUID AND a.offer_contract_version IS NOT NULL) THEN
  RAISE EXCEPTION 'Monthly approval cannot use original owner authority' USING ERRCODE='55000'; END IF;
 IF ref->>'monthly_offer_id' IS NOT NULL OR ref->>'offer_contract_version' IS NOT NULL OR ref->>'catalog_version' IS NOT NULL THEN
  RAISE EXCEPTION 'Monthly owner authority is not installed' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;

-- The NULL branch below preserves the original guard verbatim.
CREATE OR REPLACE FUNCTION private.subscription_guard_starter_pilot_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.offer_contract_version IS NOT NULL OR NEW.catalog_version IS NOT NULL THEN
    -- The monthly attachment guard validates reviewed set membership and exact catalog economics.
    IF NEW.offer_contract_version IS DISTINCT FROM 'monthly_first_v1'
      OR NEW.catalog_version IS DISTINCT FROM 'monthly_inr_2026_10_v1'
      OR NEW.provider_mode IS DISTINCT FROM 'live' OR NEW.currency IS DISTINCT FROM 'INR'
      OR NEW.term_policy IS DISTINCT FROM 'calendar_month_from_capture_event'
      OR NEW.quote_validity_seconds IS DISTINCT FROM 1800
      OR NOT isfinite(NEW.approved_at) OR NEW.approved_at>clock_timestamp() THEN
      RAISE EXCEPTION 'Invalid monthly approval' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.organization_id IS DISTINCT FROM '8826d9aa-03f2-4ad7-ae91-0553052131f8'::UUID AND NOT EXISTS(SELECT 1 FROM private.subscription_live_settings s WHERE s.singleton AND s.merchant_id=NEW.merchant_id AND NEW.organization_id IS DISTINCT FROM s.pilot_organization_id AND EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=NEW.organization_id)))
    OR NEW.merchant_id IS DISTINCT FROM 'acc_TCJwBqanN9LTrK'
    OR NEW.provider_mode IS DISTINCT FROM 'live' OR NEW.tier IS DISTINCT FROM 'starter'
    OR NEW.amount_minor IS DISTINCT FROM 79900::BIGINT OR NEW.currency IS DISTINCT FROM 'INR'
    OR NEW.term_policy IS DISTINCT FROM 'calendar_month_from_capture_event'
    OR NEW.quote_validity_seconds IS DISTINCT FROM 1800
    OR NOT isfinite(NEW.approved_at) OR NEW.approved_at>clock_timestamp() THEN
    RAISE EXCEPTION 'Only the exact first Starter internal pilot offer is permitted'
      USING ERRCODE='22023'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_monthly_offer_context(p_organization_id UUID,p_billing_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c JSONB; s private.subscription_monthly_offer_sets;
BEGIN
 PERFORM private.require_platform_admin();
 c:=private.subscription_monthly_source_context(p_organization_id,p_billing_account_id);
 SELECT * INTO s FROM private.subscription_monthly_offer_sets WHERE organization_id=p_organization_id AND revoked_at IS NULL;
 RETURN jsonb_build_object('snapshot_token',c->>'snapshot_token','missing_facts',c->'missing_facts',
  'branches',(SELECT coalesce(jsonb_agg(a-'facts_hash'),'[]'::JSONB) FROM jsonb_array_elements(c->'branches') a),
  'offer_set_id',s.offer_set_id,'stale',s.offer_set_id IS NOT NULL AND s.source_snapshot IS DISTINCT FROM c->>'snapshot_token',
  'trial_ends_at',c->'access'->'trial_ends_at','opening_enabled',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_prepare_monthly_offers(
 p_organization_id UUID,p_billing_account_id UUID,p_expected_snapshot TEXT,p_offers JSONB,p_evidence JSONB,p_facts_reviewed BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c JSONB; old_set private.subscription_monthly_offer_sets; set_id UUID:=gen_random_uuid();
 offer JSONB; cat private.subscription_monthly_catalog; approval UUID; k TEXT; evidence_keys TEXT[];
BEGIN
 PERFORM private.require_platform_admin();
 IF p_facts_reviewed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Confirm the actual facts review first' USING ERRCODE='42501'; END IF;
 IF p_offers IS NULL OR jsonb_typeof(p_offers)<>'array' OR jsonb_array_length(p_offers) NOT BETWEEN 1 AND 3
  OR p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' THEN
  RAISE EXCEPTION 'Review one to three exact offers and actual evidence' USING ERRCODE='22023'; END IF;
 evidence_keys:=array_remove(array_remove(array_remove(private.subscription_starter_evidence_keys(),
  'offer_reference'),'customer_tax_note'),'customer_terms_note')||ARRAY['capability_readiness_reference'];
 IF EXISTS(SELECT 1 FROM jsonb_each(p_evidence) e WHERE NOT e.key=ANY(evidence_keys)
  OR jsonb_typeof(e.value)<>'string' OR length(btrim(e.value#>>'{}')) NOT BETWEEN 1 AND 2000)
  OR EXISTS(SELECT 1 FROM unnest(evidence_keys) key WHERE coalesce(length(btrim(p_evidence->>key)),0) NOT BETWEEN 1 AND 2000)
  OR p_evidence->>'release_sha' !~ '^[0-9a-f]{40}$' OR p_evidence->>'migration_manifest_sha256' !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Complete every actual commercial and capability review reference' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT o->>'tier') FROM jsonb_array_elements(p_offers) o)<>jsonb_array_length(p_offers) THEN
  RAISE EXCEPTION 'Review each tier only once' USING ERRCODE='22023'; END IF;
 FOR offer IN SELECT value FROM jsonb_array_elements(p_offers) LOOP
  IF jsonb_typeof(offer)<>'object' THEN RAISE EXCEPTION 'Invalid reviewed offer' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(offer) key WHERE key NOT IN
   ('tier','amount_minor','offer_reference','customer_tax_note','customer_terms_note','customer_refund_note','document_treatment'))
   OR jsonb_typeof(offer->'tier') IS DISTINCT FROM 'string' OR jsonb_typeof(offer->'amount_minor') IS DISTINCT FROM 'number'
   OR offer->>'document_treatment' IS DISTINCT FROM 'usefulmade_unregistered_invoice_receipt_v1' THEN
   RAISE EXCEPTION 'Unknown offer field or document treatment' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['offer_reference','customer_tax_note','customer_terms_note','customer_refund_note'] LOOP
   IF jsonb_typeof(offer->k) IS DISTINCT FROM 'string' OR coalesce(length(btrim(offer->>k)),0) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Complete each tier-specific customer review' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM private.subscription_monthly_catalog x WHERE x.tier=offer->>'tier'
   AND to_jsonb(x.amount_minor)=offer->'amount_minor') THEN
   RAISE EXCEPTION 'Reviewed total must match the exact monthly catalog' USING ERRCODE='22023'; END IF;
 END LOOP;
 PERFORM private.subscription_monthly_lock_sources(p_organization_id);
 c:=private.subscription_monthly_source_context(p_organization_id,p_billing_account_id);
 IF p_expected_snapshot IS DISTINCT FROM c->>'snapshot_token' THEN
  RAISE EXCEPTION 'Preparation changed. Refresh and review the latest details.' USING ERRCODE='40001'; END IF;
 IF jsonb_array_length(c->'missing_facts')<>0 THEN
  RAISE EXCEPTION 'Complete the actual buyer, setup and commercial facts first' USING ERRCODE='55000'; END IF;
 -- No replacement can silently rebind a selected owner review or financial obligation.
 IF EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals WHERE organization_id=p_organization_id AND revoked_at IS NULL AND offer_contract_version IS NULL) THEN
  RAISE EXCEPTION 'Existing preparation or owner review needs separate resolution' USING ERRCODE='55000'; END IF;
 SELECT * INTO old_set FROM private.subscription_monthly_offer_sets WHERE organization_id=p_organization_id AND revoked_at IS NULL;
 IF old_set.offer_set_id IS NOT NULL THEN
  IF old_set.source_snapshot=c->>'snapshot_token' OR old_set.opened_at IS NOT NULL THEN
   RAISE EXCEPTION 'Existing reviewed offers cannot be replaced without changed source facts' USING ERRCODE='55000'; END IF;
  UPDATE private.subscription_live_offer_approvals a SET revoked_at=clock_timestamp()
   WHERE a.approval_id IN (SELECT approval_id FROM private.subscription_monthly_offers WHERE offer_set_id=old_set.offer_set_id);
  UPDATE private.subscription_monthly_offer_sets SET revoked_at=clock_timestamp() WHERE offer_set_id=old_set.offer_set_id;
 END IF;
 PERFORM set_config('app.subscription_monthly_prepare',set_id::TEXT,TRUE);
 INSERT INTO private.subscription_monthly_offer_sets(offer_set_id,organization_id,billing_account_id,merchant_id,owner_user_id,
  source_access_version,active_account_ids,source_snapshot,commercial_snapshot,operator_user_id,release_sha,migration_manifest_sha256,
  authorization_reference,buyer_geography_reference,issuer_financial_year_reference,tax_receipt_review_reference,provider_acceptance_reference,
  backup_recovery_reference,capability_readiness_reference,reminder_policy_version,owner_review_enabled)
 VALUES(set_id,p_organization_id,p_billing_account_id,c->>'merchant_id',(c->'owners'->0->>'user_id')::UUID,
  (c->'access'->>'version')::INTEGER,ARRAY(SELECT (a->>'account_id')::UUID FROM jsonb_array_elements(c->'branches') a ORDER BY a->>'account_id'),
  c->>'snapshot_token',c->>'commercial_token',auth.uid(),p_evidence->>'release_sha',p_evidence->>'migration_manifest_sha256',
  p_evidence->>'authorization_reference',p_evidence->>'buyer_geography_reference',p_evidence->>'issuer_financial_year_reference',
  p_evidence->>'tax_receipt_review_reference',p_evidence->>'provider_acceptance_reference',p_evidence->>'backup_recovery_reference',
  p_evidence->>'capability_readiness_reference',c->>'reminder_policy_version',TRUE);
 FOR offer IN SELECT value FROM jsonb_array_elements(p_offers) LOOP
  SELECT * INTO STRICT cat FROM private.subscription_monthly_catalog WHERE tier=offer->>'tier';
  approval:=gen_random_uuid();
  INSERT INTO private.subscription_live_offer_approvals(approval_id,organization_id,merchant_id,tier,amount_minor,
   term_policy,quote_validity_seconds,offer_reference,tax_decision_reference,refund_policy_reference,merchant_approval_reference,
   customer_tax_note,customer_terms_note,approved_at,offer_contract_version,catalog_version)
  VALUES(approval,p_organization_id,c->>'merchant_id',cat.tier,cat.amount_minor,'calendar_month_from_capture_event',1800,
   offer->>'offer_reference',p_evidence->>'tax_receipt_review_reference',p_evidence->>'refund_policy_reference',
   p_evidence->>'merchant_approval_reference',offer->>'customer_tax_note',offer->>'customer_terms_note',clock_timestamp(),cat.contract_version,cat.catalog_version);
  INSERT INTO private.subscription_monthly_offers(monthly_offer_id,offer_set_id,organization_id,billing_account_id,merchant_id,
   contract_version,catalog_version,tier,amount_minor,currency,included_branches,paid_extra_branch_slots,approval_id,
   customer_tax_note,customer_terms_note,customer_refund_note,document_treatment)
  VALUES(gen_random_uuid(),set_id,p_organization_id,p_billing_account_id,c->>'merchant_id',cat.contract_version,cat.catalog_version,
   cat.tier,cat.amount_minor,cat.currency,cat.included_branches,cat.paid_extra_branch_slots,approval,
   offer->>'customer_tax_note',offer->>'customer_terms_note',offer->>'customer_refund_note',offer->>'document_treatment');
 END LOOP;
 PERFORM set_config('app.subscription_monthly_prepare','',TRUE);
 INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation,details)
 VALUES(p_organization_id,p_billing_account_id,auth.uid(),'subscription.monthly_offers_prepared',
  jsonb_build_object('offer_set_id',set_id,'opening_enabled',FALSE,'owner_review_created',FALSE));
 RETURN jsonb_build_object('offer_set_id',set_id,'opening_enabled',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_monthly_offer_preview(p_organization_id UUID,p_billing_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c JSONB; s private.subscription_monthly_offer_sets; unavailable TEXT; choices JSONB; capabilities BOOLEAN; selected UUID; missing JSONB;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
  RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
 c:=private.subscription_monthly_source_context(p_organization_id,p_billing_account_id);
 SELECT * INTO s FROM private.subscription_monthly_offer_sets WHERE organization_id=p_organization_id AND revoked_at IS NULL;
 SELECT p.monthly_offer_id INTO selected FROM private.subscription_live_customer_preparations p
  JOIN private.subscription_monthly_offers o ON o.monthly_offer_id=p.monthly_offer_id
  WHERE o.offer_set_id=s.offer_set_id AND p.owner_user_id=auth.uid() AND p.revoked_at IS NULL;
 missing:=c->'missing_facts';
 IF selected IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.subscription_live_quotes q WHERE q.organization_id=p_organization_id
   AND q.monthly_offer_id IS DISTINCT FROM selected)
  AND NOT EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id=p_organization_id)
  AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id=p_organization_id)
  AND NOT EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants WHERE organization_id=p_organization_id) THEN
  missing:=missing-'existing_obligation'; END IF;
 SELECT capabilities_enabled INTO capabilities FROM private.subscription_billing_settings WHERE singleton;
 IF s.offer_set_id IS NULL OR NOT s.owner_review_enabled THEN unavailable:='Offers need review. Contact support.';
 ELSIF s.owner_user_id IS DISTINCT FROM auth.uid() OR s.billing_account_id IS DISTINCT FROM p_billing_account_id
  OR s.source_snapshot IS DISTINCT FROM c->>'snapshot_token' OR jsonb_array_length(missing)<>0 THEN
  unavailable:='Your details changed. Ask support to review the offers again.';
 ELSIF (c->'access'->>'trial_ends_at')::TIMESTAMPTZ>clock_timestamp() THEN
  unavailable:='Your trial is still active. Review plans after it ends.';
 END IF;
 SELECT jsonb_agg(CASE WHEN unavailable IS NULL AND o.monthly_offer_id IS NOT NULL AND a.revoked_at IS NULL THEN
  jsonb_build_object('available',TRUE,'offerId',o.monthly_offer_id,'identity',jsonb_build_object(
   'contractVersion',o.contract_version,'catalogVersion',o.catalog_version,'tier',o.tier,'amountMinor',o.amount_minor,
   'currency',o.currency,'includedBranches',o.included_branches,'paidExtraBranchSlots',o.paid_extra_branch_slots),
   'taxNote',o.customer_tax_note,'termsNote',o.customer_terms_note,'refundNote',o.customer_refund_note,'documentTreatment',o.document_treatment)
  ELSE jsonb_build_object('available',FALSE,'tier',cat.tier,'reason',coalesce(unavailable,'This plan needs review. Contact support.')) END
  ORDER BY cat.amount_minor) INTO choices
 FROM private.subscription_monthly_catalog cat
 LEFT JOIN private.subscription_monthly_offers o ON o.offer_set_id=s.offer_set_id AND o.tier=cat.tier
 LEFT JOIN private.subscription_live_offer_approvals a ON a.approval_id=o.approval_id;
 RETURN jsonb_build_object('offerSetId',s.offer_set_id,'organizationId',p_organization_id,'billingAccountId',p_billing_account_id,
  'contractVersion','monthly_first_v1','catalogVersion','monthly_inr_2026_10_v1','sourceSnapshot',c->>'snapshot_token',
  'activeBranches',(SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',a->>'account_id','name',a->>'name') ORDER BY a->>'account_id'),'[]'::JSONB)
   FROM jsonb_array_elements(c->'branches') a),'selectedOfferId',selected,'choices',choices,
  'capabilitiesEnabled',coalesce(capabilities,FALSE),'openingEnabled',coalesce(selected IS NOT NULL AND private.subscription_monthly_current(selected,auth.uid())
   AND EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes sc JOIN private.subscription_live_customer_reviews r USING(review_id)
    WHERE sc.organization_id=p_organization_id AND r.monthly_offer_id=selected AND sc.quotes_enabled AND sc.orders_enabled),FALSE));
END;
$$;

-- Circular approval/offer identity is checked at transaction end, after both immutable rows exist.
CREATE OR REPLACE FUNCTION private.subscription_monthly_check_approval_offer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.offer_contract_version IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM private.subscription_monthly_offers o WHERE o.approval_id=NEW.approval_id
   AND o.organization_id=NEW.organization_id AND o.merchant_id=NEW.merchant_id
   AND o.contract_version=NEW.offer_contract_version AND o.catalog_version=NEW.catalog_version
   AND o.tier=NEW.tier AND o.amount_minor=NEW.amount_minor AND o.currency=NEW.currency
   AND o.customer_tax_note=NEW.customer_tax_note AND o.customer_terms_note=NEW.customer_terms_note) THEN
  RAISE EXCEPTION 'Monthly approval requires its exact immutable offer' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_monthly_check_approval_offer ON private.subscription_live_offer_approvals;
CREATE CONSTRAINT TRIGGER subscription_monthly_check_approval_offer AFTER INSERT OR UPDATE
 ON private.subscription_live_offer_approvals DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION private.subscription_monthly_check_approval_offer();

DO $$ DECLARE f REGPROCEDURE; BEGIN
 FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='private' AND p.proname LIKE 'subscription_monthly_%')
   OR (n.nspname='public' AND p.proname IN ('platform_admin_monthly_offer_context','platform_admin_prepare_monthly_offers','subscription_monthly_offer_preview')) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.platform_admin_monthly_offer_context(UUID,UUID),
 public.platform_admin_prepare_monthly_offers(UUID,UUID,TEXT,JSONB,JSONB,BOOLEAN),
 public.subscription_monthly_offer_preview(UUID,UUID) TO authenticated;

-- Monthly transactions: version dispatch shares the original financial ledgers.
-- Freeze original callable bodies once. They remain private and cannot be called
-- by a browser/service role; public wrappers preserve each existing signature.
DO $capture$ DECLARE spec TEXT; src REGPROCEDURE; dest TEXT; definition TEXT; BEGIN
 FOREACH spec IN ARRAY ARRAY[
 'public.subscription_open_reviewed_customer_scope(uuid,uuid,uuid)',
 'public.subscription_claim_live_order(uuid,uuid,uuid,text)',
 'public.subscription_bind_live_order(uuid,text,text,uuid)',
 'public.subscription_commit_live_initial_payment(uuid,text,text,text,bigint,text,timestamp with time zone)',
 'public.subscription_create_live_quote(uuid,uuid,uuid,uuid,uuid,bigint,text,text,boolean)',
 'private.subscription_customer_review_active(uuid,uuid)',
 'public.subscription_resolve_live_scope(text,uuid,text)',
 'public.subscription_claim_live_recovery_items(text,uuid,integer,uuid)',
 'public.subscription_live_order_for_capture(text,text,uuid)',
 'public.subscription_live_owner_quote(uuid)'] LOOP
  src:=spec::REGPROCEDURE;
  SELECT 'private.'||proname||'_before_monthly' INTO dest FROM pg_proc WHERE oid=src;
  IF to_regprocedure(dest||substring(spec FROM position('(' IN spec))) IS NULL THEN
   definition:=pg_get_functiondef(src);
   definition:=replace(definition,split_part(spec,'(',1)||'(',dest||'(');
   EXECUTE definition;
   EXECUTE 'ALTER FUNCTION '||dest||substring(spec FROM position('(' IN spec))||' OWNER TO postgres';
   EXECUTE 'REVOKE ALL ON FUNCTION '||dest||substring(spec FROM position('(' IN spec))||' FROM PUBLIC,anon,authenticated,service_role';
  END IF;
 END LOOP;
END $capture$;

ALTER TABLE private.subscription_monthly_offer_sets
 DROP CONSTRAINT IF EXISTS subscription_monthly_offer_sets_opening_enabled_check;
ALTER TABLE private.subscription_monthly_offer_sets
 ADD COLUMN IF NOT EXISTS opening_authorized_by UUID REFERENCES auth.users(id),
 ADD COLUMN IF NOT EXISTS opening_authorized_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS opening_review_reference TEXT;
CREATE OR REPLACE FUNCTION private.subscription_monthly_freeze_authority()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE set_row private.subscription_monthly_offer_sets; approval private.subscription_live_offer_approvals;
BEGIN
 IF TG_OP IN ('TRUNCATE','DELETE') THEN RAISE EXCEPTION 'Monthly offer authority is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.offer_set_id IS NULL OR current_setting('app.subscription_monthly_prepare',TRUE) IS DISTINCT FROM NEW.offer_set_id::TEXT THEN
   RAISE EXCEPTION 'Reviewed monthly preparation required' USING ERRCODE='55000'; END IF;
  PERFORM private.require_platform_admin();
  IF TG_TABLE_NAME='subscription_monthly_offers' THEN
   SELECT * INTO set_row FROM private.subscription_monthly_offer_sets WHERE offer_set_id=NEW.offer_set_id;
   SELECT * INTO approval FROM private.subscription_live_offer_approvals WHERE approval_id=NEW.approval_id;
   IF set_row.revoked_at IS NOT NULL OR approval.revoked_at IS NOT NULL OR approval.organization_id IS DISTINCT FROM NEW.organization_id
    OR approval.merchant_id IS DISTINCT FROM NEW.merchant_id OR approval.tier IS DISTINCT FROM NEW.tier
    OR approval.amount_minor IS DISTINCT FROM NEW.amount_minor OR approval.currency IS DISTINCT FROM NEW.currency
    OR approval.offer_contract_version IS DISTINCT FROM NEW.contract_version OR approval.catalog_version IS DISTINCT FROM NEW.catalog_version
    OR approval.customer_tax_note IS DISTINCT FROM NEW.customer_tax_note OR approval.customer_terms_note IS DISTINCT FROM NEW.customer_terms_note THEN
    RAISE EXCEPTION 'Monthly approval does not match offer' USING ERRCODE='55000'; END IF;
  ELSE
   IF NEW.opening_enabled OR NEW.opened_at IS NOT NULL OR NEW.operator_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Monthly opening remains closed' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='subscription_monthly_offers' THEN
  RAISE EXCEPTION 'Monthly offer authority is immutable' USING ERRCODE='55000'; END IF;
 IF NEW.opening_enabled IS DISTINCT FROM OLD.opening_enabled
  OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
  OR NEW.opening_authorized_at IS DISTINCT FROM OLD.opening_authorized_at
  OR NEW.opening_authorized_by IS DISTINCT FROM OLD.opening_authorized_by
  OR NEW.opening_review_reference IS DISTINCT FROM OLD.opening_review_reference THEN
  IF current_setting('app.subscription_monthly_opening',TRUE) IS DISTINCT FROM NEW.offer_set_id::TEXT
   OR OLD.opened_at IS NOT NULL OR NEW.revoked_at IS NOT NULL
   OR (OLD.opening_authorized_at IS NOT NULL AND (NEW.opening_authorized_at IS DISTINCT FROM OLD.opening_authorized_at
    OR NEW.opening_authorized_by IS DISTINCT FROM OLD.opening_authorized_by
    OR NEW.opening_review_reference IS DISTINCT FROM OLD.opening_review_reference)) THEN
   RAISE EXCEPTION 'Monthly opening is one-way reviewed authority' USING ERRCODE='55000'; END IF;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['revoked_at','opening_enabled','opened_at','opening_authorized_at','opening_authorized_by','opening_review_reference'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','opening_enabled','opened_at','opening_authorized_at','opening_authorized_by','opening_review_reference']) OR
  (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
  RAISE EXCEPTION 'Monthly offer authority is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;

-- This predicate does not raise on changed source facts: settlement can persist
-- a payment hold. Its own immutable quote(s) are allowed; all other work is not.
CREATE OR REPLACE FUNCTION private.subscription_monthly_current(p_offer_id UUID,p_actor UUID,p_check_access BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.subscription_monthly_offers; s private.subscription_monthly_offer_sets; c JSONB; b private.subscription_billing_settings;
BEGIN
 SELECT * INTO o FROM private.subscription_monthly_offers WHERE monthly_offer_id=p_offer_id;
 SELECT * INTO s FROM private.subscription_monthly_offer_sets WHERE offer_set_id=o.offer_set_id;
 IF s.offer_set_id IS NULL OR s.revoked_at IS NOT NULL OR NOT s.owner_review_enabled
  OR s.owner_user_id IS DISTINCT FROM p_actor THEN RETURN FALSE; END IF;
 c:=private.subscription_monthly_source_context(s.organization_id,s.billing_account_id);
 SELECT * INTO b FROM private.subscription_billing_settings WHERE singleton;
 RETURN coalesce(b.capabilities_enabled AND length(btrim(s.capability_readiness_reference))>0
  AND s.commercial_snapshot=c->>'commercial_token'
  AND (NOT p_check_access OR (s.source_snapshot=c->>'snapshot_token'
    AND (c->'access'->>'trial_ends_at')::TIMESTAMPTZ<=clock_timestamp()))
  AND ((c->'missing_facts')-CASE WHEN p_check_access THEN ARRAY['existing_obligation'] ELSE ARRAY['existing_obligation','normal_trial'] END)='[]'::JSONB
  AND cardinality(s.active_account_ids)<=o.included_branches
  AND EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals a WHERE a.approval_id=o.approval_id
   AND a.revoked_at IS NULL AND a.offer_contract_version=o.contract_version AND a.catalog_version=o.catalog_version)
  AND NOT EXISTS(SELECT 1 FROM private.subscription_live_quotes q WHERE q.organization_id=s.organization_id
   AND q.monthly_offer_id IS DISTINCT FROM o.monthly_offer_id)
  AND (NOT p_check_access OR (NOT EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id=s.organization_id)
    AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id=s.organization_id)
    AND NOT EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants WHERE organization_id=s.organization_id))),FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_customer_review_active(p_organization_id UUID,p_review_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.subscription_live_customer_reviews;
BEGIN
 SELECT * INTO r FROM private.subscription_live_customer_reviews WHERE review_id=p_review_id;
 IF r.monthly_offer_id IS NULL THEN RETURN private.subscription_customer_review_active_before_monthly(p_organization_id,p_review_id); END IF;
 RETURN r.organization_id=p_organization_id AND r.revoked_at IS NULL
  AND private.subscription_monthly_current(r.monthly_offer_id,r.reviewed_by,FALSE)
  AND EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations p WHERE p.review_id=r.review_id
   AND p.revoked_at IS NULL AND p.monthly_offer_id=r.monthly_offer_id AND p.owner_user_id=r.reviewed_by)
  AND EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes c WHERE c.organization_id=r.organization_id AND c.review_id=r.review_id);
END;
$$;
CREATE OR REPLACE FUNCTION private.subscription_monthly_closed_attachment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ref JSONB:=to_jsonb(NEW); o private.subscription_monthly_offers; s private.subscription_monthly_offer_sets; k TEXT;
BEGIN
 IF TG_TABLE_NAME='subscription_live_offer_approvals' THEN
  IF TG_OP='UPDATE' AND (NEW.offer_contract_version IS DISTINCT FROM OLD.offer_contract_version
    OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version) THEN
   RAISE EXCEPTION 'Offer identity is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.offer_contract_version IS NULL AND NEW.catalog_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.offer_contract_version IS DISTINCT FROM 'monthly_first_v1' OR NEW.catalog_version IS DISTINCT FROM 'monthly_inr_2026_10_v1' THEN
   RAISE EXCEPTION 'Unknown monthly identity' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
   PERFORM private.require_platform_admin();
   IF NOT EXISTS(SELECT 1 FROM private.subscription_monthly_offer_sets ms
    WHERE ms.offer_set_id::TEXT=current_setting('app.subscription_monthly_prepare',TRUE)
     AND ms.organization_id=NEW.organization_id AND ms.merchant_id=NEW.merchant_id AND ms.revoked_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM private.subscription_monthly_catalog c WHERE c.contract_version=NEW.offer_contract_version
     AND c.catalog_version=NEW.catalog_version AND c.tier=NEW.tier AND c.amount_minor=NEW.amount_minor AND c.currency=NEW.currency) THEN
    RAISE EXCEPTION 'Reviewed monthly approval required' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
 END IF;

 IF TG_OP='UPDATE' AND (ref->>'monthly_offer_id' IS DISTINCT FROM to_jsonb(OLD)->>'monthly_offer_id'
  OR ref->>'offer_contract_version' IS DISTINCT FROM to_jsonb(OLD)->>'offer_contract_version'
  OR ref->>'catalog_version' IS DISTINCT FROM to_jsonb(OLD)->>'catalog_version') THEN
  RAISE EXCEPTION 'Monthly attachment is immutable' USING ERRCODE='55000'; END IF;
 IF ref->>'monthly_offer_id' IS NULL THEN
  IF ref->>'offer_contract_version' IS NOT NULL OR ref->>'catalog_version' IS NOT NULL OR EXISTS(
   SELECT 1 FROM private.subscription_live_offer_approvals a WHERE a.approval_id=(ref->>'offer_approval_id')::UUID
    AND (a.offer_contract_version IS NOT NULL OR a.catalog_version IS NOT NULL)) THEN
   RAISE EXCEPTION 'Monthly approval cannot use original owner authority' USING ERRCODE='55000'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO o FROM private.subscription_monthly_offers WHERE monthly_offer_id=(ref->>'monthly_offer_id')::UUID;
 SELECT * INTO s FROM private.subscription_monthly_offer_sets WHERE offer_set_id=o.offer_set_id;
 IF o.monthly_offer_id IS NULL OR o.organization_id IS DISTINCT FROM (ref->>'organization_id')::UUID
  OR o.billing_account_id IS DISTINCT FROM (ref->>'billing_account_id')::UUID
  OR o.merchant_id IS DISTINCT FROM ref->>'merchant_id' OR o.approval_id IS DISTINCT FROM (ref->>'offer_approval_id')::UUID THEN
  RAISE EXCEPTION 'Exact frozen monthly attachment required' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='subscription_live_quotes' THEN
  IF ref->>'offer_contract_version' IS DISTINCT FROM o.contract_version OR ref->>'catalog_version' IS DISTINCT FROM o.catalog_version
   OR NEW.tier IS DISTINCT FROM o.tier OR NEW.amount_minor IS DISTINCT FROM o.amount_minor OR NEW.currency IS DISTINCT FROM o.currency
   OR NEW.requested_by IS DISTINCT FROM s.owner_user_id OR NEW.source_access_mode IS DISTINCT FROM 'trial'
   OR NEW.source_access_version IS DISTINCT FROM s.source_access_version OR NEW.complimentary_conversion_accepted
   OR NEW.renewal_of_request_id IS NOT NULL OR NEW.renewal_release_id IS NOT NULL
   OR NEW.term_policy IS DISTINCT FROM 'calendar_month_from_capture_event' OR NEW.provider_mode IS DISTINCT FROM 'live'
   OR NEW.expires_at IS DISTINCT FROM NEW.owner_reviewed_at+interval '1800 seconds'
   OR NOT isfinite(NEW.owner_reviewed_at) OR NEW.owner_reviewed_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r WHERE r.review_id=NEW.customer_review_id
    AND r.monthly_offer_id=o.monthly_offer_id AND r.reviewed_by=NEW.requested_by AND r.reviewed_at<=NEW.owner_reviewed_at)
   OR NOT EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals a WHERE a.approval_id=o.approval_id
    AND a.offer_reference=NEW.offer_reference AND a.tax_decision_reference=NEW.tax_decision_reference) THEN
   RAISE EXCEPTION 'Monthly quote identity changed' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' AND (current_setting('app.subscription_monthly_quote',TRUE) IS DISTINCT FROM NEW.request_id::TEXT
   OR NOT private.subscription_monthly_current(o.monthly_offer_id,NEW.requested_by)
   OR NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes c WHERE c.review_id=NEW.customer_review_id
    AND c.quotes_enabled AND c.orders_enabled)) THEN
   RAISE EXCEPTION 'Monthly quote authority required' USING ERRCODE='55000'; END IF;
 ELSE
  FOREACH k IN ARRAY ARRAY['release_sha','migration_manifest_sha256','authorization_reference','buyer_geography_reference',
   'issuer_financial_year_reference','tax_receipt_review_reference','provider_acceptance_reference','backup_recovery_reference','reminder_policy_version'] LOOP
   IF ref->>k IS DISTINCT FROM to_jsonb(s)->>k THEN
    RAISE EXCEPTION 'Monthly copied review evidence changed' USING ERRCODE='55000'; END IF;
  END LOOP;
  IF (ref->>'reviewed_at')::TIMESTAMPTZ<s.prepared_at OR (ref->>'reviewed_at')::TIMESTAMPTZ>clock_timestamp() THEN
   RAISE EXCEPTION 'Monthly review time is invalid' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='subscription_live_customer_preparations' THEN
   IF NEW.reviewed_by IS DISTINCT FROM s.operator_user_id THEN
    RAISE EXCEPTION 'Monthly operator identity changed' USING ERRCODE='55000'; END IF;
   IF TG_OP='INSERT' AND (NEW.opening_enabled OR NEW.opened_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Monthly preparation starts closed' USING ERRCODE='55000'; END IF;
   IF TG_OP='UPDATE' AND ((OLD.opened_at IS NOT NULL AND NEW.opened_at IS DISTINCT FROM OLD.opened_at)
    OR (NEW.opening_enabled AND NOT OLD.opening_enabled AND (OLD.opened_at IS NOT NULL
     OR current_setting('app.subscription_monthly_opening',TRUE) IS DISTINCT FROM s.offer_set_id::TEXT))) THEN
    RAISE EXCEPTION 'Monthly preparation opening is one-way' USING ERRCODE='55000'; END IF;
  END IF;
  IF TG_OP='INSERT' AND (current_setting('app.subscription_monthly_owner_review',TRUE) IS DISTINCT FROM (ref->>'review_id')
    OR NOT private.subscription_monthly_current(o.monthly_offer_id,s.owner_user_id)) THEN
   RAISE EXCEPTION 'Monthly authenticated owner writer required' USING ERRCODE='55000'; END IF;
  IF ref->>'commercial_context' IS DISTINCT FROM 'customer_sale'
   OR (TG_TABLE_NAME='subscription_live_customer_reviews' AND ref->>'reviewed_by' IS DISTINCT FROM s.owner_user_id::TEXT)
   OR (TG_TABLE_NAME='subscription_live_customer_preparations' AND (ref->>'owner_user_id' IS DISTINCT FROM s.owner_user_id::TEXT
    OR ref->>'source_access_version' IS DISTINCT FROM s.source_access_version::TEXT)) THEN
   RAISE EXCEPTION 'Monthly authored owner changed' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (ref-ARRAY['opening_enabled','opened_at','revoked_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['opening_enabled','opened_at','revoked_at']) THEN
   RAISE EXCEPTION 'Monthly review is immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)->>'revoked_at' IS NOT NULL AND ref->>'revoked_at' IS DISTINCT FROM to_jsonb(OLD)->>'revoked_at' THEN
   RAISE EXCEPTION 'Monthly review revocation is permanent' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscription_guard_customer_preparation ON private.subscription_live_customer_preparations;
DROP TRIGGER IF EXISTS subscription_guard_customer_preparation_insert ON private.subscription_live_customer_preparations;
CREATE TRIGGER subscription_guard_customer_preparation_insert BEFORE INSERT ON private.subscription_live_customer_preparations FOR EACH ROW WHEN (NEW.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_customer_preparation();
DROP TRIGGER IF EXISTS subscription_guard_customer_preparation_update ON private.subscription_live_customer_preparations;
CREATE TRIGGER subscription_guard_customer_preparation_update BEFORE UPDATE ON private.subscription_live_customer_preparations FOR EACH ROW WHEN (NEW.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_customer_preparation();
DROP TRIGGER IF EXISTS subscription_guard_customer_preparation_delete ON private.subscription_live_customer_preparations;
CREATE TRIGGER subscription_guard_customer_preparation_delete BEFORE DELETE ON private.subscription_live_customer_preparations FOR EACH ROW WHEN (OLD.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_customer_preparation();
DROP TRIGGER IF EXISTS subscription_guard_customer_review ON private.subscription_live_customer_reviews;
DROP TRIGGER IF EXISTS subscription_guard_customer_review_insert ON private.subscription_live_customer_reviews;
CREATE TRIGGER subscription_guard_customer_review_insert BEFORE INSERT ON private.subscription_live_customer_reviews FOR EACH ROW WHEN (NEW.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_customer_review();
DROP TRIGGER IF EXISTS subscription_guard_customer_review_update ON private.subscription_live_customer_reviews;
CREATE TRIGGER subscription_guard_customer_review_update BEFORE UPDATE ON private.subscription_live_customer_reviews FOR EACH ROW WHEN (NEW.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_customer_review();
DROP TRIGGER IF EXISTS subscription_guard_customer_review_delete ON private.subscription_live_customer_reviews;
CREATE TRIGGER subscription_guard_customer_review_delete BEFORE DELETE ON private.subscription_live_customer_reviews FOR EACH ROW WHEN (OLD.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_customer_review();
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_quote ON private.subscription_live_quotes;
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_quote_insert ON private.subscription_live_quotes;
CREATE TRIGGER subscription_guard_starter_pilot_quote_insert BEFORE INSERT ON private.subscription_live_quotes FOR EACH ROW WHEN (NEW.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_starter_pilot_quote();
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_quote_update ON private.subscription_live_quotes;
CREATE TRIGGER subscription_guard_starter_pilot_quote_update BEFORE UPDATE ON private.subscription_live_quotes FOR EACH ROW WHEN (NEW.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_starter_pilot_quote();
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_quote_delete ON private.subscription_live_quotes;
CREATE TRIGGER subscription_guard_starter_pilot_quote_delete BEFORE DELETE ON private.subscription_live_quotes FOR EACH ROW WHEN (OLD.monthly_offer_id IS NULL) EXECUTE FUNCTION private.subscription_guard_starter_pilot_quote();
-- Existing quote guard was INSERT-only; immutable economics handles updates/deletes.
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_quote_update ON private.subscription_live_quotes;
DROP TRIGGER IF EXISTS subscription_guard_starter_pilot_quote_delete ON private.subscription_live_quotes;

CREATE OR REPLACE FUNCTION public.platform_admin_authorize_monthly_opening(
 p_offer_set_id UUID,p_expected_snapshot TEXT,p_opening_review_reference TEXT,p_opening_reviewed BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_monthly_offer_sets; c JSONB;
BEGIN
 PERFORM private.require_platform_admin();
 IF p_opening_reviewed IS DISTINCT FROM TRUE OR length(btrim(p_opening_review_reference)) NOT BETWEEN 1 AND 2000
  OR p_opening_review_reference IS NULL THEN RAISE EXCEPTION 'Separate opening review required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM private.subscription_monthly_offer_sets WHERE offer_set_id=p_offer_set_id;
 PERFORM private.subscription_monthly_lock_sources(s.organization_id);
 SELECT * INTO s FROM private.subscription_monthly_offer_sets WHERE offer_set_id=p_offer_set_id FOR UPDATE;
 c:=private.subscription_monthly_source_context(s.organization_id,s.billing_account_id);
 IF s.revoked_at IS NOT NULL OR NOT s.owner_review_enabled OR s.opened_at IS NOT NULL
  OR s.opening_authorized_at IS NOT NULL OR s.source_snapshot IS DISTINCT FROM p_expected_snapshot
  OR s.source_snapshot IS DISTINCT FROM c->>'snapshot_token' OR c->'missing_facts'<>'[]'::JSONB
  OR NOT EXISTS(SELECT 1 FROM private.subscription_billing_settings WHERE singleton AND capabilities_enabled)
  OR EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations p WHERE p.organization_id=s.organization_id
    AND (p.monthly_offer_id IS NULL OR NOT EXISTS(SELECT 1 FROM private.subscription_monthly_offers o
      WHERE o.monthly_offer_id=p.monthly_offer_id AND o.offer_set_id=s.offer_set_id))) THEN
  RAISE EXCEPTION 'Current unopened monthly source and capability review required' USING ERRCODE='55000'; END IF;
 PERFORM set_config('app.subscription_monthly_opening',s.offer_set_id::TEXT,TRUE);
 UPDATE private.subscription_monthly_offer_sets SET opening_enabled=TRUE,opening_authorized_at=clock_timestamp(),
  opening_authorized_by=auth.uid(),opening_review_reference=btrim(p_opening_review_reference) WHERE offer_set_id=s.offer_set_id;
 INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation,details)
 VALUES(s.organization_id,s.billing_account_id,auth.uid(),'subscription.monthly_opening_authorized',jsonb_build_object('offer_set_id',s.offer_set_id));
 RETURN jsonb_build_object('offer_set_id',s.offer_set_id,'opening_enabled',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_approve_monthly_review(
 p_offer_set_id UUID,p_offer_id UUID,p_seen_amount_minor BIGINT,p_terms_accepted BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_monthly_offer_sets; o private.subscription_monthly_offers;
 p private.subscription_live_customer_preparations; v_review UUID:=gen_random_uuid(); v_now TIMESTAMPTZ:=clock_timestamp();
BEGIN
 SELECT * INTO s FROM private.subscription_monthly_offer_sets WHERE offer_set_id=p_offer_set_id;
 IF auth.uid() IS NULL OR s.owner_user_id IS DISTINCT FROM auth.uid() OR NOT public.is_organization_owner(s.organization_id) THEN
  RAISE EXCEPTION 'Prepared organization owner required' USING ERRCODE='42501'; END IF;
 PERFORM private.subscription_monthly_lock_sources(s.organization_id);
 SELECT * INTO o FROM private.subscription_monthly_offers WHERE monthly_offer_id=p_offer_id AND offer_set_id=s.offer_set_id;
 IF o.monthly_offer_id IS NULL OR p_seen_amount_minor IS DISTINCT FROM o.amount_minor OR p_terms_accepted IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Selected offer acknowledgement required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM private.subscription_live_customer_preparations WHERE organization_id=s.organization_id AND revoked_at IS NULL;
 IF FOUND THEN
  IF p.monthly_offer_id IS DISTINCT FROM o.monthly_offer_id OR p.owner_user_id IS DISTINCT FROM auth.uid()
    OR NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r WHERE r.review_id=p.review_id
      AND r.reviewed_by=auth.uid() AND r.revoked_at IS NULL AND r.monthly_offer_id=o.monthly_offer_id) THEN
   RAISE EXCEPTION 'Selected offer is already frozen' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('review_id',p.review_id,'organization_id',s.organization_id,'billing_account_id',s.billing_account_id,'monthly_offer_id',o.monthly_offer_id);
 END IF;
 IF NOT private.subscription_monthly_current(o.monthly_offer_id,auth.uid()) OR EXISTS(
  SELECT 1 FROM private.subscription_live_quotes WHERE organization_id=s.organization_id) THEN
  RAISE EXCEPTION 'Monthly source or branch allowance changed' USING ERRCODE='55000'; END IF;
 PERFORM set_config('app.subscription_monthly_owner_review',v_review::TEXT,TRUE);
 INSERT INTO private.subscription_live_customer_preparations
  (review_id,offer_approval_id,organization_id,billing_account_id,merchant_id,commercial_context,reviewed_by,
   release_sha,migration_manifest_sha256,authorization_reference,buyer_geography_reference,issuer_financial_year_reference,
   tax_receipt_review_reference,provider_acceptance_reference,backup_recovery_reference,reminder_policy_version,reviewed_at,
   owner_user_id,source_access_version,opening_enabled,monthly_offer_id)
 VALUES(v_review,o.approval_id,s.organization_id,s.billing_account_id,s.merchant_id,'customer_sale',s.operator_user_id,
  s.release_sha,s.migration_manifest_sha256,s.authorization_reference,s.buyer_geography_reference,s.issuer_financial_year_reference,
  s.tax_receipt_review_reference,s.provider_acceptance_reference,s.backup_recovery_reference,s.reminder_policy_version,v_now,
  s.owner_user_id,s.source_access_version,FALSE,o.monthly_offer_id);
 INSERT INTO private.subscription_live_customer_reviews
  (review_id,offer_approval_id,organization_id,billing_account_id,merchant_id,commercial_context,reviewed_by,
   release_sha,migration_manifest_sha256,authorization_reference,buyer_geography_reference,issuer_financial_year_reference,
   tax_receipt_review_reference,provider_acceptance_reference,backup_recovery_reference,reminder_policy_version,reviewed_at,monthly_offer_id)
 VALUES(v_review,o.approval_id,s.organization_id,s.billing_account_id,s.merchant_id,'customer_sale',auth.uid(),
  s.release_sha,s.migration_manifest_sha256,s.authorization_reference,s.buyer_geography_reference,s.issuer_financial_year_reference,
  s.tax_receipt_review_reference,s.provider_acceptance_reference,s.backup_recovery_reference,s.reminder_policy_version,v_now,o.monthly_offer_id);
 INSERT INTO private.subscription_live_customer_scopes(organization_id,merchant_id,review_id) VALUES(s.organization_id,s.merchant_id,v_review);
 INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation,details)
 VALUES(s.organization_id,s.billing_account_id,auth.uid(),'subscription.monthly_review_approved',
  jsonb_build_object('review_id',v_review,'monthly_offer_id',o.monthly_offer_id,'amount_minor',o.amount_minor,'terms_accepted',TRUE,'scope_initially_closed',TRUE));
 RETURN jsonb_build_object('review_id',v_review,'organization_id',s.organization_id,'billing_account_id',s.billing_account_id,'monthly_offer_id',o.monthly_offer_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_open_reviewed_customer_scope(p_review_id UUID,p_organization_id UUID,p_actor_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p private.subscription_live_customer_preparations; s private.subscription_monthly_offer_sets; c private.subscription_live_customer_scopes;
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM private.subscription_live_customer_preparations WHERE review_id=p_review_id;
 IF p.monthly_offer_id IS NULL THEN RETURN private.subscription_open_reviewed_customer_scope_before_monthly(p_review_id,p_organization_id,p_actor_user_id); END IF;
 PERFORM private.subscription_monthly_lock_sources(p.organization_id);
 SELECT s1.* INTO s FROM private.subscription_monthly_offer_sets s1 JOIN private.subscription_monthly_offers o USING(offer_set_id) WHERE o.monthly_offer_id=p.monthly_offer_id;
 SELECT * INTO c FROM private.subscription_live_customer_scopes WHERE organization_id=p.organization_id FOR UPDATE;
 IF p.organization_id IS DISTINCT FROM p_organization_id OR p.owner_user_id IS DISTINCT FROM p_actor_user_id
  OR c.review_id IS DISTINCT FROM p.review_id OR p.revoked_at IS NOT NULL
  OR NOT private.subscription_monthly_current(p.monthly_offer_id,p_actor_user_id)
  OR NOT private.subscription_customer_review_active(p.organization_id,p.review_id) THEN
  RAISE EXCEPTION 'Reviewed monthly opening required' USING ERRCODE='55000'; END IF;
 IF s.opened_at IS NOT NULL THEN
  IF NOT c.quotes_enabled OR NOT c.orders_enabled OR NOT p.opening_enabled THEN
   RAISE EXCEPTION 'Monthly checkout was contained' USING ERRCODE='55000'; END IF;
 ELSE
  IF NOT s.opening_enabled OR s.opening_authorized_at IS NULL OR c.quotes_enabled OR c.orders_enabled OR c.refunds_enabled THEN
   RAISE EXCEPTION 'Separately authorized closed scope required' USING ERRCODE='55000'; END IF;
  PERFORM set_config('app.subscription_monthly_opening',s.offer_set_id::TEXT,TRUE);
  UPDATE private.subscription_monthly_offer_sets SET opening_enabled=FALSE,opened_at=clock_timestamp() WHERE offer_set_id=s.offer_set_id;
  UPDATE private.subscription_live_customer_preparations SET opening_enabled=TRUE,opened_at=clock_timestamp() WHERE review_id=p.review_id;
  UPDATE private.subscription_live_customer_scopes SET quotes_enabled=TRUE,orders_enabled=TRUE WHERE organization_id=p.organization_id;
 END IF;
 RETURN jsonb_build_object('review_id',p.review_id,'organization_id',p.organization_id,'checkout_open',TRUE,'monthly_offer_id',p.monthly_offer_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_create_monthly_quote(
 p_request_id UUID,p_organization_id UUID,p_billing_account_id UUID,p_actor_user_id UUID,
 p_review_id UUID,p_offer_id UUID,p_seen_amount_minor BIGINT,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.subscription_monthly_offers; a private.subscription_live_offer_approvals;
 s private.subscription_live_settings; q private.subscription_live_quotes; v_now TIMESTAMPTZ:=clock_timestamp();
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 PERFORM private.subscription_monthly_lock_sources(p_organization_id);
 SELECT * INTO o FROM private.subscription_monthly_offers WHERE monthly_offer_id=p_offer_id;
 SELECT * INTO a FROM private.subscription_live_offer_approvals WHERE approval_id=o.approval_id;
 SELECT * INTO s FROM private.subscription_live_settings_for_org(p_organization_id);
 IF o.organization_id IS DISTINCT FROM p_organization_id OR o.billing_account_id IS DISTINCT FROM p_billing_account_id
  OR o.amount_minor IS DISTINCT FROM p_seen_amount_minor OR o.merchant_id IS DISTINCT FROM p_provider_merchant_id
  OR NOT coalesce(s.quotes_enabled AND s.orders_enabled,FALSE)
  OR NOT private.subscription_monthly_current(o.monthly_offer_id,p_actor_user_id)
  OR NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r WHERE r.review_id=p_review_id
    AND r.monthly_offer_id=o.monthly_offer_id AND r.reviewed_by=p_actor_user_id AND r.revoked_at IS NULL) THEN
  RAISE EXCEPTION 'Exact current monthly owner review required' USING ERRCODE='55000'; END IF;
 SELECT * INTO q FROM private.subscription_live_quotes WHERE request_id=p_request_id;
 IF FOUND THEN
  IF q.monthly_offer_id IS DISTINCT FROM p_offer_id OR q.customer_review_id IS DISTINCT FROM p_review_id
   OR q.organization_id IS DISTINCT FROM p_organization_id OR q.requested_by IS DISTINCT FROM p_actor_user_id
   OR q.billing_account_id IS DISTINCT FROM p_billing_account_id OR q.amount_minor IS DISTINCT FROM p_seen_amount_minor
   OR q.merchant_id IS DISTINCT FROM p_provider_merchant_id OR clock_timestamp()>=q.expires_at THEN
   RAISE EXCEPTION 'Monthly request identity changed or expired' USING ERRCODE='23505'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM private.subscription_live_orders WHERE organization_id=p_organization_id)
   OR EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id=p_organization_id AND expires_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'Existing monthly quote or order needs review' USING ERRCODE='55000'; END IF;
  PERFORM set_config('app.subscription_live_quote_writer','true',TRUE);
  PERFORM set_config('app.subscription_monthly_quote',p_request_id::TEXT,TRUE);
  INSERT INTO private.subscription_live_quotes(request_id,organization_id,requested_by,billing_account_id,merchant_id,tier,amount_minor,currency,
   term_policy,offer_reference,tax_decision_reference,expires_at,owner_reviewed_at,created_at,offer_approval_id,
   source_access_mode,source_access_version,customer_review_id,monthly_offer_id,offer_contract_version,catalog_version)
  SELECT p_request_id,p_organization_id,p_actor_user_id,p_billing_account_id,o.merchant_id,o.tier,o.amount_minor,o.currency,
   a.term_policy,a.offer_reference,a.tax_decision_reference,v_now+interval '1800 seconds',v_now,v_now,a.approval_id,
   'trial',ms.source_access_version,p_review_id,o.monthly_offer_id,o.contract_version,o.catalog_version
  FROM private.subscription_monthly_offer_sets ms WHERE ms.offer_set_id=o.offer_set_id RETURNING * INTO q;
 END IF;
 RETURN jsonb_build_object('request_id',q.request_id,'organization_id',q.organization_id,'tier',q.tier,'amount_minor',q.amount_minor,
  'currency',q.currency,'expires_at',q.expires_at,'approval_id',q.offer_approval_id,'monthly_offer_id',q.monthly_offer_id,
  'offer_contract_version',q.offer_contract_version,'catalog_version',q.catalog_version,'included_branches',o.included_branches,'paid_extra_branch_slots',0);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_archive_monthly_branches(p_offer_set_id UUID,p_account_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.subscription_monthly_offer_sets; c JSONB; v_count INTEGER;
BEGIN
 SELECT * INTO s FROM private.subscription_monthly_offer_sets WHERE offer_set_id=p_offer_set_id;
 IF auth.uid() IS NULL OR s.owner_user_id IS DISTINCT FROM auth.uid() OR NOT public.is_organization_owner(s.organization_id) THEN
  RAISE EXCEPTION 'Prepared organization owner required' USING ERRCODE='42501'; END IF;
 PERFORM private.subscription_monthly_lock_sources(s.organization_id);
 c:=private.subscription_monthly_source_context(s.organization_id,s.billing_account_id);
 IF s.revoked_at IS NOT NULL OR s.source_snapshot IS DISTINCT FROM c->>'snapshot_token'
  OR c->'missing_facts'<>'[]'::JSONB OR (c->'access'->>'trial_ends_at')::TIMESTAMPTZ>clock_timestamp()
  OR EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations WHERE organization_id=s.organization_id) THEN
  RAISE EXCEPTION 'Fresh unselected monthly set required' USING ERRCODE='55000'; END IF;
 IF p_account_ids IS NULL OR cardinality(p_account_ids)<1 OR array_position(p_account_ids,NULL) IS NOT NULL
  OR cardinality(p_account_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_account_ids) id)
  OR s.billing_account_id=ANY(p_account_ids) OR cardinality(p_account_ids)>=cardinality(s.active_account_ids)
  OR NOT p_account_ids<@s.active_account_ids THEN
  RAISE EXCEPTION 'Exact distinct nonbilling active branches required' USING ERRCODE='22023'; END IF;
 UPDATE public.accounts SET branch_status='archived',readiness_state='attention',archived_at=clock_timestamp()
  WHERE organization_id=s.organization_id AND branch_status='active' AND id=ANY(p_account_ids);
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>cardinality(p_account_ids) THEN RAISE EXCEPTION 'Branch roster changed' USING ERRCODE='40001'; END IF;
 UPDATE private.organization_product_access SET version=version+1,updated_at=now() WHERE organization_id=s.organization_id;
 UPDATE private.subscription_monthly_offer_sets SET revoked_at=clock_timestamp() WHERE offer_set_id=s.offer_set_id;
 UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp() WHERE approval_id IN
  (SELECT approval_id FROM private.subscription_monthly_offers WHERE offer_set_id=s.offer_set_id);
 INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation,details)
 VALUES(s.organization_id,s.billing_account_id,auth.uid(),'subscription.monthly_branches_archived',
  jsonb_build_object('offer_set_id',s.offer_set_id,'account_ids',p_account_ids,'requires_new_preparation',TRUE));
 RETURN jsonb_build_object('archived_account_ids',p_account_ids,'requires_new_preparation',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_monthly_quote_identity(p_request_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('monthly_offer_id',q.monthly_offer_id,'offer_contract_version',q.offer_contract_version,
  'catalog_version',q.catalog_version,'tier',q.tier,'included_branches',o.included_branches,'paid_extra_branch_slots',o.paid_extra_branch_slots)
 FROM private.subscription_live_quotes q JOIN private.subscription_monthly_offers o ON o.monthly_offer_id=q.monthly_offer_id
 WHERE q.request_id=p_request_id;
$$;

CREATE OR REPLACE FUNCTION public.subscription_claim_live_order(p_request_id UUID,p_organization_id UUID,p_actor_user_id UUID,p_provider_merchant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes; result JSONB;
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM private.subscription_live_quotes WHERE request_id=p_request_id;
 IF q.monthly_offer_id IS NOT NULL THEN
  PERFORM private.subscription_monthly_lock_sources(q.organization_id);
  IF q.organization_id IS DISTINCT FROM p_organization_id OR q.requested_by IS DISTINCT FROM p_actor_user_id
   OR q.merchant_id IS DISTINCT FROM p_provider_merchant_id
   OR NOT private.subscription_monthly_current(q.monthly_offer_id,p_actor_user_id) THEN
   RAISE EXCEPTION 'Monthly claim source changed' USING ERRCODE='55000'; END IF;
 END IF;
 result:=private.subscription_claim_live_order_before_monthly(p_request_id,p_organization_id,p_actor_user_id,p_provider_merchant_id);
 RETURN result||coalesce(private.subscription_monthly_quote_identity(p_request_id),'{}'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_bind_live_order(p_request_id UUID,p_provider_order_id TEXT,p_provider_merchant_id TEXT,p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Bind a known provider obligation even during containment. A subsequent claim
 -- rechecks initiation before Checkout; signed capture remains recoverable.
 RETURN private.subscription_bind_live_order_before_monthly(p_request_id,p_provider_order_id,p_provider_merchant_id,p_pilot_organization_id)
  ||coalesce(private.subscription_monthly_quote_identity(p_request_id),'{}'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_create_live_quote(
 p_request_id UUID,p_organization_id UUID,p_billing_account_id UUID,p_actor_user_id UUID,p_approval_id UUID,
 p_seen_amount_minor BIGINT,p_tier TEXT,p_provider_merchant_id TEXT,p_complimentary_conversion_accepted BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals WHERE approval_id=p_approval_id
  AND (offer_contract_version IS NOT NULL OR catalog_version IS NOT NULL)) THEN
  RAISE EXCEPTION 'Monthly offer requires its versioned quote writer' USING ERRCODE='55000'; END IF;
 RETURN private.subscription_create_live_quote_before_monthly(p_request_id,p_organization_id,p_billing_account_id,p_actor_user_id,
  p_approval_id,p_seen_amount_minor,p_tier,p_provider_merchant_id,p_complimentary_conversion_accepted);
END;
$$;

CREATE OR REPLACE FUNCTION public.subscription_commit_live_initial_payment(
 p_request_id UUID,p_provider_order_id TEXT,p_provider_payment_id TEXT,p_provider_merchant_id TEXT,
 p_amount_minor BIGINT,p_currency TEXT,p_capture_event_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q private.subscription_live_quotes; p private.subscription_live_payments; o private.subscription_live_orders;
 reason TEXT; result JSONB;
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM private.subscription_live_quotes WHERE request_id=p_request_id;
 IF q.monthly_offer_id IS NULL THEN
  RETURN private.subscription_commit_live_initial_payment_before_monthly(p_request_id,p_provider_order_id,p_provider_payment_id,
   p_provider_merchant_id,p_amount_minor,p_currency,p_capture_event_at);
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=q.organization_id FOR UPDATE;
 SELECT * INTO o FROM private.subscription_live_orders WHERE request_id=p_request_id FOR UPDATE;
 IF q.merchant_id IS DISTINCT FROM p_provider_merchant_id OR o.provider_order_id IS DISTINCT FROM p_provider_order_id
  OR o.request_id IS NULL OR p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^pay_[A-Za-z0-9]+$'
  OR p_amount_minor IS NULL OR p_amount_minor<=0 OR p_currency IS DISTINCT FROM 'INR'
  OR p_capture_event_at IS NULL OR NOT isfinite(p_capture_event_at) OR p_capture_event_at>now()+interval '5 minutes'
  OR NOT EXISTS(SELECT 1 FROM private.subscription_live_webhook_events e WHERE e.request_id=p_request_id
   AND e.organization_id=q.organization_id AND e.merchant_id=p_provider_merchant_id AND e.event_type='payment.captured'
   AND e.provider_order_id=p_provider_order_id AND e.provider_payment_id=p_provider_payment_id AND e.provider_event_at=p_capture_event_at) THEN
  RAISE EXCEPTION 'Exact signed monthly capture identity required' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM private.subscription_live_payments WHERE request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  -- No mutable owner/access/commercial check precedes identical committed replay,
  -- including after a full confirmed refund or containment.
  IF p.provider_payment_id=p_provider_payment_id AND p.provider_order_id=p_provider_order_id
   AND p.merchant_id=p_provider_merchant_id AND p.amount_minor=p_amount_minor AND p.currency=p_currency
   AND p.capture_event_at=p_capture_event_at THEN
   RETURN jsonb_build_object('status',p.state,'reason',p.hold_reason,'organization_id',q.organization_id,
    'request_id',q.request_id,'provider_payment_id',p.provider_payment_id)||private.subscription_monthly_quote_identity(q.request_id);
  END IF;
  PERFORM private.subscription_record_live_recovery_exception('payment',q.request_id,q.organization_id,q.merchant_id,'monthly_capture_conflict');
  RETURN jsonb_build_object('status','review_required','reason','monthly_capture_conflict','request_id',q.request_id,'organization_id',q.organization_id);
 END IF;
 PERFORM private.subscription_monthly_lock_sources(q.organization_id);
 IF NOT EXISTS(SELECT 1 FROM private.subscription_live_settings WHERE singleton AND merchant_id=q.merchant_id AND settlements_enabled AND webhook_intake_enabled) THEN
  reason:='monthly_settlement_readiness_changed';
 ELSIF p_amount_minor IS DISTINCT FROM q.amount_minor THEN reason:='monthly_capture_amount_changed';
 ELSIF NOT private.subscription_monthly_current(q.monthly_offer_id,q.requested_by) THEN reason:='monthly_source_changed';
 END IF;
 IF reason IS NOT NULL THEN
  INSERT INTO private.subscription_live_payments(provider_payment_id,request_id,organization_id,merchant_id,provider_order_id,
   amount_minor,currency,state,capture_event_at,hold_reason)
  VALUES(p_provider_payment_id,p_request_id,q.organization_id,q.merchant_id,p_provider_order_id,p_amount_minor,p_currency,'review_required',p_capture_event_at,reason);
  UPDATE private.subscription_live_orders SET state='review_required' WHERE request_id=p_request_id;
  RETURN jsonb_build_object('status','review_required','reason',reason,'request_id',q.request_id,'organization_id',q.organization_id);
 END IF;
 result:=private.subscription_commit_live_initial_payment_before_monthly(p_request_id,p_provider_order_id,p_provider_payment_id,
  p_provider_merchant_id,p_amount_minor,p_currency,p_capture_event_at);
 RETURN result||private.subscription_monthly_quote_identity(q.request_id);
END;
$$;

-- New monthly reviews cannot issue renewal releases, even for Starter.
CREATE OR REPLACE FUNCTION private.subscription_monthly_no_renewal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r WHERE r.review_id=NEW.customer_review_id AND r.monthly_offer_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Monthly first purchase has no renewal authority' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_monthly_no_renewal ON private.subscription_live_renewal_releases;
CREATE TRIGGER subscription_monthly_no_renewal BEFORE INSERT OR UPDATE ON private.subscription_live_renewal_releases
 FOR EACH ROW EXECUTE FUNCTION private.subscription_monthly_no_renewal();

-- Every new helper is private; each public entry point has its exact role only.
DO $$ DECLARE r RECORD; BEGIN
 FOR r IN SELECT p.oid::REGPROCEDURE signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND (p.proname LIKE 'subscription_monthly_%' OR p.proname LIKE '%_before_monthly') LOOP
  EXECUTE 'ALTER FUNCTION '||r.signature||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
 END LOOP;
 FOR r IN SELECT p.oid::REGPROCEDURE signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('platform_admin_authorize_monthly_opening','subscription_approve_monthly_review',
   'subscription_archive_monthly_branches','subscription_create_monthly_quote') LOOP
  EXECUTE 'ALTER FUNCTION '||r.signature||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||r.signature||' TO '||CASE WHEN r.proname='subscription_create_monthly_quote' THEN 'service_role' ELSE 'authenticated' END;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.subscription_resolve_live_scope(
 p_provider_merchant_id TEXT,p_request_id UUID DEFAULT NULL,p_provider_order_id TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB; q private.subscription_live_quotes;
BEGIN
 result:=private.subscription_resolve_live_scope_before_monthly(p_provider_merchant_id,p_request_id,p_provider_order_id);
 SELECT * INTO q FROM private.subscription_live_quotes WHERE request_id=(result->>'request_id')::UUID;
 IF q.monthly_offer_id IS NOT NULL THEN
  RETURN result||private.subscription_monthly_quote_identity(q.request_id);
 END IF;
 IF q.offer_contract_version IS NOT NULL OR q.catalog_version IS NOT NULL THEN
  RAISE EXCEPTION 'Incomplete provider contract identity' USING ERRCODE='55000'; END IF;
 -- Project the original identity without changing any historical row. Its exact
 -- Starter economics are still checked by the adapter, including renewals.
 RETURN result||jsonb_build_object('offer_contract_version','starter_v1','catalog_version',NULL,
  'monthly_offer_id',NULL,'tier',q.tier,'included_branches',1,'paid_extra_branch_slots',0);
END;
$$;
CREATE OR REPLACE FUNCTION public.subscription_live_order_for_capture(p_provider_order_id TEXT,p_provider_merchant_id TEXT,p_pilot_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB;
BEGIN
 result:=private.subscription_live_order_for_capture_before_monthly(p_provider_order_id,p_provider_merchant_id,p_pilot_organization_id);
 RETURN result||coalesce(private.subscription_monthly_quote_identity((result->>'request_id')::UUID),'{}'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION private.subscription_monthly_preserve_attachment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Monthly owner review history is immutable' USING ERRCODE='55000';
END;
$$;
ALTER FUNCTION private.subscription_monthly_preserve_attachment() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_monthly_preserve_attachment() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS subscription_monthly_preserve_attachment ON private.subscription_live_customer_preparations;
CREATE TRIGGER subscription_monthly_preserve_attachment BEFORE DELETE ON private.subscription_live_customer_preparations
 FOR EACH ROW WHEN (OLD.monthly_offer_id IS NOT NULL) EXECUTE FUNCTION private.subscription_monthly_preserve_attachment();
DROP TRIGGER IF EXISTS subscription_monthly_preserve_attachment ON private.subscription_live_customer_reviews;
CREATE TRIGGER subscription_monthly_preserve_attachment BEFORE DELETE ON private.subscription_live_customer_reviews
 FOR EACH ROW WHEN (OLD.monthly_offer_id IS NOT NULL) EXECUTE FUNCTION private.subscription_monthly_preserve_attachment();

CREATE OR REPLACE FUNCTION public.subscription_live_owner_quote(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB;
BEGIN
 result:=private.subscription_live_owner_quote_before_monthly(p_organization_id);
 IF result IS NULL THEN RETURN NULL; END IF;
 RETURN result||coalesce(private.subscription_monthly_quote_identity((result->>'request_id')::UUID),'{}'::JSONB);
END;
$$;

-- Durable recovery never consults monthly initiation/UI switches. Preserve the
-- original five-item leased scanner and add monthly identity via request/quote.
CREATE OR REPLACE FUNCTION public.subscription_claim_live_recovery_items(
 p_provider_merchant_id TEXT,p_pilot_organization_id UUID,p_limit INTEGER DEFAULT 5,
 p_lease_token UUID DEFAULT gen_random_uuid())
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB; item JSONB; projected JSONB:='[]'::JSONB;
BEGIN
 result:=private.subscription_claim_live_recovery_items_before_monthly(p_provider_merchant_id,p_pilot_organization_id,p_limit,p_lease_token);
 FOR item IN SELECT value FROM jsonb_array_elements(result) LOOP
  projected:=projected||jsonb_build_array(item||coalesce(
   private.subscription_monthly_quote_identity((item->>'request_id')::UUID),'{}'::JSONB));
 END LOOP;
 RETURN projected;
END;
$$;
ALTER FUNCTION public.subscription_claim_live_recovery_items(TEXT,UUID,INTEGER,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.subscription_claim_live_recovery_items(TEXT,UUID,INTEGER,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.subscription_claim_live_recovery_items(TEXT,UUID,INTEGER,UUID) TO service_role;
