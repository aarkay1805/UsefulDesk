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
 IF TG_TABLE_NAME='subscription_monthly_offers' OR
  (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR
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
