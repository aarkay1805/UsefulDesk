-- ============================================================
-- 055_account_localization.sql — Per-account (gym) localization
--
-- The product must adapt to each gym's geography: an Indian gym
-- shows ₹1,00,000 / 11/07/2026 / Asia/Kolkata "today"; a US gym
-- $100,000 / 07/11/2026 / its own zone. These columns are the
-- SINGLE source of that config. App-side, `resolveAccountLocale`
-- (src/lib/locale/config.ts) narrows the row into an AccountLocale
-- and `buildFormatters` renders everything through it — no
-- geography conditionals anywhere else in the codebase.
--
-- Same single-column-on-accounts approach as default_currency
-- (021) and UPI (038). RLS: accounts_update (017) already limits
-- writes to admins+, reads to members — exactly right for
-- account-wide settings; no policy change.
--
-- Defaults are India (the home market), which also BACKFILLS every
-- existing account correctly — current production accounts are
-- Indian gyms. `default_currency`'s DEFAULT flips USD→INR for the
-- same reason (existing rows keep their stored value; signup now
-- passes an explicit currency anyway).
--
-- `handle_new_user` (017) is re-created to read localization
-- metadata that signup passes in `auth.signUp({ options.data })`
-- (the country picker applies a preset client-side and sends the
-- resolved columns). Each value is regex/whitelist-guarded in SQL:
-- a malformed value falls back to the India default rather than
-- failing the CHECK and aborting the whole signup bootstrap.
-- NOTE: `remove_account_member` (018) creates fallback personal
-- accounts via a plain INSERT — those get India defaults, which is
-- fine (editable in Settings → Localization).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; constraints drop-then-add;
-- CREATE OR REPLACE FUNCTION.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'IN';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-IN';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS date_order TEXT NOT NULL DEFAULT 'DMY';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS time_format TEXT NOT NULL DEFAULT '12h';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS week_start SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS phone_country_code TEXT NOT NULL DEFAULT '+91';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS measurement_system TEXT NOT NULL DEFAULT 'metric';

-- India-first product: new accounts default to INR unless signup
-- metadata says otherwise. Existing rows are untouched.
ALTER TABLE accounts
  ALTER COLUMN default_currency SET DEFAULT 'INR';

-- Shape guards. Loose where the value space is open (IANA zones,
-- BCP-47 tags — the app validates against the runtime's Intl), strict
-- where it's a closed set.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_country_code_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_country_code_format
  CHECK (country_code ~ '^[A-Z]{2}$');

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_locale_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_locale_format
  CHECK (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_timezone_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_timezone_format
  CHECK (timezone ~ '^[A-Za-z0-9_+/-]{1,64}$');

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_date_order_valid;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_date_order_valid
  CHECK (date_order IN ('DMY', 'MDY', 'YMD'));

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_time_format_valid;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_time_format_valid
  CHECK (time_format IN ('12h', '24h'));

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_week_start_valid;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_week_start_valid
  CHECK (week_start IN (0, 1, 6));

-- '' = unknown (the "somewhere else" preset); otherwise '+' + 1-4 digits.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_phone_country_code_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_phone_country_code_format
  CHECK (phone_country_code = '' OR phone_country_code ~ '^\+[0-9]{1,4}$');

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_measurement_system_valid;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_measurement_system_valid
  CHECK (measurement_system IN ('metric', 'imperial'));

-- ------------------------------------------------------------
-- Signup bootstrap now honours localization metadata. Guards keep
-- every value CHECK-safe: bad/absent metadata → India defaults, and
-- the signup never aborts on a malformed picker payload.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_meta JSONB;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);

  INSERT INTO public.accounts (
    name, owner_user_id,
    country_code, locale, default_currency, timezone,
    date_order, time_format, week_start,
    phone_country_code, measurement_system
  )
  VALUES (
    COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'),
    NEW.id,
    CASE WHEN v_meta->>'country_code' ~ '^[A-Z]{2}$'
         THEN v_meta->>'country_code' ELSE 'IN' END,
    CASE WHEN v_meta->>'locale' ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
         THEN v_meta->>'locale' ELSE 'en-IN' END,
    CASE WHEN v_meta->>'default_currency' ~ '^[A-Z]{3}$'
         THEN v_meta->>'default_currency' ELSE 'INR' END,
    CASE WHEN v_meta->>'timezone' ~ '^[A-Za-z0-9_+/-]{1,64}$'
         THEN v_meta->>'timezone' ELSE 'Asia/Kolkata' END,
    CASE WHEN v_meta->>'date_order' IN ('DMY', 'MDY', 'YMD')
         THEN v_meta->>'date_order' ELSE 'DMY' END,
    CASE WHEN v_meta->>'time_format' IN ('12h', '24h')
         THEN v_meta->>'time_format' ELSE '12h' END,
    CASE WHEN v_meta->>'week_start' IN ('0', '1', '6')
         THEN (v_meta->>'week_start')::smallint ELSE 1 END,
    CASE WHEN v_meta->>'phone_country_code' = ''
           OR v_meta->>'phone_country_code' ~ '^\+[0-9]{1,4}$'
         THEN v_meta->>'phone_country_code' ELSE '+91' END,
    CASE WHEN v_meta->>'measurement_system' IN ('metric', 'imperial')
         THEN v_meta->>'measurement_system' ELSE 'metric' END
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account\profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
