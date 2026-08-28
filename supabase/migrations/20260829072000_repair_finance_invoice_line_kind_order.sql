-- Forward repair: UUID has no min() aggregate. Cast the invoice-line UUID
-- to text only for a deterministic export label tie-break; ledger facts are
-- unchanged.

-- Finance Invoices previously loaded the complete month through seven browser
-- requests before client-side filtering, sorting, summary work, and 25-row
-- pagination. Keep the existing refund/allocation-aware balance views and RLS,
-- but project one bounded page plus the exact list metadata in one statement.

CREATE OR REPLACE FUNCTION public.finance_invoice_ledger_page(
  p_month_start DATE,
  p_time_zone TEXT,
  p_today DATE,
  p_search TEXT,
  p_queue TEXT,
  p_payment_states TEXT[],
  p_plan_ids UUID[],
  p_collection_modes TEXT[],
  p_sort_key TEXT,
  p_sort_direction TEXT,
  p_page INTEGER,
  p_page_size INTEGER,
  p_mode TEXT DEFAULT 'listing'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mode TEXT := COALESCE(p_mode, 'listing');
  v_search TEXT := pg_catalog.btrim(COALESCE(p_search, ''));
  v_queue TEXT := COALESCE(p_queue, 'all');
  v_payment_states TEXT[] := COALESCE(p_payment_states, ARRAY[]::TEXT[]);
  v_plan_ids UUID[] := COALESCE(p_plan_ids, ARRAY[]::UUID[]);
  v_collection_modes TEXT[] := COALESCE(
    p_collection_modes,
    ARRAY[]::TEXT[]
  );
  v_sort_key TEXT := COALESCE(p_sort_key, 'issued_on');
  v_sort_direction TEXT := COALESCE(p_sort_direction, 'desc');
  v_account_id UUID;
  v_month_start_at TIMESTAMPTZ;
  v_next_month_start_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF p_month_start IS NULL
     OR pg_catalog.date_trunc(
       'month',
       p_month_start::TIMESTAMP
     )::DATE <> p_month_start
  THEN
    RAISE EXCEPTION 'Finance invoice month must start on the first day'
      USING ERRCODE = '22023';
  END IF;

  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Finance invoice date is required'
      USING ERRCODE = '22004';
  END IF;

  IF p_time_zone IS NULL OR pg_catalog.btrim(p_time_zone) = '' THEN
    RAISE EXCEPTION 'Finance invoice time zone is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names AS timezone
    WHERE timezone.name = pg_catalog.btrim(p_time_zone)
  ) THEN
    RAISE EXCEPTION 'Finance invoice time zone is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_mode NOT IN ('listing', 'export') THEN
    RAISE EXCEPTION 'Finance invoice mode is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_queue NOT IN ('all', 'attention', 'paid', 'upcoming', 'void') THEN
    RAISE EXCEPTION 'Finance invoice queue is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_payment_states <@ ARRAY['paid', 'due', 'no_charge']::TEXT[] THEN
    RAISE EXCEPTION 'Finance invoice payment-status filter is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_collection_modes <@ ARRAY['manual', 'auto']::TEXT[] THEN
    RAISE EXCEPTION 'Finance invoice collection-mode filter is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_sort_key NOT IN (
    'reference',
    'name',
    'member_id',
    'plan',
    'period',
    'issued_on',
    'total',
    'paid',
    'balance'
  ) THEN
    RAISE EXCEPTION 'Finance invoice sort is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Finance invoice sort direction is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_page IS NULL OR p_page < 0 THEN
    RAISE EXCEPTION 'Finance invoice page must be zero or greater'
      USING ERRCODE = '22023';
  END IF;

  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 500 THEN
    RAISE EXCEPTION 'Finance invoice page size must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  v_account_id := private.authorized_selected_account_id(
    CASE
      WHEN v_mode = 'export' THEN 'admin'::public.account_role_enum
      ELSE 'viewer'::public.account_role_enum
    END
  );
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Selected branch access is required'
      USING ERRCODE = '42501';
  END IF;

  v_month_start_at := p_month_start::TIMESTAMP
    AT TIME ZONE pg_catalog.btrim(p_time_zone);
  v_next_month_start_at := (p_month_start + INTERVAL '1 month')::TIMESTAMP
    AT TIME ZONE pg_catalog.btrim(p_time_zone);

  WITH
  month_rows AS MATERIALIZED (
    SELECT
      invoice.id,
      invoice.account_id,
      invoice.contact_id,
      invoice.membership_id,
      period.plan_id,
      COALESCE(
        period.period_start,
        (invoice.issued_at AT TIME ZONE pg_catalog.btrim(p_time_zone))::DATE
      ) AS period_start,
      COALESCE(
        period.period_end,
        (invoice.issued_at AT TIME ZONE pg_catalog.btrim(p_time_zone))::DATE
      ) AS period_end,
      invoice.total AS fee_amount,
      invoice.state::TEXT AS state,
      invoice.issued_at AS created_at,
      invoice.amount_paid,
      invoice.credit_applied,
      invoice.balance,
      invoice.gross_amount_paid,
      invoice.processed_refund_amount,
      invoice.invoice_adjustment_amount,
      invoice.accounting_balance,
      invoice.collectible_balance,
      invoice.requires_refund_review,
      invoice.invoice_sequence,
      invoice.invoice_number,
      invoice.seller_snapshot,
      invoice.customer_snapshot,
      invoice.identity_snapshot_version,
      invoice.source::TEXT AS source,
      COALESCE(
        invoice.invoice_number,
        '#' || pg_catalog.upper(pg_catalog.left(invoice.id::TEXT, 8))
      ) AS reference,
      CASE
        WHEN invoice.state = 'void' THEN 'void'
        WHEN COALESCE(
          period.period_start,
          (invoice.issued_at AT TIME ZONE pg_catalog.btrim(p_time_zone))::DATE
        ) > p_today THEN 'upcoming'
        WHEN membership.end_date IS NOT NULL
         AND COALESCE(
           period.period_end,
           (invoice.issued_at AT TIME ZONE pg_catalog.btrim(p_time_zone))::DATE
         ) = membership.end_date THEN 'current'
        ELSE 'past'
      END AS lifecycle,
      CASE
        WHEN invoice.total < 0.5 AND invoice.amount_paid < 0.5
          THEN 'no_charge'
        WHEN invoice.balance >= 0.5 THEN 'due'
        ELSE 'paid'
      END AS payment_state,
      (
        invoice.state = 'open'
        AND invoice.balance >= 0.5
        AND COALESCE(
          period.period_end,
          (invoice.issued_at AT TIME ZONE pg_catalog.btrim(p_time_zone))::DATE
        ) < p_today
      ) AS overdue,
      membership.id AS hydrated_membership_id,
      membership.contact_id AS membership_contact_id,
      membership.member_number,
      membership.user_id AS membership_user_id,
      membership.plan_id AS membership_plan_id,
      membership.start_date AS membership_start_date,
      membership.end_date AS membership_end_date,
      membership.status::TEXT AS membership_status,
      membership.fee_amount AS membership_fee_amount,
      membership.fee_status::TEXT AS membership_fee_status,
      membership.frozen_at AS membership_frozen_at,
      membership.is_trial AS membership_is_trial,
      COALESCE(membership.collection_mode::TEXT, 'manual')
        AS collection_mode,
      membership.created_at AS membership_created_at,
      membership.updated_at AS membership_updated_at,
      membership_contact.name AS membership_contact_name,
      COALESCE(membership_contact.id, invoice_contact.id) AS customer_id,
      COALESCE(
        membership_contact.account_id,
        invoice_contact.account_id
      ) AS customer_account_id,
      COALESCE(membership_contact.user_id, invoice_contact.user_id)
        AS customer_user_id,
      COALESCE(membership_contact.name, invoice_contact.name)
        AS customer_name,
      COALESCE(membership_contact.phone, invoice_contact.phone)
        AS customer_phone,
      COALESCE(membership_contact.avatar_url, invoice_contact.avatar_url)
        AS customer_avatar_url,
      COALESCE(membership_contact.created_at, invoice_contact.created_at)
        AS customer_created_at,
      COALESCE(membership_contact.updated_at, invoice_contact.updated_at)
        AS customer_updated_at,
      plan.id AS current_plan_id,
      plan.account_id AS current_plan_account_id,
      plan.name AS current_plan_name
    FROM public.invoice_balances AS invoice
    LEFT JOIN public.membership_periods AS period
      ON period.id = invoice.membership_period_id
     AND period.account_id = invoice.account_id
    LEFT JOIN public.memberships AS membership
      ON membership.id = invoice.membership_id
     AND membership.account_id = invoice.account_id
    LEFT JOIN public.contacts AS membership_contact
      ON membership_contact.id = membership.contact_id
     AND membership_contact.account_id = invoice.account_id
    LEFT JOIN public.contacts AS invoice_contact
      ON invoice_contact.id = invoice.contact_id
     AND invoice_contact.account_id = invoice.account_id
    LEFT JOIN public.membership_plans AS plan
      ON plan.id = membership.plan_id
     AND plan.account_id = invoice.account_id
    WHERE invoice.account_id = v_account_id
      AND invoice.issued_at >= v_month_start_at
      AND invoice.issued_at < v_next_month_start_at
  ),
  available_rows AS MATERIALIZED (
    SELECT row.*
    FROM month_rows AS row
    WHERE (
        v_search = ''
        OR pg_catalog.strpos(
          pg_catalog.lower(row.reference COLLATE "und-x-icu"),
          pg_catalog.lower(v_search COLLATE "und-x-icu")
        ) > 0
        OR pg_catalog.strpos(
          pg_catalog.lower(row.id::TEXT COLLATE "und-x-icu"),
          pg_catalog.lower(v_search COLLATE "und-x-icu")
        ) > 0
        OR pg_catalog.strpos(
          pg_catalog.lower(COALESCE(row.customer_name, '') COLLATE "und-x-icu"),
          pg_catalog.lower(v_search COLLATE "und-x-icu")
        ) > 0
        OR pg_catalog.strpos(
          pg_catalog.lower(COALESCE(row.customer_phone, '') COLLATE "und-x-icu"),
          pg_catalog.lower(v_search COLLATE "und-x-icu")
        ) > 0
        OR pg_catalog.strpos(
          COALESCE(row.member_number::TEXT, ''),
          v_search
        ) > 0
      )
      AND (
        pg_catalog.cardinality(v_payment_states) = 0
        OR row.payment_state = ANY(v_payment_states)
      )
      AND (
        pg_catalog.cardinality(v_plan_ids) = 0
        OR row.plan_id = ANY(v_plan_ids)
      )
      AND (
        pg_catalog.cardinality(v_collection_modes) = 0
        OR row.collection_mode = ANY(v_collection_modes)
      )
  ),
  matched_rows AS MATERIALIZED (
    SELECT row.*
    FROM available_rows AS row
    WHERE v_queue = 'all'
       OR (
         v_queue = 'attention'
         AND (
           row.requires_refund_review
           OR row.overdue
           OR (
             row.state = 'open'
             AND row.payment_state = 'due'
             AND row.lifecycle <> 'upcoming'
           )
         )
       )
       OR (
         v_queue = 'paid'
         AND row.state = 'open'
         AND NOT row.requires_refund_review
         AND row.payment_state = 'paid'
       )
       OR (
         v_queue = 'upcoming'
         AND row.state = 'open'
         AND NOT row.requires_refund_review
         AND row.lifecycle = 'upcoming'
       )
       OR (v_queue = 'void' AND row.state = 'void')
  ),
  page_context AS MATERIALIZED (
    SELECT
      total.total_count,
      LEAST(
        p_page,
        GREATEST(
          pg_catalog.ceil(total.total_count::NUMERIC / p_page_size)::INTEGER - 1,
          0
        )
      ) AS page
    FROM (
      SELECT pg_catalog.count(*)::BIGINT AS total_count
      FROM matched_rows
    ) AS total
  ),
  ordered_rows AS MATERIALIZED (
    SELECT
      row.*,
      pg_catalog.row_number() OVER (
        ORDER BY
          CASE WHEN v_sort_key = 'reference'
            THEN (row.invoice_sequence IS NULL)::INTEGER END ASC,
          CASE WHEN v_sort_key = 'reference' AND v_sort_direction = 'asc'
            THEN row.invoice_sequence END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'reference' AND v_sort_direction = 'desc'
            THEN row.invoice_sequence END DESC NULLS LAST,
          CASE WHEN v_sort_key = 'reference' AND v_sort_direction = 'asc'
            THEN row.reference COLLATE "und-x-icu" END ASC,
          CASE WHEN v_sort_key = 'reference' AND v_sort_direction = 'desc'
            THEN row.reference COLLATE "und-x-icu" END DESC,
          CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'asc'
            THEN COALESCE(row.membership_contact_name, '') COLLATE "und-x-icu"
            END ASC,
          CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'desc'
            THEN COALESCE(row.membership_contact_name, '') COLLATE "und-x-icu"
            END DESC,
          CASE WHEN v_sort_key = 'member_id' AND v_sort_direction = 'asc'
            THEN COALESCE(row.member_number, 0) END ASC,
          CASE WHEN v_sort_key = 'member_id' AND v_sort_direction = 'desc'
            THEN COALESCE(row.member_number, 0) END DESC,
          CASE WHEN v_sort_key = 'plan' AND v_sort_direction = 'asc'
            THEN COALESCE(row.current_plan_name, '') COLLATE "und-x-icu"
            END ASC,
          CASE WHEN v_sort_key = 'plan' AND v_sort_direction = 'desc'
            THEN COALESCE(row.current_plan_name, '') COLLATE "und-x-icu"
            END DESC,
          CASE WHEN v_sort_key = 'period' AND v_sort_direction = 'asc'
            THEN row.period_start END ASC,
          CASE WHEN v_sort_key = 'period' AND v_sort_direction = 'desc'
            THEN row.period_start END DESC,
          CASE WHEN v_sort_key = 'issued_on' AND v_sort_direction = 'asc'
            THEN row.created_at END ASC,
          CASE WHEN v_sort_key = 'issued_on' AND v_sort_direction = 'desc'
            THEN row.created_at END DESC,
          CASE WHEN v_sort_key = 'total' AND v_sort_direction = 'asc'
            THEN row.fee_amount END ASC,
          CASE WHEN v_sort_key = 'total' AND v_sort_direction = 'desc'
            THEN row.fee_amount END DESC,
          CASE WHEN v_sort_key = 'paid' AND v_sort_direction = 'asc'
            THEN row.amount_paid END ASC,
          CASE WHEN v_sort_key = 'paid' AND v_sort_direction = 'desc'
            THEN row.amount_paid END DESC,
          CASE WHEN v_sort_key = 'balance' AND v_sort_direction = 'asc'
            THEN row.balance END ASC,
          CASE WHEN v_sort_key = 'balance' AND v_sort_direction = 'desc'
            THEN row.balance END DESC,
          row.created_at DESC,
          row.id DESC
      ) AS page_ordinal
    FROM matched_rows AS row
  ),
  page_rows AS MATERIALIZED (
    SELECT row.*
    FROM ordered_rows AS row
    CROSS JOIN page_context AS context
    WHERE row.page_ordinal > (context.page::BIGINT * p_page_size)
      AND row.page_ordinal <= ((context.page::BIGINT + 1) * p_page_size)
  ),
  export_line_details AS (
    SELECT
      line.invoice_id,
      pg_catalog.jsonb_agg(
        line.kind
        ORDER BY line.sort_order, line.id
      ) AS line_kinds
    FROM (
      SELECT
        source.invoice_id,
        source.kind::TEXT AS kind,
        pg_catalog.min(source.sort_order) AS sort_order,
        pg_catalog.min(source.id::TEXT) AS id
      FROM public.invoice_lines AS source
      WHERE v_mode = 'export'
        AND source.account_id = v_account_id
        AND source.state = 'active'
        AND source.invoice_id IN (SELECT row.id FROM page_rows AS row)
      GROUP BY source.invoice_id, source.kind
    ) AS line
    GROUP BY line.invoice_id
  ),
  export_payment_details AS (
    SELECT
      payment.invoice_id,
      pg_catalog.jsonb_agg(
        payment.gateway_payment_id
        ORDER BY payment.paid_at, payment.id
      ) FILTER (WHERE payment.gateway_payment_id IS NOT NULL)
        AS gateway_payment_ids
    FROM public.payments AS payment
    WHERE v_mode = 'export'
      AND payment.account_id = v_account_id
      AND payment.invoice_id IN (SELECT row.id FROM page_rows AS row)
    GROUP BY payment.invoice_id
  ),
  export_refund_details AS (
    SELECT
      refund.invoice_id,
      pg_catalog.jsonb_agg(
        refund.gateway_refund_id
        ORDER BY refund.created_at, refund.id
      ) AS gateway_refund_ids,
      pg_catalog.jsonb_agg(
        refund.disposition
        ORDER BY refund.created_at, refund.id
      ) FILTER (WHERE refund.disposition IS NOT NULL)
        AS refund_dispositions
    FROM public.payment_refunds AS refund
    WHERE v_mode = 'export'
      AND refund.account_id = v_account_id
      AND refund.status = 'processed'
      AND refund.gateway_refund_id IS NOT NULL
      AND refund.invoice_id IN (SELECT row.id FROM page_rows AS row)
    GROUP BY refund.invoice_id
  ),
  serialized_rows AS (
    SELECT
      row.page_ordinal,
      pg_catalog.jsonb_build_object(
        'id', row.id,
        'account_id', row.account_id,
        'membership_id', COALESCE(row.membership_id::TEXT, ''),
        'contact_id', COALESCE(row.contact_id::TEXT, ''),
        'plan_id', row.plan_id,
        'period_start', row.period_start,
        'period_end', row.period_end,
        'fee_amount', row.fee_amount,
        'state', row.state,
        'created_at', row.created_at,
        'amount_paid', row.amount_paid,
        'credit_applied', row.credit_applied,
        'balance', row.balance,
        'gross_amount_paid', row.gross_amount_paid,
        'processed_refund_amount', row.processed_refund_amount,
        'invoice_adjustment_amount', row.invoice_adjustment_amount,
        'accounting_balance', row.accounting_balance,
        'collectible_balance', row.collectible_balance,
        'requires_refund_review', row.requires_refund_review,
        'invoice_sequence', row.invoice_sequence,
        'invoice_number', row.invoice_number,
        'seller_snapshot', row.seller_snapshot,
        'customer_snapshot', row.customer_snapshot,
        'identity_snapshot_version', row.identity_snapshot_version,
        'membership', CASE
          WHEN row.hydrated_membership_id IS NULL THEN NULL
          ELSE pg_catalog.jsonb_build_object(
            'id', row.hydrated_membership_id,
            'account_id', row.account_id,
            'contact_id', row.membership_contact_id,
            'member_number', row.member_number,
            'user_id', row.membership_user_id,
            'plan_id', row.membership_plan_id,
            'start_date', row.membership_start_date,
            'end_date', row.membership_end_date,
            'status', row.membership_status,
            'fee_amount', row.membership_fee_amount,
            'fee_status', row.membership_fee_status,
            'frozen_at', row.membership_frozen_at,
            'is_trial', row.membership_is_trial,
            'collection_mode', row.collection_mode,
            'created_at', row.membership_created_at,
            'updated_at', row.membership_updated_at,
            'contact', CASE
              WHEN row.customer_id IS NULL THEN NULL
              ELSE pg_catalog.jsonb_build_object(
                'id', row.customer_id,
                'account_id', row.customer_account_id,
                'user_id', row.customer_user_id,
                'name', row.customer_name,
                'phone', row.customer_phone,
                'avatar_url', row.customer_avatar_url,
                'created_at', row.customer_created_at,
                'updated_at', row.customer_updated_at
              )
            END,
            'plan', CASE
              WHEN row.current_plan_id IS NULL THEN NULL
              ELSE pg_catalog.jsonb_build_object(
                'id', row.current_plan_id,
                'account_id', row.current_plan_account_id,
                'name', row.current_plan_name
              )
            END
          )
        END,
        'contact', CASE
          WHEN row.customer_id IS NULL THEN NULL
          ELSE pg_catalog.jsonb_build_object(
            'id', row.customer_id,
            'account_id', row.customer_account_id,
            'user_id', row.customer_user_id,
            'name', row.customer_name,
            'phone', row.customer_phone,
            'avatar_url', row.customer_avatar_url,
            'created_at', row.customer_created_at,
            'updated_at', row.customer_updated_at
          )
        END,
        'lifecycle', row.lifecycle,
        'paymentState', row.payment_state,
        'overdue', row.overdue,
        'reference', row.reference,
        'source', row.source,
        'lineKinds', COALESCE(lines.line_kinds, '[]'::JSONB),
        'gatewayPaymentIds', COALESCE(
          payments.gateway_payment_ids,
          '[]'::JSONB
        ),
        'gatewayRefundIds', COALESCE(
          refunds.gateway_refund_ids,
          '[]'::JSONB
        ),
        'refundDispositions', COALESCE(
          refunds.refund_dispositions,
          '[]'::JSONB
        )
      ) AS value
    FROM page_rows AS row
    LEFT JOIN export_line_details AS lines ON lines.invoice_id = row.id
    LEFT JOIN export_payment_details AS payments
      ON payments.invoice_id = row.id
    LEFT JOIN export_refund_details AS refunds ON refunds.invoice_id = row.id
  ),
  queue_counts AS (
    SELECT
      pg_catalog.count(*) AS all_count,
      pg_catalog.count(*) FILTER (
        WHERE row.requires_refund_review
           OR row.overdue
           OR (
             row.state = 'open'
             AND row.payment_state = 'due'
             AND row.lifecycle <> 'upcoming'
           )
      ) AS attention_count,
      pg_catalog.count(*) FILTER (
        WHERE row.state = 'open'
          AND NOT row.requires_refund_review
          AND row.payment_state = 'paid'
      ) AS paid_count,
      pg_catalog.count(*) FILTER (
        WHERE row.state = 'open'
          AND NOT row.requires_refund_review
          AND row.lifecycle = 'upcoming'
      ) AS upcoming_count,
      pg_catalog.count(*) FILTER (WHERE row.state = 'void') AS void_count
    FROM available_rows AS row
  ),
  summary AS (
    SELECT
      pg_catalog.count(*) AS count,
      COALESCE(pg_catalog.sum(row.fee_amount) FILTER (
        WHERE row.state <> 'void'
      ), 0)::NUMERIC AS gross_invoiced,
      COALESCE(pg_catalog.sum(row.invoice_adjustment_amount) FILTER (
        WHERE row.state <> 'void'
      ), 0)::NUMERIC AS adjustments,
      COALESCE(pg_catalog.sum(
        row.fee_amount - row.invoice_adjustment_amount
      ) FILTER (WHERE row.state <> 'void'), 0)::NUMERIC AS invoiced,
      COALESCE(pg_catalog.sum(row.gross_amount_paid) FILTER (
        WHERE row.state <> 'void'
      ), 0)::NUMERIC AS gross_collected,
      COALESCE(pg_catalog.sum(row.processed_refund_amount) FILTER (
        WHERE row.state <> 'void'
      ), 0)::NUMERIC AS refunds,
      COALESCE(pg_catalog.sum(row.amount_paid) FILTER (
        WHERE row.state <> 'void'
      ), 0)::NUMERIC AS collected,
      COALESCE(pg_catalog.sum(row.balance) FILTER (
        WHERE row.state <> 'void' AND row.balance >= 0.5
      ), 0)::NUMERIC AS outstanding,
      pg_catalog.count(*) FILTER (
        WHERE row.state <> 'void'
          AND row.balance >= 0.5
          AND row.overdue
      ) AS overdue
    FROM matched_rows AS row
  ),
  plan_options AS (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', option.plan_id, 'name', option.name)
        ORDER BY option.name COLLATE "und-x-icu", option.plan_id
      ),
      '[]'::JSONB
    ) AS value
    FROM (
      SELECT DISTINCT ON (row.plan_id)
        row.plan_id,
        row.current_plan_name AS name
      FROM month_rows AS row
      WHERE row.plan_id IS NOT NULL AND row.current_plan_name IS NOT NULL
      ORDER BY row.plan_id, row.created_at ASC, row.id ASC
    ) AS option
  ),
  export_token AS (
    SELECT CASE
      WHEN v_mode = 'export' THEN pg_catalog.md5(
        COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(row) ORDER BY row.id
          )::TEXT,
          '[]'
        )
      )
      ELSE NULL
    END AS value
    FROM matched_rows AS row
  )
  SELECT pg_catalog.jsonb_build_object(
    'rows', COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(row.value ORDER BY row.page_ordinal)
        FROM serialized_rows AS row
      ),
      '[]'::JSONB
    ),
    'page', context.page,
    'totalCount', context.total_count,
    'queueCounts', pg_catalog.jsonb_build_object(
      'all', queue.all_count,
      'attention', queue.attention_count,
      'paid', queue.paid_count,
      'upcoming', queue.upcoming_count,
      'void', queue.void_count
    ),
    'planOptions', plans.value,
    'summary', pg_catalog.jsonb_build_object(
      'count', totals.count,
      'grossInvoiced', totals.gross_invoiced,
      'adjustments', totals.adjustments,
      'invoiced', totals.invoiced,
      'grossCollected', totals.gross_collected,
      'refunds', totals.refunds,
      'collected', totals.collected,
      'outstanding', totals.outstanding,
      'overdue', totals.overdue
    ),
    'snapshotToken', token.value
  )
  INTO v_result
  FROM queue_counts AS queue
  CROSS JOIN summary AS totals
  CROSS JOIN plan_options AS plans
  CROSS JOIN export_token AS token
  CROSS JOIN page_context AS context;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.finance_invoice_ledger_page(
  DATE,
  TEXT,
  DATE,
  TEXT,
  TEXT,
  TEXT[],
  UUID[],
  TEXT[],
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.finance_invoice_ledger_page(
  DATE,
  TEXT,
  DATE,
  TEXT,
  TEXT,
  TEXT[],
  UUID[],
  TEXT[],
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  TEXT
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.finance_invoice_ledger_page(
  DATE,
  TEXT,
  DATE,
  TEXT,
  TEXT,
  TEXT[],
  UUID[],
  TEXT[],
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  TEXT
) TO authenticated;

COMMENT ON FUNCTION public.finance_invoice_ledger_page(
  DATE,
  TEXT,
  DATE,
  TEXT,
  TEXT,
  TEXT[],
  UUID[],
  TEXT[],
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  TEXT
) IS 'Selected-branch Finance invoice ledger page with exact queue facets and summary; export mode is admin-gated and remains bounded.';
