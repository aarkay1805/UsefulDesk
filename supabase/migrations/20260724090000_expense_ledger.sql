-- Minimal, append-preserving expense ledger for Finance.
-- Expense writes are database-authoritative through record_expense /
-- void_expense; account members can read, while admin+ can mutate.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'expense_status_enum'
  ) THEN
    CREATE TYPE expense_status_enum AS ENUM ('posted', 'void');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'expense_kind_enum'
  ) THEN
    CREATE TYPE expense_kind_enum AS ENUM ('recurring', 'one_time');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expense_categories_account_idx
  ON public.expense_categories(account_id, sort_order, name);
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_active_name_idx
  ON public.expense_categories(account_id, LOWER(BTRIM(name)))
  WHERE is_active;

DROP TRIGGER IF EXISTS set_updated_at ON public.expense_categories;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  occurred_on DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0.50),
  description TEXT NOT NULL CHECK (BTRIM(description) <> ''),
  category_id UUID NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'bank', 'other')),
  expense_kind expense_kind_enum NOT NULL,
  receipt_path TEXT,
  receipt_bucket TEXT GENERATED ALWAYS AS (
    CASE WHEN receipt_path IS NULL THEN NULL ELSE 'expense-receipts' END
  ) STORED,
  recorded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status expense_status_enum NOT NULL DEFAULT 'posted',
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  void_reason TEXT,
  idempotency_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expenses_void_audit_check CHECK (
    (status = 'posted' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR
    (status = 'void' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND BTRIM(void_reason) <> '')
  ),
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS expenses_account_date_idx
  ON public.expenses(account_id, occurred_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS expenses_account_category_idx
  ON public.expenses(account_id, category_id);
CREATE INDEX IF NOT EXISTS expenses_account_status_idx
  ON public.expenses(account_id, status);
CREATE INDEX IF NOT EXISTS expenses_account_kind_idx
  ON public.expenses(account_id, expense_kind);

DROP TRIGGER IF EXISTS set_updated_at ON public.expenses;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_categories_select ON public.expense_categories;
CREATE POLICY expense_categories_select
  ON public.expense_categories FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS expense_categories_insert ON public.expense_categories;
CREATE POLICY expense_categories_insert
  ON public.expense_categories FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS expense_categories_update ON public.expense_categories;
CREATE POLICY expense_categories_update
  ON public.expense_categories FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select
  ON public.expenses FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.seed_default_expense_categories(
  p_account_id UUID
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.expense_categories(account_id, name, sort_order)
  SELECT p_account_id, category.name, category.ordinality::INTEGER
  FROM UNNEST(ARRAY[
    'Rent',
    'Salaries',
    'Utilities',
    'Equipment & maintenance',
    'Marketing',
    'Cleaning & supplies',
    'Bank & gateway charges',
    'Taxes & licences',
    'Other'
  ]::TEXT[]) WITH ORDINALITY AS category(name, ordinality)
  WHERE EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id
  )
  ON CONFLICT DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.seed_default_expense_categories(UUID)
  FROM PUBLIC, anon, authenticated;

SELECT public.seed_default_expense_categories(id)
FROM public.accounts;

CREATE OR REPLACE FUNCTION public.seed_expense_categories_for_new_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.seed_default_expense_categories(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_expense_categories_on_account ON public.accounts;
CREATE TRIGGER seed_expense_categories_on_account
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.seed_expense_categories_for_new_account();

CREATE OR REPLACE FUNCTION public.record_expense(
  p_occurred_on DATE,
  p_amount NUMERIC,
  p_description TEXT,
  p_category_id UUID,
  p_method TEXT,
  p_expense_kind TEXT,
  p_receipt_path TEXT,
  p_idempotency_key UUID
)
RETURNS SETOF public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_id UUID;
  v_timezone TEXT;
  v_today DATE;
BEGIN
  SELECT profile.account_id, COALESCE(account.timezone, 'Asia/Kolkata')
  INTO v_account_id, v_timezone
  FROM public.profiles AS profile
  JOIN public.accounts AS account ON account.id = profile.account_id
  WHERE profile.user_id = auth.uid();

  IF v_account_id IS NULL
     OR NOT public.is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'Only account admins can record expenses';
  END IF;

  v_today := (NOW() AT TIME ZONE v_timezone)::DATE;
  IF p_occurred_on IS NULL OR p_occurred_on > v_today THEN
    RAISE EXCEPTION 'Expense date cannot be in the future';
  END IF;
  IF p_amount IS NULL OR p_amount < 0.50 THEN
    RAISE EXCEPTION 'Expense amount must be at least 0.50';
  END IF;
  IF NULLIF(BTRIM(p_description), '') IS NULL THEN
    RAISE EXCEPTION 'Expense description is required';
  END IF;
  IF p_method IS NULL
     OR p_method NOT IN ('cash', 'upi', 'card', 'bank', 'other') THEN
    RAISE EXCEPTION 'Invalid expense payment method';
  END IF;
  IF p_expense_kind IS NULL
     OR p_expense_kind NOT IN ('recurring', 'one_time') THEN
    RAISE EXCEPTION 'Invalid expense type';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Expense idempotency key is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.expense_categories
    WHERE id = p_category_id
      AND account_id = v_account_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Select an active expense category';
  END IF;
  IF p_receipt_path IS NOT NULL
     AND p_receipt_path NOT LIKE 'account-' || v_account_id::TEXT || '/%' THEN
    RAISE EXCEPTION 'Expense receipt path does not belong to this account';
  END IF;

  RETURN QUERY
  INSERT INTO public.expenses(
    account_id,
    occurred_on,
    amount,
    description,
    category_id,
    method,
    expense_kind,
    receipt_path,
    recorded_by,
    idempotency_key
  )
  VALUES (
    v_account_id,
    p_occurred_on,
    ROUND(p_amount, 2),
    BTRIM(p_description),
    p_category_id,
    p_method,
    p_expense_kind::expense_kind_enum,
    p_receipt_path,
    auth.uid(),
    p_idempotency_key
  )
  ON CONFLICT (account_id, idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_expense(
  p_expense_id UUID,
  p_reason TEXT
)
RETURNS SETOF public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expense public.expenses%ROWTYPE;
BEGIN
  SELECT *
  INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF v_expense.id IS NULL
     OR NOT public.is_account_member(v_expense.account_id, 'admin') THEN
    RAISE EXCEPTION 'Expense not found or access denied';
  END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A void reason is required';
  END IF;

  IF v_expense.status = 'posted' THEN
    UPDATE public.expenses
    SET
      status = 'void',
      voided_at = NOW(),
      voided_by = auth.uid(),
      void_reason = BTRIM(p_reason)
    WHERE id = v_expense.id;
  END IF;

  RETURN QUERY
  SELECT * FROM public.expenses WHERE id = v_expense.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_expense_ledger(
  p_start DATE,
  p_end DATE,
  p_search TEXT DEFAULT NULL,
  p_category_ids UUID[] DEFAULT NULL,
  p_methods TEXT[] DEFAULT NULL,
  p_statuses TEXT[] DEFAULT NULL,
  p_recorded_by UUID[] DEFAULT NULL,
  p_view TEXT DEFAULT 'all',
  p_sort TEXT DEFAULT 'occurred_on',
  p_direction TEXT DEFAULT 'desc',
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT
      expense.id,
      expense.account_id,
      expense.occurred_on,
      expense.amount,
      expense.description,
      expense.category_id,
      category.name AS category_name,
      expense.method,
      expense.expense_kind,
      expense.receipt_path,
      expense.receipt_bucket,
      expense.recorded_by,
      recorder.full_name AS recorded_by_name,
      expense.status,
      expense.voided_at,
      expense.voided_by,
      expense.void_reason,
      expense.idempotency_key,
      expense.created_at,
      expense.updated_at,
      CONCAT(
        '#',
        UPPER(LEFT(REPLACE(expense.id::TEXT, '-', ''), 8))
      ) AS reference
    FROM public.expenses AS expense
    JOIN public.expense_categories AS category
      ON category.id = expense.category_id
     AND category.account_id = expense.account_id
    LEFT JOIN public.profiles AS recorder
      ON recorder.user_id = expense.recorded_by
     AND recorder.account_id = expense.account_id
    WHERE public.is_account_member(expense.account_id)
      AND expense.occurred_on >= p_start
      AND expense.occurred_on < p_end
      AND (
        NULLIF(BTRIM(p_search), '') IS NULL
        OR STRPOS(
          LOWER(CONCAT_WS(
            ' ',
            expense.id::TEXT,
            CONCAT(
              '#',
              UPPER(LEFT(REPLACE(expense.id::TEXT, '-', ''), 8))
            ),
            expense.description,
            category.name,
            expense.expense_kind::TEXT,
            recorder.full_name
          )),
          LOWER(BTRIM(p_search))
        ) > 0
      )
      AND (
        COALESCE(CARDINALITY(p_category_ids), 0) = 0
        OR expense.category_id = ANY(p_category_ids)
      )
      AND (
        COALESCE(CARDINALITY(p_methods), 0) = 0
        OR expense.method = ANY(p_methods)
      )
      AND (
        COALESCE(CARDINALITY(p_statuses), 0) = 0
        OR expense.status::TEXT = ANY(p_statuses)
      )
      AND (
        COALESCE(CARDINALITY(p_recorded_by), 0) = 0
        OR expense.recorded_by = ANY(p_recorded_by)
      )
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE CASE p_view
      WHEN 'recurring' THEN expense_kind = 'recurring'
      WHEN 'one_time' THEN expense_kind = 'one_time'
      ELSE TRUE
    END
  ),
  ranked AS (
    SELECT
      filtered.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_sort = 'expense' AND p_direction = 'asc' THEN reference END ASC,
          CASE WHEN p_sort = 'expense' AND p_direction = 'desc' THEN reference END DESC,
          CASE WHEN p_sort = 'description' AND p_direction = 'asc' THEN LOWER(description) END ASC,
          CASE WHEN p_sort = 'description' AND p_direction = 'desc' THEN LOWER(description) END DESC,
          CASE WHEN p_sort = 'category' AND p_direction = 'asc' THEN LOWER(category_name) END ASC,
          CASE WHEN p_sort = 'category' AND p_direction = 'desc' THEN LOWER(category_name) END DESC,
          CASE WHEN p_sort = 'method' AND p_direction = 'asc' THEN method END ASC,
          CASE WHEN p_sort = 'method' AND p_direction = 'desc' THEN method END DESC,
          CASE WHEN p_sort = 'expense_kind' AND p_direction = 'asc' THEN expense_kind END ASC,
          CASE WHEN p_sort = 'expense_kind' AND p_direction = 'desc' THEN expense_kind END DESC,
          CASE WHEN p_sort = 'amount' AND p_direction = 'asc' THEN amount END ASC,
          CASE WHEN p_sort = 'amount' AND p_direction = 'desc' THEN amount END DESC,
          CASE WHEN p_sort = 'status' AND p_direction = 'asc' THEN status END ASC,
          CASE WHEN p_sort = 'status' AND p_direction = 'desc' THEN status END DESC,
          CASE WHEN p_sort = 'recorded_by' AND p_direction = 'asc'
            THEN LOWER(COALESCE(recorded_by_name, 'Staff')) END ASC,
          CASE WHEN p_sort = 'recorded_by' AND p_direction = 'desc'
            THEN LOWER(COALESCE(recorded_by_name, 'Staff')) END DESC,
          CASE WHEN p_sort = 'occurred_on' AND p_direction = 'asc' THEN occurred_on END ASC,
          CASE WHEN p_sort = 'occurred_on' AND p_direction = 'desc' THEN occurred_on END DESC,
          occurred_on DESC,
          created_at DESC,
          id DESC
      ) AS result_position
    FROM filtered
  ),
  page_rows AS (
    SELECT *
    FROM ranked
    WHERE result_position > GREATEST(p_offset, 0)
      AND result_position <=
        GREATEST(p_offset, 0) + LEAST(GREATEST(p_limit, 1), 500)
  ),
  totals AS (
    SELECT
      COUNT(*)::BIGINT AS expense_count,
      COUNT(*) FILTER (WHERE status = 'posted')::BIGINT AS posted_count,
      COALESCE(SUM(amount) FILTER (WHERE status = 'posted'), 0) AS posted_amount,
      COUNT(*) FILTER (WHERE status = 'void')::BIGINT AS voided_count,
      COALESCE(SUM(amount) FILTER (WHERE status = 'void'), 0) AS voided_amount,
      COUNT(*) FILTER (
        WHERE status = 'posted' AND expense_kind = 'recurring'
      )::BIGINT AS recurring_count,
      COALESCE(SUM(amount) FILTER (
        WHERE status = 'posted' AND expense_kind = 'recurring'
      ), 0) AS recurring_amount,
      COUNT(*) FILTER (
        WHERE status = 'posted' AND expense_kind = 'one_time'
      )::BIGINT AS one_time_count,
      COALESCE(SUM(amount) FILTER (
        WHERE status = 'posted' AND expense_kind = 'one_time'
      ), 0) AS one_time_amount
    FROM filtered
  ),
  facets AS (
    SELECT
      COUNT(*)::BIGINT AS all_count,
      COUNT(*) FILTER (WHERE expense_kind = 'recurring')::BIGINT AS recurring_count,
      COUNT(*) FILTER (WHERE expense_kind = 'one_time')::BIGINT AS one_time_count
    FROM base
  ),
  daily_trend AS (
    SELECT
      occurred_on,
      COALESCE(SUM(amount) FILTER (WHERE status = 'posted'), 0) AS amount
    FROM filtered
    GROUP BY occurred_on
  ),
  category_totals AS (
    SELECT
      category_id,
      category_name,
      COUNT(*) FILTER (WHERE status = 'posted')::BIGINT AS expense_count,
      COALESCE(SUM(amount) FILTER (WHERE status = 'posted'), 0) AS amount
    FROM filtered
    GROUP BY category_id, category_name
    HAVING COUNT(*) FILTER (WHERE status = 'posted') > 0
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows',
    COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(page_rows) - 'result_position'
         ORDER BY result_position) FROM page_rows),
      '[]'::JSONB
    ),
    'summary',
    JSONB_BUILD_OBJECT(
      'count', totals.expense_count,
      'postedCount', totals.posted_count,
      'postedAmount', totals.posted_amount,
      'voidedCount', totals.voided_count,
      'voidedAmount', totals.voided_amount,
      'recurringCount', totals.recurring_count,
      'recurringAmount', totals.recurring_amount,
      'oneTimeCount', totals.one_time_count,
      'oneTimeAmount', totals.one_time_amount
    ),
    'facets',
    JSONB_BUILD_OBJECT(
      'all', facets.all_count,
      'recurring', facets.recurring_count,
      'oneTime', facets.one_time_count
    ),
    'analysis',
    JSONB_BUILD_OBJECT(
      'dailyTrend',
      COALESCE(
        (
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'date', daily_trend.occurred_on,
              'amount', daily_trend.amount
            )
            ORDER BY daily_trend.occurred_on
          )
          FROM daily_trend
        ),
        '[]'::JSONB
      ),
      'categoryTotals',
      COALESCE(
        (
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'categoryId', category_totals.category_id,
              'categoryName', category_totals.category_name,
              'count', category_totals.expense_count,
              'amount', category_totals.amount
            )
            ORDER BY
              category_totals.amount DESC,
              category_totals.category_name ASC
          )
          FROM category_totals
        ),
        '[]'::JSONB
      )
    )
  )
  FROM totals CROSS JOIN facets;
$$;

REVOKE ALL ON FUNCTION public.record_expense(
  DATE, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_expense(
  DATE, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION public.void_expense(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_expense(UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.finance_expense_ledger(
  DATE, DATE, TEXT, UUID[], TEXT[], TEXT[], UUID[], TEXT, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_expense_ledger(
  DATE, DATE, TEXT, UUID[], TEXT[], TEXT[], UUID[], TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  FALSE,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Account members can read expense receipts"
  ON storage.objects;
CREATE POLICY "Account members can read expense receipts"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] LIKE 'account-%'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Admins can upload expense receipts"
  ON storage.objects;
CREATE POLICY "Admins can upload expense receipts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] LIKE 'account-%'
      THEN public.is_account_member(
        SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
        'admin'
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Admins can delete staged expense receipts"
  ON storage.objects;
CREATE POLICY "Admins can delete staged expense receipts"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] LIKE 'account-%'
      THEN
        public.is_account_member(
          SUBSTRING((storage.foldername(name))[1] FROM 9)::UUID,
          'admin'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.expenses
          WHERE receipt_bucket = 'expense-receipts'
            AND receipt_path = storage.objects.name
        )
      ELSE FALSE
    END
  );
