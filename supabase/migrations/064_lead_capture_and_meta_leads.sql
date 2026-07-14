-- ============================================================
-- 064_lead_capture_and_meta_leads.sql — inbound lead capture
--
-- Two ingest paths for leads the gym did NOT type in:
--   · public capture form  — /f/<token>, anonymous visitor
--   · Meta lead ads        — Facebook/Instagram leadgen webhook
--
-- Both are system-generated origins (received_via 'form' / 'meta'),
-- so both land ownership-LOCKED and UNASSIGNED. That lock is free:
-- 050:137 and 052:93 already refuse a transfer when
-- `received_via NOT IN ('manual','import')`, so the moment 'form' is
-- legal in the CHECK below it inherits the same treatment as
-- whatsapp/api/automation. Assignment (request_lead_assignment) has
-- no such guard, so the team can still assign these — which is
-- exactly the intent: nobody "received" an auto-captured lead, but
-- someone must work it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- 1. received_via gains 'form' ---------------------------------
-- 048 guards its ADD on the constraint NAME, so re-running 048 can
-- never widen the value list. Widening therefore means DROP + an
-- unconditional re-ADD: the constraint always ends up carrying the
-- full set. Every existing row satisfies the wider list, so the
-- implicit validation scan passes (no NOT VALID needed).
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_received_via_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_received_via_check
  CHECK (
    received_via IS NULL
    OR received_via IN (
      'manual',      -- a human added the lead in the dashboard UI
      'import',      -- CSV import / bulk create (still a human action)
      'whatsapp',    -- inbound WhatsApp message find-or-create
      'meta',        -- Meta lead ads                          (064)
      'api',         -- public API POST /api/v1/contacts
      'automation',  -- an internal automation/flow rule (reserved)
      'form'         -- public capture form /f/<token>         (064)
    )
  );

-- ---- 2. meta_page_config — one Facebook Page → one account --------
-- Mirrors whatsapp_config: per-account Meta creds, token encrypted at
-- rest (AES-256-GCM, src/lib/whatsapp/encryption.ts).
CREATE TABLE IF NOT EXISTS public.meta_page_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Audit/sender-of-record, same split as whatsapp_config: account_id
  -- is tenancy, user_id is the human who connected it.
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id           TEXT NOT NULL,
  page_name         TEXT,
  page_access_token TEXT NOT NULL,
  -- NULL = non-expiring (a page token derived from a long-lived user
  -- token). A short-lived one dies in ~1h and leads then stop SILENTLY,
  -- so the connect route always long-lived-swaps first and stamps this.
  token_expires_at  TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'connected'
                      CHECK (status IN ('connected', 'error', 'disconnected')),
  subscribed_at     TIMESTAMPTZ,
  last_error        TEXT,
  last_lead_at      TIMESTAMPTZ,
  -- Leads Meta delivered but we could not turn into a contact, because
  -- the gym's lead form asks for no phone number and contacts.phone is
  -- NOT NULL. Surfaced in Settings with the fix ("add a phone question
  -- in Ads Manager") rather than silently dropped.
  skipped_no_phone  INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One page → one account. Same rule and same reason as
-- whatsapp_config.phone_number_id (013): the leadgen webhook demuxes
-- on page_id alone, so two accounts claiming one page makes the
-- tenant ambiguous and leads get silently dropped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_page_config_page_id
  ON public.meta_page_config (page_id);
CREATE INDEX IF NOT EXISTS idx_meta_page_config_account
  ON public.meta_page_config (account_id);

DROP TRIGGER IF EXISTS update_meta_page_config_updated_at ON public.meta_page_config;
CREATE TRIGGER update_meta_page_config_updated_at
  BEFORE UPDATE ON public.meta_page_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meta_page_config ENABLE ROW LEVEL SECURITY;

-- Settings-class AND holds a secret → admin-only on all four verbs.
-- Agents/viewers get nothing: ciphertext still shouldn't be broadly
-- SELECTable. Server routes use the service role and bypass this.
DROP POLICY IF EXISTS meta_page_config_select ON public.meta_page_config;
CREATE POLICY meta_page_config_select ON public.meta_page_config
  FOR SELECT TO authenticated USING (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS meta_page_config_insert ON public.meta_page_config;
CREATE POLICY meta_page_config_insert ON public.meta_page_config
  FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS meta_page_config_update ON public.meta_page_config;
CREATE POLICY meta_page_config_update ON public.meta_page_config
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS meta_page_config_delete ON public.meta_page_config;
CREATE POLICY meta_page_config_delete ON public.meta_page_config
  FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'));

-- ---- 3. lead_capture_forms — the public /f/<token> form -----------
-- TOKEN IS PLAINTEXT, ON PURPOSE.
--
-- account_invitations stores only a token_hash because that token
-- grants MEMBERSHIP — a DB leak must not be redeemable — and it pays
-- for that with a rotate-on-every-copy link route, since the
-- plaintext can never be re-shown.
--
-- This token grants no read of anything. It permits exactly one
-- thing: a Turnstile'd, rate-limited, honeypot'd anonymous INSERT of
-- a lead into one account. It lives in an Instagram bio and on a
-- printed QR poster, so it must be re-copyable — rotate-on-copy would
-- be hostile. A leak lets an attacker spam leads INTO the gym, not
-- read anything out of it; the anti-spam layer is the mitigation, and
-- revocation is is_active = false (or an explicit rotate).
--
-- anon still cannot SELECT this table — the public page reads it only
-- through peek_lead_capture_form() below, which returns a fixed shape.
CREATE TABLE IF NOT EXISTS public.lead_capture_forms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One form per gym (fixed field set, no builder). UNIQUE enforces it.
  account_id   UUID NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Unbranded v1: `accounts` carries no logo/brand colour and we are
  -- deliberately not adding one. The page renders accounts.name plus
  -- whatever copy the gym writes here.
  headline     TEXT,
  intro        TEXT,
  -- Snapshotted onto every submission below. A DPDP audit needs proof
  -- of WHAT the visitor agreed to, not merely THAT they agreed — so
  -- editing this text must not rewrite history.
  consent_text TEXT NOT NULL
                 DEFAULT 'I agree to be contacted about my enquiry on WhatsApp.',
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_lead_capture_forms_updated_at ON public.lead_capture_forms;
CREATE TRIGGER update_lead_capture_forms_updated_at
  BEFORE UPDATE ON public.lead_capture_forms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lead_capture_forms ENABLE ROW LEVEL SECURITY;

-- Any member may read (an agent shares the link); admins manage it.
DROP POLICY IF EXISTS lead_capture_forms_select ON public.lead_capture_forms;
CREATE POLICY lead_capture_forms_select ON public.lead_capture_forms
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS lead_capture_forms_insert ON public.lead_capture_forms;
CREATE POLICY lead_capture_forms_insert ON public.lead_capture_forms
  FOR INSERT TO authenticated WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS lead_capture_forms_update ON public.lead_capture_forms;
CREATE POLICY lead_capture_forms_update ON public.lead_capture_forms
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS lead_capture_forms_delete ON public.lead_capture_forms;
CREATE POLICY lead_capture_forms_delete ON public.lead_capture_forms
  FOR DELETE TO authenticated USING (public.is_account_member(account_id, 'admin'));

-- ---- 4. lead_capture_submissions — audit + consent proof ----------
-- Every submit lands here, whether it created a contact or deduped
-- onto an existing one. This is the consent record; the contact is
-- merely its consequence.
CREATE TABLE IF NOT EXISTS public.lead_capture_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  form_id         UUID NOT NULL REFERENCES public.lead_capture_forms(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: deleting the lead must NOT destroy the
  -- proof that this person consented to be contacted.
  contact_id      UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- FALSE = deduped onto a contact that already existed. The gym still
  -- needs to know a second enquiry came in.
  created_contact BOOLEAN NOT NULL DEFAULT FALSE,
  payload         JSONB NOT NULL,
  consent         BOOLEAN NOT NULL,
  consent_text    TEXT,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_capture_submissions_account_created
  ON public.lead_capture_submissions (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_capture_submissions_contact
  ON public.lead_capture_submissions (contact_id);

ALTER TABLE public.lead_capture_submissions ENABLE ROW LEVEL SECURITY;

-- Read-only to members; the submit route writes with the service role.
-- No client INSERT/UPDATE/DELETE policy at all: an audit trail nobody
-- can forge or quietly edit is the whole point.
DROP POLICY IF EXISTS lead_capture_submissions_select ON public.lead_capture_submissions;
CREATE POLICY lead_capture_submissions_select ON public.lead_capture_submissions
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

-- ---- 5. peek_lead_capture_form — anonymous, FIXED SHAPE -----------
-- Mirrors peek_invitation (019): SECURITY DEFINER so an anonymous
-- visitor can read across the RLS wall, returning ONLY the fields the
-- /f page renders. It must never return account_id, the form id, or
-- anything else — a public endpoint leaks whatever it selects.
CREATE OR REPLACE FUNCTION public.peek_lead_capture_form(
  p_token TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form    RECORD;
  v_sources JSONB;
BEGIN
  SELECT f.id, f.account_id, f.is_active, f.headline, f.intro, f.consent_text,
         a.name AS account_name, a.phone_country_code
    INTO v_form
  FROM lead_capture_forms f
  JOIN accounts a ON a.id = f.account_id
  WHERE f.token = p_token;

  IF v_form.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT v_form.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
  END IF;

  -- The gym's own "How did you hear about us?" list (042). An empty
  -- array means the client falls back to SOURCE_OPTIONS, exactly as
  -- every authed surface does.
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('key', o.key, 'label', o.label)
                     ORDER BY o.sort_order, o.label),
           '[]'::jsonb
         )
    INTO v_sources
  FROM lead_field_options o
  WHERE o.account_id = v_form.account_id
    AND o.field = 'source';

  RETURN jsonb_build_object(
    'ok', true,
    'gym_name', v_form.account_name,
    'headline', v_form.headline,
    'intro', v_form.intro,
    'consent_text', v_form.consent_text,
    'phone_country_code', COALESCE(v_form.phone_country_code, ''),
    'sources', v_sources
  );
END;
$$;

-- ---- 6. grants ----------------------------------------------------
REVOKE ALL ON public.meta_page_config FROM anon;
REVOKE ALL ON public.lead_capture_forms FROM anon;
REVOKE ALL ON public.lead_capture_submissions FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_page_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_capture_forms TO authenticated;
GRANT SELECT ON public.lead_capture_submissions TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.meta_page_config TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.lead_capture_forms TO service_role;
GRANT SELECT, INSERT ON public.lead_capture_submissions TO service_role;

-- The leadgen webhook claims each lead in webhook_events (id =
-- 'meta:leadgen:<leadgen_id>') so Meta's aggressive redelivery can't
-- double-insert. On a mid-processing failure it DELETEs its own claim
-- so Meta's retry isn't deduped away into a permanently lost lead —
-- 059:431 granted service_role only SELECT/INSERT/UPDATE.
GRANT DELETE ON public.webhook_events TO service_role;

REVOKE ALL ON FUNCTION public.peek_lead_capture_form(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_lead_capture_form(TEXT)
  TO anon, authenticated, service_role;
