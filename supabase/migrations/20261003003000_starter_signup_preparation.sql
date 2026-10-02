-- Operator preparation only. Seeds no customer evidence, offer or payment gate.
-- Actual owner approval and one-time opening retain their existing boundaries.
CREATE TABLE IF NOT EXISTS private.subscription_starter_signup_work (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
 operator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
 status TEXT NOT NULL CHECK(status IN ('awaiting_facts','in_review','blocked')),
 next_action TEXT NOT NULL CHECK(length(btrim(next_action)) BETWEEN 3 AND 1000),
 evidence JSONB NOT NULL DEFAULT '{}'::JSONB CHECK(jsonb_typeof(evidence)='object'),
 reviewed_snapshot TEXT NOT NULL CHECK(reviewed_snapshot ~ '^[0-9a-f]{64}$'),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 frozen_commercial_snapshot TEXT CHECK(frozen_commercial_snapshot ~ '^[0-9a-f]{64}$'),
 preparation_id UUID UNIQUE REFERENCES private.subscription_live_customer_preparations(review_id),
 updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE private.subscription_starter_signup_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.subscription_starter_signup_work FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.subscription_starter_signup_work TO service_role;
DROP TRIGGER IF EXISTS update_starter_signup_work_updated_at ON private.subscription_starter_signup_work;
CREATE TRIGGER update_starter_signup_work_updated_at BEFORE UPDATE ON private.subscription_starter_signup_work
 FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- One bounded vocabulary shared by draft validation, completeness and freezing.
CREATE OR REPLACE FUNCTION private.subscription_starter_evidence_keys()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['authorization_reference','buyer_geography_reference','issuer_financial_year_reference',
 'tax_receipt_review_reference','provider_acceptance_reference','backup_recovery_reference',
 'refund_policy_reference','merchant_approval_reference','offer_reference','customer_tax_note',
 'customer_terms_note','release_sha','migration_manifest_sha256']::TEXT[];
$$;

-- No raw buyer address/contact data is returned. The hash detects changed facts.
-- VOLATILE intentionally refreshes reads after the writer's locks have been acquired.
CREATE OR REPLACE FUNCTION private.subscription_starter_signup_context(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x private.organization_product_access; b private.subscription_billing_settings;
 l private.subscription_live_settings; branches JSONB; owners JSONB; facts JSONB; missing TEXT[]:=ARRAY[]::TEXT[];
BEGIN
 SELECT * INTO x FROM private.organization_product_access WHERE organization_id=p_organization_id;
 SELECT * INTO b FROM private.subscription_billing_settings WHERE singleton;
 SELECT * INTO l FROM private.subscription_live_settings WHERE singleton;
 SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'verified',u.email_confirmed_at IS NOT NULL)
  ORDER BY m.user_id),'[]'::JSONB) INTO owners
 FROM public.organization_memberships m JOIN auth.users u ON u.id=m.user_id
 WHERE m.organization_id=p_organization_id AND m.role='owner';
 SELECT coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'name',a.name,'currency',a.default_currency,
  'buyer_complete',coalesce(ip.is_complete AND nullif(btrim(ip.legal_name),'') IS NOT NULL
    AND nullif(btrim(ip.email),'') IS NOT NULL AND nullif(btrim(ip.phone),'') IS NOT NULL,FALSE),
  'setup_complete',a.readiness_state='ready' AND a.setup_reviewed_at IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.membership_plans p JOIN public.plan_pricing_options price ON price.plan_id=p.id AND price.account_id=p.account_id
    WHERE p.account_id=a.id AND p.is_active AND price.is_active),
  'facts_hash',encode(extensions.digest(jsonb_build_object('account',jsonb_build_object(
     'legal_entity_id',a.legal_entity_id,'currency',a.default_currency,'readiness_state',a.readiness_state,
     'setup_reviewed_at',a.setup_reviewed_at,'setup_reviewed_by',a.setup_reviewed_by,'timezone',a.timezone),
    'legal_name',e.legal_name,'buyer',CASE WHEN ip.account_id IS NULL THEN '{}'::JSONB
      ELSE to_jsonb(ip)-ARRAY['created_at','updated_at','updated_by'] END,
    'plans',(SELECT coalesce(jsonb_agg(to_jsonb(p)-ARRAY['created_at','updated_at','updated_by'] ORDER BY p.id),'[]'::JSONB) FROM public.membership_plans p WHERE p.account_id=a.id),
    'prices',(SELECT coalesce(jsonb_agg(to_jsonb(price.*)-ARRAY['created_at','updated_at','updated_by'] ORDER BY price.id),'[]'::JSONB) FROM public.plan_pricing_options price WHERE price.account_id=a.id)
  )::TEXT,'sha256'),'hex')) ORDER BY a.id),'[]'::JSONB) INTO branches
 FROM public.accounts a LEFT JOIN public.invoice_profiles ip ON ip.account_id=a.id
 LEFT JOIN public.legal_entities e ON e.id=a.legal_entity_id
 WHERE a.organization_id=p_organization_id AND a.branch_status='active';
 IF jsonb_array_length(owners)<>1 OR owners->0->>'verified' IS DISTINCT FROM 'true' THEN missing:=array_append(missing,'verified_owner'); END IF;
 IF x.organization_id IS NULL OR x.mode<>'trial' OR x.suspended_at IS NOT NULL OR x.trial_ends_at IS NULL THEN missing:=array_append(missing,'normal_trial'); END IF;
 IF jsonb_array_length(branches)<>1 THEN missing:=array_append(missing,'one_active_branch');
 ELSE
  IF branches->0->>'currency' IS DISTINCT FROM 'INR' THEN missing:=array_append(missing,'inr_branch'); END IF;
  IF branches->0->>'buyer_complete' IS DISTINCT FROM 'true' THEN missing:=array_append(missing,'buyer_details'); END IF;
  IF branches->0->>'setup_complete' IS DISTINCT FROM 'true' THEN missing:=array_append(missing,'gym_setup'); END IF;
 END IF;
 IF l.merchant_id IS NULL OR NOT l.webhook_intake_enabled OR NOT l.settlements_enabled THEN missing:=array_append(missing,'payment_readiness'); END IF;
 IF NOT coalesce(b.standard_reminder_policy_approved,FALSE) OR b.standard_reminder_policy_version IS NULL
  OR b.standard_reminder_days_before IS DISTINCT FROM ARRAY[7,3,1]::INTEGER[] OR b.standard_reminder_hour_local IS DISTINCT FROM 9 THEN missing:=array_append(missing,'standard_reminders'); END IF;
 IF EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_orders WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants WHERE organization_id=p_organization_id)
  THEN missing:=array_append(missing,'existing_obligation'); END IF;
 facts:=jsonb_build_object('access',to_jsonb(x),'owners',owners,'branches',branches,'merchant_id',l.merchant_id,
  'reminder_policy_version',b.standard_reminder_policy_version,'missing_facts',missing);
 RETURN facts||jsonb_build_object(
  'snapshot_token',encode(extensions.digest((facts-'missing_facts')::TEXT,'sha256'),'hex'),
  'commercial_token',encode(extensions.digest((facts-ARRAY['access','missing_facts'])::TEXT,'sha256'),'hex'));
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_save_starter_signup_work(
 p_organization_id UUID,p_expected_revision INTEGER,p_expected_snapshot TEXT,p_operator_user_id UUID,
 p_status TEXT,p_next_action TEXT,p_evidence JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w private.subscription_starter_signup_work; c JSONB;
BEGIN
 PERFORM private.require_platform_admin();
 PERFORM 1 FROM public.organizations o JOIN private.subscription_starter_signup_selections s ON s.organization_id=o.id
  WHERE o.id=p_organization_id FOR UPDATE OF o;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selected gym business required' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM private.subscription_starter_signup_work WHERE organization_id=p_organization_id FOR UPDATE;
 c:=private.subscription_starter_signup_context(p_organization_id);
 IF p_expected_revision IS DISTINCT FROM coalesce(w.revision,0) OR p_expected_snapshot IS DISTINCT FROM c->>'snapshot_token' THEN
  RAISE EXCEPTION 'Preparation changed. Refresh and review the latest details.' USING ERRCODE='40001'; END IF;
 IF w.preparation_id IS NOT NULL AND p_evidence IS DISTINCT FROM w.evidence THEN
  RAISE EXCEPTION 'Frozen commercial evidence cannot be rewritten.' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=p_operator_user_id)
  OR p_status IS NULL OR p_status NOT IN ('awaiting_facts','in_review','blocked')
  OR coalesce(length(btrim(p_next_action)),0) NOT BETWEEN 3 AND 1000
  OR p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object'
  OR EXISTS(SELECT 1 FROM jsonb_each(p_evidence) v WHERE NOT v.key=ANY(private.subscription_starter_evidence_keys())
   OR jsonb_typeof(v.value)<>'string' OR length(btrim(v.value#>>'{}')) NOT BETWEEN 1 AND 2000) THEN
  RAISE EXCEPTION 'Choose a current operator, next step and actual review references.' USING ERRCODE='22023'; END IF;
 INSERT INTO private.subscription_starter_signup_work(organization_id,operator_user_id,status,next_action,evidence,reviewed_snapshot,updated_by)
 VALUES(p_organization_id,p_operator_user_id,p_status,btrim(p_next_action),p_evidence,c->>'snapshot_token',auth.uid())
 ON CONFLICT(organization_id) DO UPDATE SET operator_user_id=EXCLUDED.operator_user_id,status=EXCLUDED.status,
  next_action=EXCLUDED.next_action,evidence=EXCLUDED.evidence,reviewed_snapshot=CASE
    WHEN subscription_starter_signup_work.preparation_id IS NULL THEN EXCLUDED.reviewed_snapshot
    ELSE subscription_starter_signup_work.reviewed_snapshot END,
  revision=subscription_starter_signup_work.revision+1,updated_by=EXCLUDED.updated_by
 RETURNING * INTO w;
 INSERT INTO public.organization_audit_log(organization_id,actor_user_id,operation,details)
 VALUES(p_organization_id,auth.uid(),'subscription.starter_preparation_saved',jsonb_build_object(
  'revision',w.revision,'operator_user_id',w.operator_user_id,'status',w.status,
  'reviewed_snapshot',w.reviewed_snapshot));
 RETURN jsonb_build_object('revision',w.revision);
END;
$$;

-- Serialize new source rows (and moves into a different organization) to
-- prevent phantoms. Existing-row edits retain their ordinary row locks; they
-- must not wait on an org lock after owning a tuple needed by document issuance.
CREATE OR REPLACE FUNCTION private.subscription_serialize_starter_source_write()
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
 PERFORM 1 FROM public.organizations o JOIN private.subscription_starter_signup_selections ss ON ss.organization_id=o.id
  WHERE o.id=org FOR UPDATE OF o;
 RETURN NEW;
END;
$$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['organization_memberships','accounts','legal_entities','invoice_profiles','membership_plans','plan_pricing_options'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS subscription_serialize_starter_source_write ON public.%I',t);
  EXECUTE format('CREATE TRIGGER subscription_serialize_starter_source_write BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.subscription_serialize_starter_source_write()',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.subscription_lock_starter_preparation_sources(p_organization_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
 PERFORM 1 FROM private.organization_product_access WHERE organization_id=p_organization_id FOR SHARE NOWAIT;
 -- Locks existing rows; guarded inserts/moves above cover new source rows.
 PERFORM 1 FROM public.organization_memberships WHERE organization_id=p_organization_id FOR SHARE NOWAIT;
 PERFORM 1 FROM auth.users u JOIN public.organization_memberships m ON m.user_id=u.id
  WHERE m.organization_id=p_organization_id AND m.role='owner' FOR SHARE OF u NOWAIT;
 PERFORM 1 FROM public.accounts WHERE organization_id=p_organization_id FOR SHARE NOWAIT;
 PERFORM 1 FROM public.legal_entities WHERE organization_id=p_organization_id FOR SHARE NOWAIT;
 PERFORM 1 FROM public.invoice_profiles ip JOIN public.accounts ac ON ac.id=ip.account_id WHERE ac.organization_id=p_organization_id FOR SHARE OF ip NOWAIT;
 PERFORM 1 FROM public.membership_plans p JOIN public.accounts ac ON ac.id=p.account_id WHERE ac.organization_id=p_organization_id FOR SHARE OF p NOWAIT;
 PERFORM 1 FROM public.plan_pricing_options p JOIN public.accounts ac ON ac.id=p.account_id WHERE ac.organization_id=p_organization_id FOR SHARE OF p NOWAIT;
 PERFORM 1 FROM private.subscription_live_settings WHERE singleton FOR SHARE NOWAIT;
 PERFORM 1 FROM private.subscription_billing_settings WHERE singleton FOR SHARE NOWAIT;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Prepared facts are being edited. Refresh and try again.' USING ERRCODE='40001';
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_freeze_starter_signup_preparation(
 p_organization_id UUID,p_expected_revision INTEGER,p_confirm_reviewed BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w private.subscription_starter_signup_work; c JSONB; a UUID:=gen_random_uuid(); r UUID:=gen_random_uuid();
 v_owner UUID; v_branch UUID; v_now TIMESTAMPTZ;
BEGIN
 PERFORM private.require_platform_admin();
 IF p_confirm_reviewed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Confirm the actual operator review first' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations o JOIN private.subscription_starter_signup_selections s ON s.organization_id=o.id
  WHERE o.id=p_organization_id FOR UPDATE OF o;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selected gym business required' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM private.subscription_starter_signup_work WHERE organization_id=p_organization_id FOR UPDATE;
 IF w.preparation_id IS NOT NULL AND p_expected_revision IN (w.revision,w.revision-1) THEN
  RETURN jsonb_build_object('preparation_id',w.preparation_id,'opening_enabled',FALSE); END IF;
 IF w.organization_id IS NULL OR p_expected_revision IS DISTINCT FROM w.revision THEN
  RAISE EXCEPTION 'Preparation changed. Refresh and review the latest details.' USING ERRCODE='40001'; END IF;
 PERFORM private.subscription_lock_starter_preparation_sources(p_organization_id);
 c:=private.subscription_starter_signup_context(p_organization_id);
 IF w.reviewed_snapshot IS DISTINCT FROM c->>'snapshot_token' THEN RAISE EXCEPTION 'Preparation changed. Refresh and review the latest details.' USING ERRCODE='40001'; END IF;
 IF w.status<>'in_review' OR NOT EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=w.operator_user_id)
  OR jsonb_array_length(c->'missing_facts')<>0 OR EXISTS(SELECT 1 FROM unnest(private.subscription_starter_evidence_keys()) k
    WHERE coalesce(length(btrim(w.evidence->>k)),0) NOT BETWEEN 1 AND 2000)
  OR w.evidence->>'release_sha' !~ '^[0-9a-f]{40}$' OR w.evidence->>'migration_manifest_sha256' !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Complete the actual buyer, setup and every commercial review first.' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations WHERE organization_id=p_organization_id)
  OR EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals WHERE organization_id=p_organization_id AND revoked_at IS NULL)
  OR EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes WHERE organization_id=p_organization_id) THEN
  RAISE EXCEPTION 'Existing customer preparation needs separate operator review' USING ERRCODE='55000'; END IF;
 v_owner:=(c->'owners'->0->>'user_id')::UUID; v_branch:=(c->'branches'->0->>'account_id')::UUID; v_now:=clock_timestamp();
 INSERT INTO private.subscription_live_offer_approvals(approval_id,organization_id,merchant_id,tier,amount_minor,
  term_policy,quote_validity_seconds,offer_reference,tax_decision_reference,refund_policy_reference,merchant_approval_reference,
  customer_tax_note,customer_terms_note,approved_at)
 VALUES(a,p_organization_id,c->>'merchant_id','starter',79900,'calendar_month_from_capture_event',1800,
  w.evidence->>'offer_reference',w.evidence->>'tax_receipt_review_reference',w.evidence->>'refund_policy_reference',
  w.evidence->>'merchant_approval_reference',w.evidence->>'customer_tax_note',w.evidence->>'customer_terms_note',now());
 INSERT INTO private.subscription_live_customer_preparations(review_id,offer_approval_id,organization_id,billing_account_id,
  merchant_id,commercial_context,reviewed_by,release_sha,migration_manifest_sha256,authorization_reference,buyer_geography_reference,
  issuer_financial_year_reference,tax_receipt_review_reference,provider_acceptance_reference,backup_recovery_reference,
  reminder_policy_version,reviewed_at,owner_user_id,source_access_version,opening_enabled)
 VALUES(r,a,p_organization_id,v_branch,c->>'merchant_id','customer_sale',auth.uid(),w.evidence->>'release_sha',
  w.evidence->>'migration_manifest_sha256',w.evidence->>'authorization_reference',w.evidence->>'buyer_geography_reference',
  w.evidence->>'issuer_financial_year_reference',w.evidence->>'tax_receipt_review_reference',w.evidence->>'provider_acceptance_reference',
  w.evidence->>'backup_recovery_reference',c->>'reminder_policy_version',v_now,v_owner,(c->'access'->>'version')::INTEGER,FALSE);
 UPDATE private.subscription_starter_signup_work SET preparation_id=r,frozen_commercial_snapshot=c->>'commercial_token',
  next_action='Review the release and actual trial expiry before authorizing owner review',revision=revision+1,updated_by=auth.uid()
  WHERE organization_id=p_organization_id;
 INSERT INTO public.organization_audit_log(organization_id,account_id,actor_user_id,operation,details)
 VALUES(p_organization_id,v_branch,auth.uid(),'subscription.starter_preparation_frozen',jsonb_build_object(
  'preparation_id',r,'offer_approval_id',a,'amount_minor',79900,'opening_enabled',FALSE,'owner_review_created',FALSE,
  'operator_user_id',w.operator_user_id,'reviewed_snapshot',w.reviewed_snapshot));
 RETURN jsonb_build_object('preparation_id',r,'opening_enabled',FALSE);
END;
$$;

-- Only tracked preparations acquire this additional stale-facts boundary.
-- Existing customer/internal reviews are unchanged; containment always remains possible.
CREATE OR REPLACE FUNCTION private.subscription_starter_preparation_current(p_review_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM private.subscription_starter_signup_work WHERE preparation_id=p_review_id)
 OR EXISTS(SELECT 1 FROM private.subscription_starter_signup_work w WHERE w.preparation_id=p_review_id
  AND w.frozen_commercial_snapshot=private.subscription_starter_signup_context(w.organization_id)->>'commercial_token');
$$;
CREATE OR REPLACE FUNCTION private.subscription_guard_starter_preparation_opening()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org UUID;
BEGIN
 IF NEW.opening_enabled AND NOT OLD.opening_enabled THEN
  SELECT organization_id INTO org FROM private.subscription_starter_signup_work WHERE preparation_id=NEW.review_id;
  IF org IS NOT NULL THEN PERFORM private.subscription_lock_starter_preparation_sources(org); END IF;
 END IF;
 IF NEW.opening_enabled AND NOT OLD.opening_enabled AND (NOT private.subscription_starter_preparation_current(NEW.review_id) OR EXISTS(
  SELECT 1 FROM private.subscription_starter_signup_work w WHERE w.preparation_id=NEW.review_id
   AND w.reviewed_snapshot IS DISTINCT FROM private.subscription_starter_signup_context(w.organization_id)->>'snapshot_token')) THEN
  RAISE EXCEPTION 'Prepared customer facts changed; separate operator review required' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_starter_preparation_opening ON private.subscription_live_customer_preparations;
CREATE TRIGGER subscription_guard_starter_preparation_opening BEFORE UPDATE OF opening_enabled
 ON private.subscription_live_customer_preparations FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_starter_preparation_opening();

CREATE OR REPLACE FUNCTION private.subscription_customer_preparation_eligible(p_preparation_id UUID,p_actor UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations p
  JOIN private.subscription_live_offer_approvals a ON a.approval_id=p.offer_approval_id
  JOIN private.subscription_live_settings s ON s.singleton AND s.merchant_id=p.merchant_id
  JOIN private.subscription_billing_settings b ON b.singleton
  JOIN private.organization_product_access x ON x.organization_id=p.organization_id
  JOIN public.accounts c ON c.id=p.billing_account_id AND c.organization_id=p.organization_id
  WHERE p.review_id=p_preparation_id AND p.owner_user_id=p_actor AND p.opening_enabled
   AND p.revoked_at IS NULL AND p.reviewed_at<=clock_timestamp() AND a.revoked_at IS NULL
   AND s.webhook_intake_enabled AND s.settlements_enabled
   AND p.organization_id IS DISTINCT FROM s.pilot_organization_id
   AND c.branch_status='active' AND c.default_currency='INR'
   AND (SELECT count(*) FROM public.accounts WHERE organization_id=p.organization_id AND branch_status='active')=1
   AND EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p.organization_id
     AND m.user_id=p_actor AND m.role='owner')
   AND x.mode='trial' AND x.suspended_at IS NULL AND x.trial_ends_at<=clock_timestamp()
   AND x.version=p.source_access_version
   AND b.standard_reminder_policy_approved AND b.standard_reminder_policy_version=p.reminder_policy_version
   AND b.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND b.standard_reminder_hour_local=9
   AND private.subscription_starter_preparation_current(p.review_id)
   AND NOT EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id=p.organization_id)
   AND NOT EXISTS(SELECT 1 FROM private.subscription_live_orders WHERE organization_id=p.organization_id)
   AND NOT EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id=p.organization_id)
   AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id=p.organization_id)
   AND NOT EXISTS(SELECT 1 FROM private.organization_paid_subscription_grants WHERE organization_id=p.organization_id));
$$;

CREATE OR REPLACE FUNCTION private.subscription_customer_review_active(p_organization_id UUID,p_review_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews r
  JOIN private.subscription_live_customer_scopes c ON c.review_id=r.review_id
    AND c.organization_id=r.organization_id AND c.merchant_id=r.merchant_id
  JOIN private.subscription_live_settings s ON s.singleton AND s.merchant_id=r.merchant_id
  JOIN private.subscription_live_offer_approvals a ON a.approval_id=r.offer_approval_id
  JOIN private.subscription_billing_settings b ON b.singleton
  WHERE r.organization_id=p_organization_id AND r.review_id=p_review_id
   AND r.organization_id IS DISTINCT FROM s.pilot_organization_id
   AND private.subscription_starter_preparation_current(r.review_id)
   AND r.revoked_at IS NULL AND r.reviewed_at<=clock_timestamp()
   AND a.revoked_at IS NULL AND a.approved_at<=r.reviewed_at
   AND a.organization_id=r.organization_id AND a.merchant_id=r.merchant_id
   AND a.tier='starter' AND a.amount_minor=79900 AND a.currency='INR'
   AND a.quote_validity_seconds=1800 AND a.term_policy='calendar_month_from_capture_event'
   AND EXISTS(SELECT 1 FROM public.organization_memberships m
     WHERE m.organization_id=r.organization_id AND m.user_id=r.reviewed_by AND m.role='owner')
   AND EXISTS(SELECT 1 FROM public.accounts x WHERE x.id=r.billing_account_id
     AND x.organization_id=r.organization_id AND x.branch_status='active' AND x.default_currency='INR')
   AND b.standard_reminder_policy_approved AND b.standard_reminder_policy_version=r.reminder_policy_version
   AND b.standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[] AND b.standard_reminder_hour_local=9);
$$;

-- Recheck after locking and hold sources through the authority/financial commit.
-- A raced capture aborts retryably: its separately committed signed intake remains,
-- and the next settlement attempt records the ordinary review-required money hold.
CREATE OR REPLACE FUNCTION private.subscription_guard_tracked_preparation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review UUID; org UUID;
BEGIN
 IF TG_TABLE_NAME='subscription_live_payments' THEN
  IF NEW.state<>'verified' THEN RETURN NEW; END IF;
  SELECT customer_review_id INTO review FROM private.subscription_live_quotes WHERE request_id=NEW.request_id;
 ELSIF TG_TABLE_NAME='subscription_live_quotes' THEN review:=NEW.customer_review_id;
 ELSE
  IF TG_TABLE_NAME='subscription_live_customer_scopes' THEN
   IF NOT (NEW.quotes_enabled OR NEW.orders_enabled) THEN RETURN NEW; END IF;
  END IF;
  review:=NEW.review_id;
 END IF;
 SELECT organization_id INTO org FROM private.subscription_starter_signup_work WHERE preparation_id=review;
 IF org IS NULL THEN RETURN NEW; END IF;
 PERFORM private.subscription_lock_starter_preparation_sources(org);
 IF NOT private.subscription_starter_preparation_current(review) OR (TG_TABLE_NAME='subscription_live_customer_reviews'
  AND NOT private.subscription_customer_preparation_eligible(review,auth.uid())) THEN
  RAISE EXCEPTION 'Prepared facts changed during billing. Retry for a fresh review.' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_guard_tracked_preparation ON private.subscription_live_customer_reviews;
CREATE TRIGGER subscription_guard_tracked_preparation BEFORE INSERT ON private.subscription_live_customer_reviews
 FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_tracked_preparation();
DROP TRIGGER IF EXISTS subscription_guard_tracked_preparation ON private.subscription_live_customer_scopes;
CREATE TRIGGER subscription_guard_tracked_preparation BEFORE INSERT OR UPDATE ON private.subscription_live_customer_scopes
 FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_tracked_preparation();
-- Alphabetical trigger order runs this after subscription_freeze_live_quote_economics
-- has populated the immutable customer_review_id.
DROP TRIGGER IF EXISTS subscription_guard_tracked_preparation ON private.subscription_live_quotes;
CREATE TRIGGER subscription_guard_tracked_preparation BEFORE INSERT ON private.subscription_live_quotes
 FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_tracked_preparation();
DROP TRIGGER IF EXISTS subscription_guard_tracked_preparation ON private.subscription_live_payments;
CREATE TRIGGER subscription_guard_tracked_preparation BEFORE INSERT ON private.subscription_live_payments
 FOR EACH ROW EXECUTE FUNCTION private.subscription_guard_tracked_preparation();

CREATE OR REPLACE FUNCTION public.platform_admin_starter_signup_queue(p_limit INTEGER DEFAULT 50,p_offset INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB;
BEGIN
 PERFORM private.require_platform_admin();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 THEN
  RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::JSONB) INTO v_result FROM (
  SELECT s.organization_id,o.name,s.policy_id,s.selected_at,coalesce(w.operator_user_id,p.approved_by) operator_user_id,
   coalesce(op.full_name,ou.email,'Unassigned operator') operator_name,
   coalesce(w.revision,0) revision,coalesce(w.status,'awaiting_facts') work_status,
   coalesce(w.next_action,'Collect actual buyer and setup details') next_action,
   coalesce(w.evidence,'{}'::JSONB) evidence,w.preparation_id,
   c.facts->>'snapshot_token' snapshot_token,c.facts->'branches' branches,
   x.trial_ends_at,
   w.preparation_id IS NOT NULL AND (NOT private.subscription_starter_preparation_current(w.preparation_id)
     OR (NOT EXISTS(SELECT 1 FROM private.subscription_live_payments pay WHERE pay.organization_id=s.organization_id AND pay.state='verified')
      AND w.reviewed_snapshot IS DISTINCT FROM c.facts->>'snapshot_token')) preparation_stale,
   (c.facts->'missing_facts') || to_jsonb(ARRAY(SELECT k FROM unnest(private.subscription_starter_evidence_keys()) k
      WHERE coalesce(length(btrim(w.evidence->>k)),0)=0)) missing_facts,
   (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',ad.user_id,'name',coalesce(ap.full_name,au.email,'Platform administrator')) ORDER BY ad.user_id),'[]'::JSONB)
     FROM private.platform_admins ad JOIN auth.users au ON au.id=ad.user_id LEFT JOIN public.profiles ap ON ap.id=ad.user_id) operators,
   private.product_access_status(x) access_status,
   (SELECT count(*) FROM public.accounts a WHERE a.organization_id=s.organization_id AND a.branch_status='active') active_branches,
   CASE
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_payments a WHERE a.organization_id=s.organization_id AND a.state='verified') THEN 'payment_verified'
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes a
      JOIN private.subscription_live_settings l ON l.singleton AND l.merchant_id=a.merchant_id
      WHERE a.organization_id=s.organization_id AND a.quotes_enabled AND a.orders_enabled
       AND l.webhook_intake_enabled AND l.settlements_enabled
       AND private.subscription_customer_review_active(a.organization_id,a.review_id)) THEN 'checkout_opened'
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes a WHERE a.organization_id=s.organization_id AND a.quotes_enabled AND a.orders_enabled) THEN 'checkout_paused'
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews a WHERE a.organization_id=s.organization_id AND a.revoked_at IS NULL) THEN 'owner_reviewed'
    WHEN EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations a WHERE a.organization_id=s.organization_id
      AND private.subscription_customer_preparation_eligible(a.review_id,a.owner_user_id)) THEN 'owner_review_required'
    WHEN w.preparation_id IS NOT NULL THEN 'preparation_closed'
    ELSE 'commercial_review_required' END review_status
  FROM private.subscription_starter_signup_selections s
  JOIN private.subscription_starter_signup_policies p ON p.policy_id=s.policy_id
  JOIN public.organizations o ON o.id=s.organization_id
  LEFT JOIN private.organization_product_access x ON x.organization_id=s.organization_id
  LEFT JOIN private.subscription_starter_signup_work w ON w.organization_id=s.organization_id
  LEFT JOIN auth.users ou ON ou.id=coalesce(w.operator_user_id,p.approved_by)
  LEFT JOIN public.profiles op ON op.id=ou.id
  CROSS JOIN LATERAL (SELECT private.subscription_starter_signup_context(s.organization_id) facts) c
  ORDER BY s.selected_at,s.organization_id LIMIT p_limit OFFSET p_offset
 ) q;
 RETURN jsonb_build_object('items',v_result,'total',(SELECT count(*) FROM private.subscription_starter_signup_selections s
  JOIN public.organizations o ON o.id=s.organization_id));
END;
$$;

ALTER FUNCTION private.subscription_starter_evidence_keys() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_starter_evidence_keys() FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION private.subscription_starter_signup_context(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_starter_signup_context(UUID) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.platform_admin_save_starter_signup_work(UUID,INTEGER,TEXT,UUID,TEXT,TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_admin_save_starter_signup_work(UUID,INTEGER,TEXT,UUID,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.platform_admin_freeze_starter_signup_preparation(UUID,INTEGER,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_admin_freeze_starter_signup_preparation(UUID,INTEGER,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION private.subscription_starter_preparation_current(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_starter_preparation_current(UUID) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION private.subscription_guard_starter_preparation_opening() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_guard_starter_preparation_opening() FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION private.subscription_customer_preparation_eligible(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_customer_preparation_eligible(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION private.subscription_customer_review_active(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_customer_review_active(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.platform_admin_starter_signup_queue(INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_admin_starter_signup_queue(INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_save_starter_signup_work(UUID,INTEGER,TEXT,UUID,TEXT,TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_freeze_starter_signup_preparation(UUID,INTEGER,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_starter_signup_queue(INTEGER,INTEGER) TO authenticated;

ALTER FUNCTION private.subscription_serialize_starter_source_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_serialize_starter_source_write() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_lock_starter_preparation_sources(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_lock_starter_preparation_sources(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.subscription_guard_tracked_preparation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.subscription_guard_tracked_preparation() FROM PUBLIC,anon,authenticated,service_role;
