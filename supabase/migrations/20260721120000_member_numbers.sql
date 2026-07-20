-- ============================================================
-- 20260721120000_member_numbers.sql — account-wide Member IDs
--
-- Gives every membership a short, stable numeric identifier for fast
-- front-desk lookup and future biometric-device mapping. The number is
-- unique inside an account (tenant), not globally, and deliberately has
-- no branch component: a member keeps the same ID when visiting or moving
-- between branches that may be added under the account later.
--
-- Allocation is database-owned. A private per-account counter serializes
-- concurrent UI/import/conversion inserts, starts at 1001, never moves
-- backwards, and is not decremented when a membership is deleted. Clients
-- cannot choose or rewrite a number.
-- ============================================================

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS member_number INTEGER;

CREATE TABLE IF NOT EXISTS public.account_member_number_counters (
  account_id         UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  next_member_number INTEGER NOT NULL DEFAULT 1001
    CHECK (next_member_number >= 1001)
);

-- Counter state is an implementation detail. Only the SECURITY DEFINER
-- allocator below may read/write it; membership visibility still follows
-- the existing memberships RLS policies.
ALTER TABLE public.account_member_number_counters ENABLE ROW LEVEL SECURITY;

-- Backfill existing memberships deterministically (oldest first). The
-- offset makes a rerun safe even if an earlier attempt populated only part
-- of an account.
WITH account_offsets AS (
  SELECT
    account_id,
    GREATEST(COALESCE(MAX(member_number), 1000), 1000) AS base_number
  FROM public.memberships
  GROUP BY account_id
), numbered AS (
  SELECT
    m.id,
    o.base_number
      + ROW_NUMBER() OVER (
          PARTITION BY m.account_id
          ORDER BY m.created_at, m.id
        )::INTEGER AS member_number
  FROM public.memberships AS m
  JOIN account_offsets AS o ON o.account_id = m.account_id
  WHERE m.member_number IS NULL
)
UPDATE public.memberships AS m
SET member_number = numbered.member_number
FROM numbered
WHERE m.id = numbered.id;

-- Seed each live account's allocator one past its highest assigned number.
-- GREATEST preserves the never-reuse invariant on idempotent reruns.
INSERT INTO public.account_member_number_counters (account_id, next_member_number)
SELECT
  account_id,
  GREATEST(COALESCE(MAX(member_number), 1000) + 1, 1001)
FROM public.memberships
GROUP BY account_id
ON CONFLICT (account_id) DO UPDATE
SET next_member_number = GREATEST(
  public.account_member_number_counters.next_member_number,
  EXCLUDED.next_member_number
);

CREATE OR REPLACE FUNCTION public.assign_membership_member_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Ignore caller input: Member IDs are always allocated by the database.
  INSERT INTO public.account_member_number_counters AS counter (
    account_id,
    next_member_number
  )
  VALUES (NEW.account_id, 1002)
  ON CONFLICT (account_id) DO UPDATE
  SET next_member_number = counter.next_member_number + 1
  RETURNING next_member_number - 1 INTO NEW.member_number;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_membership_member_number()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_membership_member_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.member_number IS DISTINCT FROM OLD.member_number THEN
    RAISE EXCEPTION 'Member ID is immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_membership_member_number()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS assign_member_number_before_insert ON public.memberships;
CREATE TRIGGER assign_member_number_before_insert
  BEFORE INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.assign_membership_member_number();

DROP TRIGGER IF EXISTS protect_member_number_before_update ON public.memberships;
CREATE TRIGGER protect_member_number_before_update
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.protect_membership_member_number();

ALTER TABLE public.memberships
  ALTER COLUMN member_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_account_member_number
  ON public.memberships(account_id, member_number);

-- The retention read model flattens memberships and therefore does not pick
-- up new base-table columns automatically. Append Member ID without changing
-- the existing view column order or its security-invoker behavior.
CREATE OR REPLACE VIEW public.member_activity
WITH (security_invoker = true) AS
SELECT
  m.id                 AS membership_id,
  m.account_id,
  m.contact_id,
  m.plan_id,
  m.start_date,
  m.end_date,
  m.status,
  m.fee_status,
  m.fee_amount,
  m.is_trial,
  c.name               AS contact_name,
  c.phone              AS contact_phone,
  p.name               AS plan_name,
  MAX(a.checked_in_at) AS last_visit_at,
  COUNT(a.id)::INTEGER AS visit_count,
  m.member_number
FROM public.memberships AS m
JOIN public.contacts AS c ON c.id = m.contact_id
LEFT JOIN public.membership_plans AS p ON p.id = m.plan_id
LEFT JOIN public.attendance AS a ON a.account_id = m.account_id
                                AND a.contact_id = m.contact_id
WHERE m.status <> 'cancelled'
GROUP BY m.id, c.name, c.phone, p.name;

GRANT SELECT ON public.member_activity TO authenticated, anon, service_role;

-- Distinguish fallback keypad entry from row-button/manual, QR, and future
-- self-service check-ins without changing any attendance authorization.
ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_method_check;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_method_check
  CHECK (method IN ('manual', 'member_id', 'qr', 'self'));
