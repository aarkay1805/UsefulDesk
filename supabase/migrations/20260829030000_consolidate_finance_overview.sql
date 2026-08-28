-- Finance Overview previously transferred five complete row sets and rebuilt
-- every summary in the browser. Return the same display contract from one
-- selected-branch, RLS-preserving statement and publish only its real inputs
-- so the client can invalidate the active Finance tab precisely.

CREATE OR REPLACE FUNCTION public.finance_overview_snapshot(
  p_account_id UUID,
  p_month_start DATE,
  p_time_zone TEXT,
  p_today DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL
     OR p_account_id IS DISTINCT FROM private.authorized_selected_account_id()
  THEN
    RAISE EXCEPTION 'Selected branch access is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_month_start IS NULL
     OR DATE_TRUNC('month', p_month_start::TIMESTAMP)::DATE <> p_month_start
  THEN
    RAISE EXCEPTION 'Finance month must start on the first day'
      USING ERRCODE = '22023';
  END IF;

  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Finance today is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH
    ranges AS (
      SELECT
        p_month_start AS month_start,
        (p_month_start - INTERVAL '1 month')::DATE AS previous_start,
        (p_month_start - INTERVAL '1 day')::DATE AS previous_end,
        (p_month_start + INTERVAL '1 month')::DATE AS next_start,
        (p_month_start + INTERVAL '1 month - 1 day')::DATE AS month_end,
        (p_month_start + INTERVAL '2 months')::DATE AS projection_end,
        COALESCE(NULLIF(BTRIM(p_time_zone), ''), 'UTC') AS tz
    ),
    bounds AS (
      SELECT
        range.*,
        range.previous_start::TIMESTAMP AT TIME ZONE range.tz
          AS previous_start_at,
        range.month_start::TIMESTAMP AT TIME ZONE range.tz
          AS current_start_at,
        range.next_start::TIMESTAMP AT TIME ZONE range.tz AS next_start_at,
        LEAST(range.month_end, p_today) AS health_day
      FROM ranges AS range
    ),
    scoped_payments AS MATERIALIZED (
      SELECT
        payment.id,
        payment.membership_id,
        payment.amount,
        payment.method::TEXT AS method,
        payment.paid_at,
        payment.period_end,
        payment.source::TEXT AS source,
        COALESCE(payment.payment_purpose::TEXT, 'other') AS purpose,
        NULLIF(BTRIM(contact.name), '') AS contact_name,
        contact.avatar_url AS contact_avatar_url,
        NULLIF(BTRIM(plan.name), '') AS plan_name,
        membership.member_number,
        membership.start_date AS membership_start_date
      FROM public.payments AS payment
      CROSS JOIN bounds AS bound
      LEFT JOIN public.contacts AS contact
        ON contact.id = payment.contact_id
       AND contact.account_id = payment.account_id
      LEFT JOIN public.membership_plans AS plan
        ON plan.id = payment.plan_id
       AND plan.account_id = payment.account_id
      LEFT JOIN public.memberships AS membership
        ON membership.id = payment.membership_id
       AND membership.account_id = payment.account_id
      WHERE payment.account_id = p_account_id
        AND payment.status = 'paid'
        AND payment.paid_at >= bound.previous_start_at
        AND payment.paid_at < bound.next_start_at
    ),
    scoped_refunds AS MATERIALIZED (
      SELECT
        refund.id,
        refund.amount,
        refund.processed_at,
        COALESCE(payment.method::TEXT, 'other') AS method,
        COALESCE(payment.payment_purpose::TEXT, 'other') AS purpose
      FROM public.payment_refunds AS refund
      CROSS JOIN bounds AS bound
      LEFT JOIN public.payments AS payment
        ON payment.id = refund.payment_id
       AND payment.account_id = refund.account_id
      WHERE refund.account_id = p_account_id
        AND refund.status = 'processed'
        AND refund.processed_at >= bound.previous_start_at
        AND refund.processed_at < bound.next_start_at
    ),
    scoped_invoices AS MATERIALIZED (
      SELECT
        invoice.id,
        invoice.state::TEXT AS state,
        invoice.issued_at,
        invoice.total,
        invoice.amount_paid,
        invoice.credit_applied,
        invoice.balance,
        invoice.requires_refund_review
      FROM public.invoice_balances AS invoice
      CROSS JOIN bounds AS bound
      WHERE invoice.account_id = p_account_id
        AND invoice.issued_at >= bound.current_start_at
        AND invoice.issued_at < bound.next_start_at
    ),
    scoped_expenses AS MATERIALIZED (
      SELECT
        expense.id,
        expense.occurred_on,
        expense.amount,
        expense.description,
        expense.method::TEXT AS method,
        expense.created_at
      FROM public.expenses AS expense
      CROSS JOIN bounds AS bound
      WHERE expense.account_id = p_account_id
        AND expense.status = 'posted'
        AND expense.occurred_on >= bound.previous_start
        AND expense.occurred_on < bound.next_start
    ),
    payment_totals AS (
      SELECT
        COALESCE(SUM(payment.amount) FILTER (
          WHERE payment.paid_at >= bound.current_start_at
        ), 0)::NUMERIC AS current_gross,
        COALESCE(SUM(payment.amount) FILTER (
          WHERE payment.paid_at < bound.current_start_at
        ), 0)::NUMERIC AS previous_gross
      FROM bounds AS bound
      LEFT JOIN scoped_payments AS payment ON TRUE
    ),
    refund_totals AS (
      SELECT
        COALESCE(SUM(refund.amount) FILTER (
          WHERE refund.processed_at >= bound.current_start_at
        ), 0)::NUMERIC AS current_refunds,
        COALESCE(SUM(refund.amount) FILTER (
          WHERE refund.processed_at < bound.current_start_at
        ), 0)::NUMERIC AS previous_refunds
      FROM bounds AS bound
      LEFT JOIN scoped_refunds AS refund ON TRUE
    ),
    expense_totals AS (
      SELECT
        COALESCE(SUM(expense.amount) FILTER (
          WHERE expense.occurred_on >= bound.month_start
        ), 0)::NUMERIC AS current_expenses,
        COALESCE(SUM(expense.amount) FILTER (
          WHERE expense.occurred_on < bound.month_start
        ), 0)::NUMERIC AS previous_expenses
      FROM bounds AS bound
      LEFT JOIN scoped_expenses AS expense ON TRUE
    ),
    purposes(purpose, ordinal) AS (
      VALUES
        ('joining'::TEXT, 1),
        ('renewal'::TEXT, 2),
        ('sale'::TEXT, 3),
        ('due'::TEXT, 4),
        ('other'::TEXT, 5)
    ),
    current_payment_stats AS (
      SELECT
        payment.purpose,
        COUNT(*)::BIGINT AS payments,
        SUM(payment.amount)::NUMERIC AS amount
      FROM scoped_payments AS payment
      CROSS JOIN bounds AS bound
      WHERE payment.paid_at >= bound.current_start_at
      GROUP BY payment.purpose
    ),
    current_refund_stats AS (
      SELECT
        refund.purpose,
        SUM(refund.amount)::NUMERIC AS amount
      FROM scoped_refunds AS refund
      CROSS JOIN bounds AS bound
      WHERE refund.processed_at >= bound.current_start_at
      GROUP BY refund.purpose
    ),
    revenue_stream_rows AS (
      SELECT
        purpose.purpose,
        purpose.ordinal,
        COALESCE(payment.payments, 0)::BIGINT AS payments,
        (
          COALESCE(payment.amount, 0) - COALESCE(refund.amount, 0)
        )::NUMERIC AS amount,
        COALESCE((
          SELECT JSONB_AGG(recent.value ORDER BY recent.paid_at DESC, recent.id DESC)
          FROM (
            SELECT
              row.id,
              row.paid_at,
              JSONB_BUILD_OBJECT(
                'id', row.id,
                'membershipId', row.membership_id,
                'memberNumber', row.member_number,
                'contactName', row.contact_name,
                'contactAvatarUrl', row.contact_avatar_url,
                'planName', row.plan_name,
                'paidAt', row.paid_at,
                'membershipStartDate', row.membership_start_date,
                'periodEnd', row.period_end,
                'method', row.method,
                'source', row.source,
                'amount', row.amount
              ) AS value
            FROM scoped_payments AS row
            CROSS JOIN bounds AS bound
            WHERE row.purpose = purpose.purpose
              AND row.paid_at >= bound.current_start_at
            ORDER BY row.paid_at DESC, row.id DESC
            LIMIT 5
          ) AS recent
        ), '[]'::JSONB) AS recent_payments
      FROM purposes AS purpose
      LEFT JOIN current_payment_stats AS payment USING (purpose)
      LEFT JOIN current_refund_stats AS refund USING (purpose)
    ),
    revenue_sections AS (
      SELECT
        JSONB_OBJECT_AGG(stream.purpose, stream.amount) AS breakdown,
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'purpose', stream.purpose,
            'payments', stream.payments,
            'amount', stream.amount,
            'recentPayments', stream.recent_payments
          ) ORDER BY stream.ordinal
        ) AS streams
      FROM revenue_stream_rows AS stream
    ),
    calendar_days AS (
      SELECT day::DATE AS day
      FROM bounds AS bound
      CROSS JOIN LATERAL GENERATE_SERIES(
        bound.previous_start::TIMESTAMP,
        bound.month_end::TIMESTAMP,
        INTERVAL '1 day'
      ) AS day
    ),
    daily_payments AS (
      SELECT
        (payment.paid_at AT TIME ZONE bound.tz)::DATE AS day,
        SUM(payment.amount)::NUMERIC AS amount
      FROM scoped_payments AS payment
      CROSS JOIN bounds AS bound
      GROUP BY 1
    ),
    daily_refunds AS (
      SELECT
        (refund.processed_at AT TIME ZONE bound.tz)::DATE AS day,
        SUM(refund.amount)::NUMERIC AS amount
      FROM scoped_refunds AS refund
      CROSS JOIN bounds AS bound
      GROUP BY 1
    ),
    daily_expenses AS (
      SELECT expense.occurred_on AS day, SUM(expense.amount)::NUMERIC AS amount
      FROM scoped_expenses AS expense
      GROUP BY expense.occurred_on
    ),
    daily_flow AS (
      SELECT
        calendar.day,
        (
          COALESCE(payment.amount, 0) - COALESCE(refund.amount, 0)
        )::NUMERIC AS income,
        COALESCE(expense.amount, 0)::NUMERIC AS expenses
      FROM calendar_days AS calendar
      LEFT JOIN daily_payments AS payment USING (day)
      LEFT JOIN daily_refunds AS refund USING (day)
      LEFT JOIN daily_expenses AS expense USING (day)
    ),
    flow_sections AS (
      SELECT
        COALESCE(JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'date', flow.day,
            'income', flow.income,
            'expenses', flow.expenses
          ) ORDER BY flow.day
        ) FILTER (WHERE flow.day >= bound.month_start), '[]'::JSONB) AS current,
        COALESCE(JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'date', flow.day,
            'income', flow.income,
            'expenses', flow.expenses
          ) ORDER BY flow.day
        ) FILTER (WHERE flow.day < bound.month_start), '[]'::JSONB) AS previous
      FROM daily_flow AS flow
      CROSS JOIN bounds AS bound
      GROUP BY bound.month_start
    ),
    invoice_health AS (
      SELECT JSONB_BUILD_OBJECT(
        'paid', COUNT(*) FILTER (
          WHERE invoice.state <> 'void'
            AND NOT invoice.requires_refund_review
            AND NOT (
              invoice.total < 0.5
              AND invoice.amount_paid + invoice.credit_applied < 0.5
            )
            AND invoice.balance < 0.5
        ),
        'partiallyPaid', COUNT(*) FILTER (
          WHERE invoice.state <> 'void'
            AND NOT invoice.requires_refund_review
            AND invoice.balance >= 0.5
            AND invoice.amount_paid >= 0.5
        ),
        'overdue', COUNT(*) FILTER (
          WHERE invoice.state <> 'void'
            AND NOT invoice.requires_refund_review
            AND invoice.balance >= 0.5
            AND invoice.amount_paid < 0.5
            AND (invoice.issued_at AT TIME ZONE bound.tz)::DATE < bound.health_day
        ),
        'open', COUNT(*) FILTER (
          WHERE invoice.state <> 'void'
            AND NOT invoice.requires_refund_review
            AND invoice.balance >= 0.5
            AND invoice.amount_paid < 0.5
            AND (invoice.issued_at AT TIME ZONE bound.tz)::DATE >= bound.health_day
        ),
        'outstanding', COALESCE(SUM(invoice.balance) FILTER (
          WHERE invoice.state <> 'void'
            AND NOT invoice.requires_refund_review
            AND invoice.balance >= 0.5
        ), 0),
        'refundReview', COUNT(*) FILTER (
          WHERE invoice.state <> 'void'
            AND invoice.requires_refund_review
        )
      ) AS value
      FROM bounds AS bound
      LEFT JOIN scoped_invoices AS invoice ON TRUE
      GROUP BY bound.tz, bound.health_day
    ),
    projection AS (
      SELECT JSONB_BUILD_OBJECT(
        'amount', COALESCE(SUM(option.price), 0),
        'renewals', COUNT(option.id)
      ) AS value
      FROM bounds AS bound
      LEFT JOIN public.memberships AS membership
        ON membership.account_id = p_account_id
       AND membership.status = 'active'
       AND membership.is_trial = FALSE
       AND membership.end_date >= bound.next_start
       AND membership.end_date < bound.projection_end
       AND membership.start_date <= p_today
       AND membership.end_date > p_today
      LEFT JOIN public.membership_plans AS plan
        ON plan.id = membership.plan_id
       AND plan.account_id = membership.account_id
      LEFT JOIN public.plan_pricing_options AS option
        ON option.id = membership.pricing_option_id
       AND option.account_id = membership.account_id
       AND option.price >= 0.5
      WHERE option.id IS NOT NULL
        AND (plan.id IS NULL OR plan.plan_type = 'recurring')
    ),
    current_method_payments AS (
      SELECT
        CASE WHEN payment.method IN ('bank', 'other')
          THEN 'bank_other' ELSE payment.method END AS method,
        COUNT(*)::BIGINT AS payments,
        SUM(payment.amount)::NUMERIC AS amount,
        MAX(payment.paid_at) AS first_seen_at
      FROM scoped_payments AS payment
      CROSS JOIN bounds AS bound
      WHERE payment.paid_at >= bound.current_start_at
      GROUP BY 1
    ),
    current_method_refunds AS (
      SELECT
        CASE WHEN refund.method IN ('bank', 'other')
          THEN 'bank_other' ELSE refund.method END AS method,
        SUM(refund.amount)::NUMERIC AS amount,
        MAX(refund.processed_at) AS first_seen_at
      FROM scoped_refunds AS refund
      CROSS JOIN bounds AS bound
      WHERE refund.processed_at >= bound.current_start_at
      GROUP BY 1
    ),
    collection_methods AS (
      SELECT COALESCE(JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'method', COALESCE(payment.method, refund.method),
          'payments', COALESCE(payment.payments, 0),
          'amount', COALESCE(payment.amount, 0) - COALESCE(refund.amount, 0)
        ) ORDER BY
          COALESCE(payment.amount, 0) - COALESCE(refund.amount, 0) DESC,
          (payment.method IS NOT NULL) DESC,
          COALESCE(payment.first_seen_at, refund.first_seen_at) DESC,
          COALESCE(payment.method, refund.method)
      ), '[]'::JSONB) AS value
      FROM current_method_payments AS payment
      FULL JOIN current_method_refunds AS refund USING (method)
    ),
    recent_transaction_rows AS (
      SELECT
        payment.paid_at AS occurred_sort,
        1 AS source_rank,
        ROW_NUMBER() OVER (ORDER BY payment.paid_at DESC) AS source_order,
        JSONB_BUILD_OBJECT(
          'id', payment.id,
          'occurredAt', payment.paid_at,
          'description', COALESCE(payment.contact_name, 'Deleted member'),
          'kind', 'membership',
          'method', CASE WHEN payment.method IN ('bank', 'other')
            THEN 'bank_other' ELSE payment.method END,
          'amount', payment.amount,
          'paymentPurpose', payment.purpose
        ) AS value
      FROM scoped_payments AS payment
      CROSS JOIN bounds AS bound
      WHERE payment.paid_at >= bound.current_start_at

      UNION ALL

      SELECT
        refund.processed_at,
        2,
        ROW_NUMBER() OVER (ORDER BY refund.processed_at DESC),
        JSONB_BUILD_OBJECT(
          'id', refund.id,
          'occurredAt', refund.processed_at,
          'description', 'Razorpay refund',
          'kind', 'refund',
          'method', CASE WHEN refund.method IN ('bank', 'other')
            THEN 'bank_other' ELSE refund.method END,
          'amount', refund.amount,
          'paymentPurpose', refund.purpose
        )
      FROM scoped_refunds AS refund
      CROSS JOIN bounds AS bound
      WHERE refund.processed_at >= bound.current_start_at

      UNION ALL

      SELECT
        expense.occurred_on::TIMESTAMP AT TIME ZONE bound.tz,
        3,
        ROW_NUMBER() OVER (
          ORDER BY expense.occurred_on DESC, expense.created_at DESC
        ),
        JSONB_BUILD_OBJECT(
          'id', expense.id,
          'occurredAt', expense.occurred_on,
          'description', expense.description,
          'kind', 'expense',
          'method', CASE WHEN expense.method IN ('bank', 'other')
            THEN 'bank_other' ELSE expense.method END,
          'amount', expense.amount
        )
      FROM scoped_expenses AS expense
      CROSS JOIN bounds AS bound
      WHERE expense.occurred_on >= bound.month_start
    ),
    recent_transactions AS (
      SELECT COALESCE(JSONB_AGG(row.value ORDER BY
        row.occurred_sort DESC,
        row.source_rank,
        row.source_order
      ), '[]'::JSONB) AS value
      FROM (
        SELECT transaction.*
        FROM recent_transaction_rows AS transaction
        ORDER BY
          transaction.occurred_sort DESC,
          transaction.source_rank,
          transaction.source_order
        LIMIT 4
      ) AS row
    )
    SELECT JSONB_BUILD_OBJECT(
      'period', JSONB_BUILD_OBJECT(
        'month', TO_CHAR(bound.month_start, 'YYYY-MM'),
        'start', bound.month_start,
        'end', bound.month_end,
        'nextStart', bound.next_start,
        'previousStart', bound.previous_start,
        'previousEnd', bound.previous_end
      ),
      'revenue', JSONB_BUILD_OBJECT(
        'current', payment.current_gross - refund.current_refunds,
        'previous', payment.previous_gross - refund.previous_refunds,
        'grossCurrent', payment.current_gross,
        'grossPrevious', payment.previous_gross,
        'refundsCurrent', refund.current_refunds,
        'refundsPrevious', refund.previous_refunds
      ),
      'expenses', JSONB_BUILD_OBJECT(
        'current', expense.current_expenses,
        'previous', expense.previous_expenses
      ),
      'profit', JSONB_BUILD_OBJECT(
        'current', payment.current_gross - refund.current_refunds
          - expense.current_expenses,
        'previous', payment.previous_gross - refund.previous_refunds
          - expense.previous_expenses
      ),
      'projection', projection.value,
      'revenueBreakdown', revenue.breakdown,
      'revenueStreams', revenue.streams,
      'trend', flow.current,
      'previousTrend', flow.previous,
      'comparisonThroughDay', CASE
        WHEN TO_CHAR(p_today, 'YYYY-MM') = TO_CHAR(bound.month_start, 'YYYY-MM')
          THEN EXTRACT(DAY FROM p_today)::INTEGER
        ELSE NULL
      END,
      'invoiceHealth', health.value,
      'collectionMethods', methods.value,
      'recentTransactions', recent.value
    )
    FROM bounds AS bound
    CROSS JOIN payment_totals AS payment
    CROSS JOIN refund_totals AS refund
    CROSS JOIN expense_totals AS expense
    CROSS JOIN revenue_sections AS revenue
    CROSS JOIN flow_sections AS flow
    CROSS JOIN invoice_health AS health
    CROSS JOIN projection
    CROSS JOIN collection_methods AS methods
    CROSS JOIN recent_transactions AS recent
  );
END;
$$;

ALTER FUNCTION public.finance_overview_snapshot(UUID, DATE, TEXT, DATE)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finance_overview_snapshot(UUID, DATE, TEXT, DATE)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finance_overview_snapshot(UUID, DATE, TEXT, DATE)
  TO authenticated;

COMMENT ON FUNCTION public.finance_overview_snapshot(UUID, DATE, TEXT, DATE)
IS 'Selected-branch Finance Overview display snapshot; SECURITY INVOKER keeps table RLS authoritative for every authenticated role.';

DO $$
DECLARE
  v_table TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    FOREACH v_table IN ARRAY ARRAY[
      'payment_refunds',
      'invoices',
      'invoice_lines',
      'invoice_credit_allocations',
      'invoice_adjustment_allocations',
      'contacts',
      'membership_plans',
      'plan_pricing_options',
      'expenses',
      'expense_categories'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      ) THEN
        EXECUTE FORMAT(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          v_table
        );
      END IF;
    END LOOP;
  END IF;
END
$$;
