-- Products, services, trainer rate cards, generic invoice lines, and credits.
-- This migration is additive: membership_periods remains the membership-cycle
-- source of truth, while every period is linked to one membership invoice line.

-- ---------------------------------------------------------------------------
-- Catalogue and trainer directory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trainers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) > 0),
  title TEXT,
  linked_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainers_account_active_name
  ON public.trainers(account_id, lower(display_name)) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainers_account_linked_user
  ON public.trainers(account_id, linked_user_id) WHERE linked_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'merchandise')),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  description TEXT,
  requires_trainer BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'service' OR requires_trainer = FALSE),
  UNIQUE (account_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_items_account_active_name
  ON public.catalog_items(account_id, lower(name)) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.catalog_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  duration_count INTEGER,
  duration_unit TEXT,
  standard_price NUMERIC(12, 2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, item_id)
    REFERENCES public.catalog_items(account_id, id) ON DELETE CASCADE,
  CHECK (duration_unit IS NULL OR duration_unit IN ('day', 'week', 'month', 'year')),
  CHECK (
    (duration_count IS NULL AND duration_unit IS NULL)
    OR (duration_count > 0 AND duration_unit IS NOT NULL)
  ),
  CHECK (standard_price IS NULL OR standard_price >= 0),
  UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_options_item
  ON public.catalog_options(item_id, sort_order, id);

CREATE TABLE IF NOT EXISTS public.trainer_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL,
  option_id UUID NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, trainer_id)
    REFERENCES public.trainers(account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, option_id)
    REFERENCES public.catalog_options(account_id, id) ON DELETE CASCADE,
  UNIQUE (trainer_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_rates_option
  ON public.trainer_rates(option_id, trainer_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Generic invoice and settlement domain
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  membership_period_id UUID UNIQUE
    REFERENCES public.membership_periods(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (
    source IN ('joining', 'membership_renewal', 'sale', 'service_renewal', 'service_adjustment')
  ),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'void')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_name_snapshot TEXT,
  member_number_snapshot BIGINT,
  currency TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  idempotency_key UUID,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key),
  UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_account_issued
  ON public.invoices(account_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_membership
  ON public.invoices(membership_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_contact
  ON public.invoices(contact_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('membership', 'service', 'merchandise', 'service_adjustment')
  ),
  membership_period_id UUID UNIQUE
    REFERENCES public.membership_periods(id) ON DELETE SET NULL,
  catalog_item_id UUID REFERENCES public.catalog_items(id) ON DELETE SET NULL,
  catalog_option_id UUID REFERENCES public.catalog_options(id) ON DELETE SET NULL,
  trainer_id UUID REFERENCES public.trainers(id) ON DELETE SET NULL,
  -- FK added after member_services exists in the next migration.
  member_service_id UUID,
  description TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount NUMERIC(12, 2) NOT NULL CHECK (unit_amount >= 0),
  line_amount NUMERIC(12, 2) NOT NULL CHECK (line_amount >= 0),
  service_start DATE,
  service_end DATE,
  list_amount NUMERIC(12, 2),
  override_amount NUMERIC(12, 2),
  override_reason TEXT,
  overridden_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'void')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, invoice_id)
    REFERENCES public.invoices(account_id, id) ON DELETE RESTRICT,
  CHECK (
    (service_start IS NULL AND service_end IS NULL)
    OR (service_start IS NOT NULL AND service_end IS NOT NULL AND service_end > service_start)
  ),
  CHECK (
    (override_amount IS NULL AND override_reason IS NULL AND overridden_by IS NULL)
    OR (override_amount IS NOT NULL AND length(btrim(override_reason)) > 0 AND overridden_by IS NOT NULL)
  ),
  UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
  ON public.invoice_lines(invoice_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_catalog
  ON public.invoice_lines(catalog_item_id, catalog_option_id);

ALTER TABLE public.membership_periods
  ADD COLUMN IF NOT EXISTS invoice_line_id UUID;
ALTER TABLE public.membership_periods
  DROP CONSTRAINT IF EXISTS membership_periods_invoice_line_id_fkey;
ALTER TABLE public.membership_periods
  ADD CONSTRAINT membership_periods_invoice_line_id_fkey
  FOREIGN KEY (invoice_line_id) REFERENCES public.invoice_lines(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_periods_invoice_line
  ON public.membership_periods(invoice_line_id) WHERE invoice_line_id IS NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_invoice_paid
  ON public.payments(invoice_id, paid_at DESC) WHERE status = 'paid';

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  invoice_line_id UUID NOT NULL REFERENCES public.invoice_lines(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, invoice_line_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_line
  ON public.payment_allocations(invoice_line_id, payment_id);

CREATE TABLE IF NOT EXISTS public.member_credit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL CHECK (source IN ('trainer_reassignment')),
  source_service_id UUID,
  note TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_member_credit_entries_membership
  ON public.member_credit_entries(account_id, membership_id, created_at, id);

CREATE TABLE IF NOT EXISTS public.invoice_credit_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  credit_entry_id UUID NOT NULL REFERENCES public.member_credit_entries(id) ON DELETE RESTRICT,
  invoice_line_id UUID NOT NULL REFERENCES public.invoice_lines(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credit_entry_id, invoice_line_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_credit_allocations_line
  ON public.invoice_credit_allocations(invoice_line_id, credit_entry_id);

-- ---------------------------------------------------------------------------
-- Member services and trainer assignment history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  invoice_line_id UUID NOT NULL UNIQUE REFERENCES public.invoice_lines(id) ON DELETE RESTRICT,
  catalog_item_id UUID REFERENCES public.catalog_items(id) ON DELETE SET NULL,
  catalog_option_id UUID REFERENCES public.catalog_options(id) ON DELETE SET NULL,
  renewed_from_service_id UUID REFERENCES public.member_services(id) ON DELETE SET NULL,
  item_name_snapshot TEXT NOT NULL,
  option_duration_count INTEGER NOT NULL CHECK (option_duration_count > 0),
  option_duration_unit TEXT NOT NULL CHECK (option_duration_unit IN ('day', 'week', 'month', 'year')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date > start_date),
  sold_amount NUMERIC(12, 2) NOT NULL CHECK (sold_amount >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_member_services_account_end
  ON public.member_services(account_id, status, end_date);
CREATE INDEX IF NOT EXISTS idx_member_services_membership
  ON public.member_services(membership_id, start_date DESC);

ALTER TABLE public.member_credit_entries
  DROP CONSTRAINT IF EXISTS member_credit_entries_source_service_id_fkey;
ALTER TABLE public.member_credit_entries
  ADD CONSTRAINT member_credit_entries_source_service_id_fkey
  FOREIGN KEY (source_service_id) REFERENCES public.member_services(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.service_trainer_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  member_service_id UUID NOT NULL REFERENCES public.member_services(id) ON DELETE CASCADE,
  trainer_id UUID REFERENCES public.trainers(id) ON DELETE SET NULL,
  trainer_name_snapshot TEXT NOT NULL,
  trainer_title_snapshot TEXT,
  full_package_rate NUMERIC(12, 2) NOT NULL CHECK (full_package_rate >= 0),
  starts_on DATE NOT NULL,
  ends_on DATE,
  reason TEXT,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_assignments_current
  ON public.service_trainer_assignments(member_service_id) WHERE ends_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_assignments_trainer
  ON public.service_trainer_assignments(trainer_id, starts_on DESC);

CREATE TABLE IF NOT EXISTS public.service_renewal_reminders_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  member_service_id UUID NOT NULL REFERENCES public.member_services(id) ON DELETE CASCADE,
  end_date DATE NOT NULL,
  days_before INTEGER NOT NULL CHECK (days_before >= 0),
  wa_message_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_service_id, end_date, days_before)
);

-- Existing settings table is account-owned; add a separate service schedule.
ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS service_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS service_days_before INTEGER[] NOT NULL DEFAULT ARRAY[7, 3, 1];

-- ---------------------------------------------------------------------------
-- Timestamps
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'trainers', 'catalog_items', 'catalog_options', 'trainer_rates',
    'invoices', 'invoice_lines', 'member_services'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      v_table
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RLS and explicit Data API grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'trainers', 'catalog_items', 'catalog_options', 'trainer_rates',
    'invoices', 'invoice_lines', 'payment_allocations',
    'member_credit_entries', 'invoice_credit_allocations',
    'member_services', 'service_trainer_assignments',
    'service_renewal_reminders_sent'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END $$;

-- Settings-class catalogue writes.
DROP POLICY IF EXISTS trainers_select ON public.trainers;
DROP POLICY IF EXISTS trainers_insert ON public.trainers;
DROP POLICY IF EXISTS trainers_update ON public.trainers;
CREATE POLICY trainers_select ON public.trainers FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY trainers_insert ON public.trainers FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin') AND created_by = (SELECT auth.uid()));
CREATE POLICY trainers_update ON public.trainers FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_items_select ON public.catalog_items;
DROP POLICY IF EXISTS catalog_items_insert ON public.catalog_items;
DROP POLICY IF EXISTS catalog_items_update ON public.catalog_items;
CREATE POLICY catalog_items_select ON public.catalog_items FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY catalog_items_insert ON public.catalog_items FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin') AND created_by = (SELECT auth.uid()));
CREATE POLICY catalog_items_update ON public.catalog_items FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_options_select ON public.catalog_options;
DROP POLICY IF EXISTS catalog_options_insert ON public.catalog_options;
DROP POLICY IF EXISTS catalog_options_update ON public.catalog_options;
CREATE POLICY catalog_options_select ON public.catalog_options FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY catalog_options_insert ON public.catalog_options FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY catalog_options_update ON public.catalog_options FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS trainer_rates_select ON public.trainer_rates;
DROP POLICY IF EXISTS trainer_rates_insert ON public.trainer_rates;
DROP POLICY IF EXISTS trainer_rates_update ON public.trainer_rates;
CREATE POLICY trainer_rates_select ON public.trainer_rates FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY trainer_rates_insert ON public.trainer_rates FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY trainer_rates_update ON public.trainer_rates FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Financial and operational tables are read through RLS; all writes go
-- through database-authoritative RPCs added below/next migration.
DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'invoices', 'invoice_lines', 'payment_allocations',
    'member_credit_entries', 'invoice_credit_allocations',
    'member_services', 'service_trainer_assignments',
    'service_renewal_reminders_sent'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_select', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_account_member(account_id))',
      v_table || '_select', v_table
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.trainers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_options TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trainer_rates TO authenticated;
GRANT SELECT ON public.invoices, public.invoice_lines,
  public.payment_allocations, public.member_credit_entries,
  public.invoice_credit_allocations, public.member_services,
  public.service_trainer_assignments, public.service_renewal_reminders_sent
  TO authenticated;
GRANT ALL ON public.invoices, public.invoice_lines,
  public.payment_allocations, public.member_credit_entries,
  public.invoice_credit_allocations, public.member_services,
  public.service_trainer_assignments, public.service_renewal_reminders_sent
  TO service_role;

REVOKE ALL ON public.trainers, public.catalog_items, public.catalog_options,
  public.trainer_rates, public.invoices, public.invoice_lines,
  public.payment_allocations, public.member_credit_entries,
  public.invoice_credit_allocations, public.member_services,
  public.service_trainer_assignments, public.service_renewal_reminders_sent
  FROM anon;

-- ---------------------------------------------------------------------------
-- Backfill a generic invoice and membership line per persisted period.
-- ---------------------------------------------------------------------------
INSERT INTO public.invoices (
  account_id, contact_id, membership_id, membership_period_id, source,
  state, issued_at, customer_name_snapshot, member_number_snapshot,
  currency, created_by
)
SELECT
  mp.account_id,
  mp.contact_id,
  mp.membership_id,
  mp.id,
  CASE
    WHEN ROW_NUMBER() OVER (
      PARTITION BY mp.membership_id ORDER BY mp.created_at, mp.id
    ) = 1 THEN 'joining'
    ELSE 'membership_renewal'
  END,
  mp.state,
  mp.created_at,
  c.name,
  m.member_number,
  a.default_currency,
  m.user_id
FROM public.membership_periods mp
JOIN public.memberships m ON m.id = mp.membership_id
JOIN public.accounts a ON a.id = mp.account_id
LEFT JOIN public.contacts c ON c.id = mp.contact_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoices i WHERE i.membership_period_id = mp.id
);

INSERT INTO public.invoice_lines (
  account_id, invoice_id, kind, membership_period_id, description,
  quantity, unit_amount, line_amount, service_start, service_end,
  list_amount, sort_order, state, created_at, updated_at
)
SELECT
  mp.account_id,
  i.id,
  'membership',
  mp.id,
  COALESCE(plan.name, 'Membership'),
  1,
  mp.fee_amount,
  mp.fee_amount,
  mp.period_start,
  mp.period_end,
  COALESCE(mp.list_price, mp.fee_amount),
  0,
  CASE WHEN mp.state = 'void' THEN 'void' ELSE 'active' END,
  mp.created_at,
  mp.updated_at
FROM public.membership_periods mp
JOIN public.invoices i ON i.membership_period_id = mp.id
LEFT JOIN public.membership_plans plan ON plan.id = mp.plan_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_lines il WHERE il.membership_period_id = mp.id
);

UPDATE public.membership_periods mp
SET invoice_line_id = il.id
FROM public.invoice_lines il
WHERE il.membership_period_id = mp.id
  AND mp.invoice_line_id IS DISTINCT FROM il.id;

UPDATE public.payments p
SET invoice_id = i.id
FROM public.membership_periods mp
JOIN public.invoices i ON i.membership_period_id = mp.id
WHERE p.membership_id = mp.membership_id
  AND p.period_end IS NOT DISTINCT FROM mp.period_end
  AND p.invoice_id IS NULL;

INSERT INTO public.payment_allocations (
  payment_id, invoice_line_id, account_id, amount, created_at
)
SELECT p.id, mp.invoice_line_id, p.account_id, p.amount, p.created_at
FROM public.payments p
JOIN public.membership_periods mp
  ON mp.membership_id = p.membership_id
 AND mp.period_end IS NOT DISTINCT FROM p.period_end
WHERE p.invoice_id IS NOT NULL
  AND mp.invoice_line_id IS NOT NULL
ON CONFLICT (payment_id, invoice_line_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Reconciled line/invoice views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.invoice_line_balances
WITH (security_invoker = true) AS
WITH paid AS (
  SELECT
    pa.invoice_line_id,
    SUM(pa.amount) FILTER (WHERE p.status = 'paid')::NUMERIC(12, 2) AS amount_paid
  FROM public.payment_allocations pa
  JOIN public.payments p ON p.id = pa.payment_id
  GROUP BY pa.invoice_line_id
), credited AS (
  SELECT
    ica.invoice_line_id,
    SUM(ica.amount)::NUMERIC(12, 2) AS credit_applied
  FROM public.invoice_credit_allocations ica
  GROUP BY ica.invoice_line_id
)
SELECT
  il.*,
  COALESCE(paid.amount_paid, 0)::NUMERIC(12, 2) AS amount_paid,
  COALESCE(credited.credit_applied, 0)::NUMERIC(12, 2) AS credit_applied,
  GREATEST(
    CASE WHEN il.state = 'void' THEN 0 ELSE il.line_amount END
      - COALESCE(paid.amount_paid, 0)
      - COALESCE(credited.credit_applied, 0),
    0
  )::NUMERIC(12, 2) AS balance
FROM public.invoice_lines il
LEFT JOIN paid ON paid.invoice_line_id = il.id
LEFT JOIN credited ON credited.invoice_line_id = il.id;

CREATE OR REPLACE VIEW public.invoice_balances
WITH (security_invoker = true) AS
SELECT
  i.id,
  i.account_id,
  i.contact_id,
  i.membership_id,
  i.membership_period_id,
  i.source,
  i.state,
  i.issued_at,
  i.customer_name_snapshot,
  i.member_number_snapshot,
  i.currency,
  i.created_by,
  i.created_at,
  COALESCE(SUM(CASE WHEN il.state = 'active' THEN il.line_amount ELSE 0 END), 0)::NUMERIC(12, 2) AS total,
  COALESCE(SUM(il.amount_paid), 0)::NUMERIC(12, 2) AS amount_paid,
  COALESCE(SUM(il.credit_applied), 0)::NUMERIC(12, 2) AS credit_applied,
  COALESCE(SUM(il.balance), 0)::NUMERIC(12, 2) AS balance
FROM public.invoices i
LEFT JOIN public.invoice_line_balances il ON il.invoice_id = i.id
GROUP BY i.id;

-- Preserve the exact established column order and append generic-invoice facts.
CREATE OR REPLACE VIEW public.membership_period_invoices
WITH (security_invoker = true) AS
SELECT
  mp.id,
  mp.account_id,
  mp.membership_id,
  mp.contact_id,
  mp.plan_id,
  mp.period_start,
  mp.period_end,
  mp.fee_amount,
  mp.state,
  mp.created_at,
  COALESCE(il.amount_paid, 0)::NUMERIC(12, 2) AS amount_paid,
  COALESCE(il.balance, mp.fee_amount)::NUMERIC(12, 2) AS balance,
  mp.list_price,
  mp.discount_type,
  mp.discount_value,
  mp.discount_amount,
  mp.standard_period_end,
  mp.bonus_months,
  mp.pricing_option_id,
  COALESCE(il.credit_applied, 0)::NUMERIC(12, 2) AS credit_applied,
  il.invoice_id,
  mp.invoice_line_id
FROM public.membership_periods mp
LEFT JOIN public.invoice_line_balances il ON il.id = mp.invoice_line_id;

GRANT SELECT ON public.invoice_line_balances, public.invoice_balances,
  public.membership_period_invoices TO authenticated, service_role;
REVOKE ALL ON public.invoice_line_balances, public.invoice_balances,
  public.membership_period_invoices FROM anon;

-- ---------------------------------------------------------------------------
-- Every new membership period gets a stable invoice and membership line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_membership_period_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice_id UUID;
  v_line_id UUID;
  v_name TEXT;
  v_member_number BIGINT;
  v_currency TEXT;
  v_creator UUID;
  v_is_first BOOLEAN;
BEGIN
  IF NEW.invoice_line_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.name, m.member_number, a.default_currency, m.user_id,
    NOT EXISTS (
      SELECT 1 FROM public.membership_periods earlier
      WHERE earlier.membership_id = NEW.membership_id
        AND earlier.id <> NEW.id
        AND (earlier.created_at < NEW.created_at
          OR (earlier.created_at = NEW.created_at AND earlier.id < NEW.id))
    )
  INTO v_name, v_member_number, v_currency, v_creator, v_is_first
  FROM public.memberships m
  JOIN public.accounts a ON a.id = NEW.account_id
  LEFT JOIN public.contacts c ON c.id = NEW.contact_id
  WHERE m.id = NEW.membership_id;

  INSERT INTO public.invoices (
    account_id, contact_id, membership_id, membership_period_id, source,
    state, issued_at, customer_name_snapshot, member_number_snapshot,
    currency, created_by
  ) VALUES (
    NEW.account_id, NEW.contact_id, NEW.membership_id, NEW.id,
    CASE WHEN v_is_first THEN 'joining' ELSE 'membership_renewal' END,
    NEW.state, NEW.created_at, v_name, v_member_number,
    COALESCE(v_currency, 'INR'), v_creator
  )
  ON CONFLICT (membership_period_id) DO UPDATE
    SET membership_period_id = EXCLUDED.membership_period_id
  RETURNING id INTO v_invoice_id;

  SELECT name INTO v_name FROM public.membership_plans WHERE id = NEW.plan_id;

  INSERT INTO public.invoice_lines (
    account_id, invoice_id, kind, membership_period_id, description,
    quantity, unit_amount, line_amount, service_start, service_end,
    list_amount, sort_order, state
  ) VALUES (
    NEW.account_id, v_invoice_id, 'membership', NEW.id,
    COALESCE(v_name, 'Membership'), 1, NEW.fee_amount, NEW.fee_amount,
    NEW.period_start, NEW.period_end, COALESCE(NEW.list_price, NEW.fee_amount),
    0, CASE WHEN NEW.state = 'void' THEN 'void' ELSE 'active' END
  )
  ON CONFLICT (membership_period_id) DO UPDATE SET
    description = EXCLUDED.description,
    unit_amount = EXCLUDED.unit_amount,
    line_amount = EXCLUDED.line_amount,
    service_start = EXCLUDED.service_start,
    service_end = EXCLUDED.service_end,
    list_amount = EXCLUDED.list_amount,
    state = EXCLUDED.state,
    updated_at = now()
  RETURNING id INTO v_line_id;

  UPDATE public.membership_periods
  SET invoice_line_id = v_line_id
  WHERE id = NEW.id AND invoice_line_id IS DISTINCT FROM v_line_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_membership_period_invoice
  ON public.membership_periods;
CREATE TRIGGER trg_ensure_membership_period_invoice
  AFTER INSERT ON public.membership_periods
  FOR EACH ROW EXECUTE FUNCTION public.ensure_membership_period_invoice();

REVOKE ALL ON FUNCTION public.ensure_membership_period_invoice()
  FROM PUBLIC, anon, authenticated;

-- Keep the linked membership line in sync when lifecycle RPCs edit a period.
CREATE OR REPLACE FUNCTION public.sync_membership_period_invoice_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.invoice_line_id IS NOT NULL THEN
    UPDATE public.invoice_lines
    SET
      unit_amount = NEW.fee_amount,
      line_amount = NEW.fee_amount,
      service_start = NEW.period_start,
      service_end = NEW.period_end,
      state = CASE WHEN NEW.state = 'void' THEN 'void' ELSE 'active' END,
      updated_at = now()
    WHERE id = NEW.invoice_line_id;

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_membership_period_invoice_line
  ON public.membership_periods;
CREATE TRIGGER trg_sync_membership_period_invoice_line
  AFTER UPDATE OF period_start, period_end, fee_amount, state
  ON public.membership_periods
  FOR EACH ROW EXECUTE FUNCTION public.sync_membership_period_invoice_line();

REVOKE ALL ON FUNCTION public.sync_membership_period_invoice_line()
  FROM PUBLIC, anon, authenticated;

-- Publish operational rows for the existing member-list refresh channel.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_services;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
