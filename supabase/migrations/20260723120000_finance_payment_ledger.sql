-- Finance Payments is an analytical, account-wide read model over the
-- append-only payments ledger. The function keeps pagination, filters,
-- facets, and totals on the same database snapshot while every caller is
-- still scoped through is_account_member + the underlying table RLS.

DROP FUNCTION IF EXISTS public.finance_payment_ledger(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT[],
  TEXT[],
  TEXT[],
  UUID[],
  UUID[],
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER
);

CREATE FUNCTION public.finance_payment_ledger(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_search TEXT DEFAULT NULL,
  p_methods TEXT[] DEFAULT NULL,
  p_statuses TEXT[] DEFAULT NULL,
  p_sources TEXT[] DEFAULT NULL,
  p_plan_ids UUID[] DEFAULT NULL,
  p_recorded_by UUID[] DEFAULT NULL,
  p_view TEXT DEFAULT 'all',
  p_sort TEXT DEFAULT 'paid_on',
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
      payment.id,
      payment.account_id,
      payment.membership_id,
      payment.contact_id,
      payment.plan_id,
      payment.user_id,
      payment.amount,
      payment.method,
      payment.status,
      payment.paid_at,
      payment.period_start,
      payment.period_end,
      payment.screenshot_url,
      payment.screenshot_path,
      payment.receipt_bucket,
      payment.note,
      payment.source,
      payment.mandate_id,
      payment.gateway_payment_id,
      payment.voided_at,
      payment.voided_by,
      payment.void_reason,
      payment.created_at,
      CONCAT(
        '#',
        UPPER(LEFT(REPLACE(payment.id::TEXT, '-', ''), 8))
      ) AS reference,
      membership.member_number,
      contact.name AS contact_name,
      contact.phone AS contact_phone,
      contact.avatar_url AS contact_avatar_url,
      plan.name AS plan_name,
      recorder.full_name AS recorded_by_name
    FROM public.payments AS payment
    LEFT JOIN public.contacts AS contact
      ON contact.id = payment.contact_id
     AND contact.account_id = payment.account_id
    LEFT JOIN public.memberships AS membership
      ON membership.id = payment.membership_id
     AND membership.account_id = payment.account_id
    LEFT JOIN public.membership_plans AS plan
      ON plan.id = payment.plan_id
     AND plan.account_id = payment.account_id
    LEFT JOIN public.profiles AS recorder
      ON recorder.user_id = payment.user_id
     AND recorder.account_id = payment.account_id
    WHERE public.is_account_member(payment.account_id)
      AND payment.paid_at >= p_start
      AND payment.paid_at < p_end
      AND (
        NULLIF(BTRIM(p_search), '') IS NULL
        OR STRPOS(
          LOWER(
            CONCAT_WS(
              ' ',
              payment.id::TEXT,
              CONCAT(
                '#',
                UPPER(LEFT(REPLACE(payment.id::TEXT, '-', ''), 8))
              ),
              payment.gateway_payment_id,
              contact.name,
              contact.phone,
              membership.member_number::TEXT
            )
          ),
          LOWER(BTRIM(p_search))
        ) > 0
      )
      AND (
        COALESCE(CARDINALITY(p_methods), 0) = 0
        OR payment.method = ANY(p_methods)
      )
      AND (
        COALESCE(CARDINALITY(p_statuses), 0) = 0
        OR payment.status = ANY(p_statuses)
      )
      AND (
        COALESCE(CARDINALITY(p_sources), 0) = 0
        OR payment.source = ANY(p_sources)
      )
      AND (
        COALESCE(CARDINALITY(p_plan_ids), 0) = 0
        OR payment.plan_id = ANY(p_plan_ids)
      )
      AND (
        COALESCE(CARDINALITY(p_recorded_by), 0) = 0
        OR payment.user_id = ANY(p_recorded_by)
      )
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE CASE p_view
      WHEN 'collected' THEN status = 'paid'
      WHEN 'autopay' THEN status = 'paid' AND source = 'auto'
      WHEN 'voided' THEN status = 'void'
      ELSE TRUE
    END
  ),
  ranked AS (
    SELECT
      filtered.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN p_sort = 'payment' AND p_direction = 'asc'
              THEN reference
          END ASC,
          CASE
            WHEN p_sort = 'payment' AND p_direction = 'desc'
              THEN reference
          END DESC,
          CASE
            WHEN p_sort = 'name' AND p_direction = 'asc'
              THEN LOWER(COALESCE(contact_name, ''))
          END ASC,
          CASE
            WHEN p_sort = 'name' AND p_direction = 'desc'
              THEN LOWER(COALESCE(contact_name, ''))
          END DESC,
          CASE
            WHEN p_sort = 'plan' AND p_direction = 'asc'
              THEN LOWER(COALESCE(plan_name, ''))
          END ASC,
          CASE
            WHEN p_sort = 'plan' AND p_direction = 'desc'
              THEN LOWER(COALESCE(plan_name, ''))
          END DESC,
          CASE
            WHEN p_sort = 'method' AND p_direction = 'asc'
              THEN method
          END ASC,
          CASE
            WHEN p_sort = 'method' AND p_direction = 'desc'
              THEN method
          END DESC,
          CASE
            WHEN p_sort = 'source' AND p_direction = 'asc'
              THEN source
          END ASC,
          CASE
            WHEN p_sort = 'source' AND p_direction = 'desc'
              THEN source
          END DESC,
          CASE
            WHEN p_sort = 'status' AND p_direction = 'asc'
              THEN status
          END ASC,
          CASE
            WHEN p_sort = 'status' AND p_direction = 'desc'
              THEN status
          END DESC,
          CASE
            WHEN p_sort = 'recorded_by' AND p_direction = 'asc'
              THEN LOWER(
                COALESCE(
                  recorded_by_name,
                  CASE WHEN source = 'auto' THEN 'Auto-pay' ELSE 'Staff' END
                )
              )
          END ASC,
          CASE
            WHEN p_sort = 'recorded_by' AND p_direction = 'desc'
              THEN LOWER(
                COALESCE(
                  recorded_by_name,
                  CASE WHEN source = 'auto' THEN 'Auto-pay' ELSE 'Staff' END
                )
              )
          END DESC,
          CASE
            WHEN p_sort = 'amount' AND p_direction = 'asc'
              THEN amount
          END ASC,
          CASE
            WHEN p_sort = 'amount' AND p_direction = 'desc'
              THEN amount
          END DESC,
          CASE
            WHEN p_sort = 'paid_on' AND p_direction = 'asc'
              THEN paid_at
          END ASC,
          CASE
            WHEN p_sort = 'paid_on' AND p_direction = 'desc'
              THEN paid_at
          END DESC,
          paid_at DESC,
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
      COUNT(*)::BIGINT AS payment_count,
      COUNT(*) FILTER (WHERE status = 'paid')::BIGINT AS collected_count,
      COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS collected,
      COUNT(*) FILTER (WHERE status = 'void')::BIGINT AS voided_count,
      COALESCE(SUM(amount) FILTER (WHERE status = 'void'), 0) AS voided_amount,
      COALESCE(
        SUM(amount) FILTER (WHERE status = 'paid' AND source = 'auto'),
        0
      ) AS autopay
    FROM filtered
  ),
  facets AS (
    SELECT
      COUNT(*)::BIGINT AS all_count,
      COUNT(*) FILTER (WHERE status = 'paid')::BIGINT AS collected_count,
      COUNT(*) FILTER (
        WHERE status = 'paid' AND source = 'auto'
      )::BIGINT AS autopay_count,
      COUNT(*) FILTER (WHERE status = 'void')::BIGINT AS voided_count
    FROM base
  ),
  method_mix AS (
    SELECT
      method_order.method,
      method_order.sort_order,
      COUNT(filtered.id) FILTER (WHERE filtered.status = 'paid')::BIGINT
        AS payments,
      COALESCE(
        SUM(filtered.amount) FILTER (WHERE filtered.status = 'paid'),
        0
      ) AS amount
    FROM (
      VALUES
        ('upi', 1),
        ('cash', 2),
        ('card', 3),
        ('bank_other', 4)
    ) AS method_order(method, sort_order)
    LEFT JOIN filtered
      ON CASE
        WHEN filtered.method IN ('bank', 'other') THEN 'bank_other'
        ELSE filtered.method
      END = method_order.method
    GROUP BY method_order.method, method_order.sort_order
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows',
    COALESCE(
      (
        SELECT JSONB_AGG(
          TO_JSONB(page_rows) - 'result_position'
          ORDER BY result_position
        )
        FROM page_rows
      ),
      '[]'::JSONB
    ),
    'summary',
    (
      SELECT JSONB_BUILD_OBJECT(
        'count', payment_count,
        'collectedCount', collected_count,
        'collected', collected,
        'voidedCount', voided_count,
        'voidedAmount', voided_amount,
        'autopay', autopay,
        'methodMix',
        (
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'method', method,
              'payments', payments,
              'amount', amount
            )
            ORDER BY sort_order
          )
          FROM method_mix
        )
      )
      FROM totals
    ),
    'facets',
    (
      SELECT JSONB_BUILD_OBJECT(
        'all', all_count,
        'collected', collected_count,
        'autopay', autopay_count,
        'voided', voided_count
      )
      FROM facets
    )
  );
$$;

COMMENT ON FUNCTION public.finance_payment_ledger(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT[],
  TEXT[],
  TEXT[],
  UUID[],
  UUID[],
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER
) IS
  'Tenant-scoped analytical payment ledger page with exact filtered totals and quick-view facets.';

REVOKE ALL ON FUNCTION public.finance_payment_ledger(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT[],
  TEXT[],
  TEXT[],
  UUID[],
  UUID[],
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.finance_payment_ledger(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT[],
  TEXT[],
  TEXT[],
  UUID[],
  UUID[],
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER
) TO authenticated;
